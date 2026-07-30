# Vraagposten bank — een derde uitkomst voor een bankregel

*Wat er zou moeten gebeuren met een bankregel die de ondernemer niet kan thuisbrengen: niet
boeken (dat verzint een deelbetaling), niet negeren (dat maakt de vraag definitief), maar apart
zetten — en wat dat voor de data betekent.*

**Status: ontwerpanalyse. Er is hiervan niets gebouwd.** Dit document beschrijft een voorstel,
geen bestaand gedrag. Wat er op deze branch wél veranderde, is losstaand en klein: de
onverklaarde onderbetaling op de bankkaart is niet langer rustige blauwe informatie maar een
amber-melding met een expliciet vinkje (`classifyPaymentFit` in `src/lib/partial-payment.ts`),
en het mismatch-icoon gebruikt weer een glyph die in de icon-subset zit.

## De aanleiding

Een afschrijving van **EUR 30,49** naar *Aardappelgroothandel Altena Bv*, omschrijving
`2034 26701293`. Factuur `26701293` van diezelfde leverancier staat open voor **EUR 140,07**,
`amount_paid = 0`. Het factuurnummer klopt exact, het bedrag niet — 30,49 is 22 % van 140,07.
De matcher scoort dit op 0,65 (`reference`, geen `amount`-signaal) en weigert terecht te
pre-selecteren.

De ondernemer weet niet wat die EUR 30,49 is. Boeken schrijft een onwaar EUR 109,58 openstaand.
Negeren is net zo onwaar: het IS een zakelijke betaling die verantwoord moet worden. Er is dus
een echt gat — een derde uitkomst voor *"dit is zakelijk, het is onopgelost, en ik ben niet
degene die het gaat oplossen"*.

De vraag die dit document beantwoordt is niet "past zo'n knop in de UI", maar de vraag die de
eigenaar van de app stelde: **welke gevolgen heeft die knop voor de data?**

## Hoe dit document tot stand kwam

Een analyse in vier fasen, uitgevoerd door 19 agents met leesrechten op deze repo: vijf lezers
die de feitelijke toestand vastlegden (de statemachine van een bankregel, het
accountant-oppervlak, de bestaande `vragen`-primitieven en de deadline-poorten, de downstream
consumenten, en de eigen conventies van de codebase), daarna drie onafhankelijke ontwerpen uit
verschillende invalshoeken, elk aangevallen door drie adversariële reviewers (data-corruptie /
belastingdeadline, valse zekerheid / accountant-realiteit, misbruik / omkeerbaarheid), en tot
slot een completeness-criticus en deze synthese.

Uitkomst: **40+ aanvallen, waarvan één fataal** (bijlage B). Alle drie de ontwerpen kozen
*afgeleide* state; die keuze is drie keer onafhankelijk gesneuveld. Alle drie bevatten
bovendien een feitelijk onjuiste claim in hun eigen tekst — zie de adjudicaties in §2 en §5.

Elke bewering hieronder is verankerd in `file:line`. Waar het panel het oneens was, staat de
afweging erbij.

De analyse zelf staat in het Engels, zoals de comments in de code; voorgestelde UI-teksten staan
in het Nederlands (§6). De bijlagen staan achteraan.

---

## 1. THE REAL GAP — why Bevestig and Negeren genuinely do not cover this

The prompting case: `-30,49` to *Aardappelgroothandel Altena Bv*, description `2034 26701293`, and an open purchase invoice `26701293` of `EUR 140,07`. The matcher lands this at `outcome:'choice'`, reference hit, no amount signal.

There are exactly four things the owner can do today, and all four write something untrue.

**Bevestig** routes to `apply_bank_payment` (`invoice_partial_payments.sql:153-184`). It writes `bank_tx_invoices.amount_applied = 30.49`, and because `invoices.amount_paid` is *defined* as `SUM(amount_applied)` (`recompute_invoice_amount_paid`, `invoice_partial_payments.sql:234-246`), invoice 26701293 becomes `EUR 109,58 openstaand` with `payment_date = tx.date`. That is a **deelbetaling assertion**. If the EUR 30,49 is an emballage/krat correction — the likeliest reading — then: `openstaandOf` (`invoice-reminders.ts:165-174`) now demands 109,58 instead of 140,07 in a letter to a third party; under kasstelsel the bank line's date now places BTW on 30,49 of that invoice into that quarter (`kas-payment-events-fetch.ts:137-142`); and `closing-package.ts:276-297` reports the payment date as authoritative, non-estimated, in the accountant's ZIP. The owner cannot honestly press this, and the app has no "partial payment, probably" state.

**Negeren** writes `status='not_found'` (`ignore/route.ts:73-74, 84-89`) and nothing else — no reason, no audit row (the file has no `logAuditAction` import). The data consequences are all invisible:

- the line leaves the matcher (`match/route.ts:56`), auto-confirm (`bank-auto-confirm.ts:79`), auto-categorize (`bank-auto-categorize.ts:55`), the nightly sweep (`cron/reconcile/route.ts:57-59`) **and all six pending-scoped reads in `categorize/route.ts` (75, 92, 128, 137, 265, 299)** — i.e. the only route in the app that could ever record the answer (`categorize/route.ts:216-232`) becomes unreachable. Negeren makes the question **terminal**;
- `undocumentedCount` is pending-scoped (`readiness/route.ts:139-146`), so the `[VOORBELASTING-RISK]` warning at `readiness.ts:310-320` — "anders mis je de BTW-aftrek en betaal je te veel" — is **deleted** by the ignore, for a line whose voorbelasting is precisely what is undecided;
- `unreviewedExcludedCount` (`readiness/route.ts:121-129`) stops reaching it;
- the artifact that reaches the accountant carries the bare token `not_found` (`account-export.ts:251`, `select("*")`), which cannot distinguish matcher-failure from owner-ignore from delegation. `closing-package.ts` has warning codes for seventeen other completeness gaps and **none** for an unresolved bank line.

**Leave it pending** — it nags forever, and on a `choice` card there is no set-aside action at all: `BankClient.tsx:2051` renders Negeren only for `!wasMulti && outcome === 'none'`; the `choice` branch at `:2138+` renders candidates only. The population most likely to need this has nothing.

**Attach-invoice** (`attach-invoice/route.ts:19-21`) is the only hatch that *resolves*. For a missing-bon line it is the right answer and we should route to it — see §8.

So the missing state, in data terms, is: **`status='pending'` (in every queue), `category IS NULL` (worth EUR 0), `invoice_id IS NULL` (no payment asserted), plus a durable, dated, audited record that the owner has declared they cannot resolve it.** No column in `bank_transactions` can hold the last clause, and the `status` CHECK (`database.sql:120-121`) has no fourth slot.

---

## 2. THE CENTRAL DISTINCTION

> **This button changes no figure. It revokes a mandate.**

Every proposal reached for a new *state* for the line. The line does not need a new state — its state is already correct: pending, uncategorised, unlinked, worth EUR 0. What is wrong today is that the app keeps acting on that line **as if nobody had told it anything**: it will guess a category from `counterpart_memory` (`bank-identity.ts:260`), it will count the line as `verwerkt` in a subscore, it will let a bulk sweep confirm it, and it will send a statutory WIK aanmaning to the owner's customer over money the owner has already flagged (`cron/reminders/route.ts:311-323`).

So: parking is an **orthogonal, additive declaration by the owner that withdraws the app's licence to act unasked**. Three consequences follow mechanically, and they settle most of the panel's disagreements:

1. **Storage must touch nothing on the line.** Not `status`, not `category`, not `invoice_id`. Anything stored *on* the bank row is destroyed by `delete-statement/route.ts:240-246` (hard DELETE) and rewritten by `pay-toggle/route.ts:268-272` (`{status:'pending', invoice_id:null}`, from outside the bank folder). A park that evaporates on a re-upload is worse than no park.
2. **The state must be stored, not derived.** All three proposals derived openness from the bank tuple. Since the tuple is deliberately untouched and four other routes rewrite it, every derivation leaks. This is where the panel was collectively wrong — see the adjudication below.
3. **"Consequences for the DATA" means consequences for the app's automation and its counting — not for omzet, kosten or BTW.** Parking must be arithmetically neutral in both directions. Any design that moves a euro has misread the request.

**Adjudication — derived state is dead.** Attacks killed it three times independently and one was rated fatal:

- P1's predicate (`park_reason IS NOT NULL AND status='pending' AND invoice_id IS NULL AND category_confirmed=false`) makes the tap a **silent no-op on exactly the cards the proposal renders it on**: a partially-linked line has `invoice_id` set (`confirm/route.ts:412-414`) and an already-categorised `outcome:'none'` line has `category_confirmed=true`. The route (a copy of `ignore/route.ts:68-70`, which refuses only `matched`) accepts the write, emits an audit row, shows a success toast, and nothing appears in the tab, the CSV or the warning. Button, route and read predicate disagree — the precise defect `invoice-removal.ts:2-4` exists to prevent.
- The **fatal** one: the categoriseren queue (`categorize/route.ts:122-141`) selects exactly the parked shape, `CategoriseClient` renders no park badge, and one tap on the pre-selected suggestion writes `category_confirmed:true` — which under P1/P3's derivation *closes the park*, with no `park_cleared` audit row, and converts a recorded "ik weet niet" into a confident `prive` exclusion that also escapes `unreviewedExcludedCount`.
- P3's derivation is a **lease on three other routes' state**: `/api/bank/ignore` closes it (destroying an accountant's answer unread), a partial booking closes it while `financial-result.ts:369` then drops the whole line, and `unlink`/`pay-toggle` **resurrect** an answered question weeks later into a filed, `verwerkt` quarter — re-engaging the dunning brake with no event anywhere.

Verdict: an explicit lifecycle (`open | resolved | withdrawn`), written only by the two parties who may assert it, with a *derived hint* on the card ("deze regel is inmiddels geboekt — vraag afronden?"). Dull and sturdy beats clever. The self-clearing property was the only thing derivation bought, and it is not worth four silent failure modes.

---

## 3. WHAT THE BUTTON MUST WRITE, AND MUST NOT WRITE

**Storage: a new owner-owned table, not a column on the bank row.** `bank_line_parks` (`vraagposten` in the UI — borrow the profession's noun, see §5):

`user_id` · `transaction_id uuid NULL REFERENCES bank_transactions(id) ON DELETE SET NULL` · a **snapshot** (`tx_date`, `tx_amount`, `tx_counterpart`, `tx_description`, `tx_reference`, `tx_counterpart_iban`) · `reason text CHECK (reason IN ('weet_niet','prive_of_zakelijk','bedrag_klopt_niet','anders'))` nullable · `note text` nullable · `owner_candidate_invoice_id uuid NULL` — **only** when the owner ticked it, never the matcher's · `state` + `resolved_at` + `resolved_action` · `created_at`. One partial unique index: **one open park per transaction** (the duplicate-row attack: a retried tap on a flaky connection otherwise makes the ZIP say "2 bankregels" for one bankregel — a wrong number in the honest-handover artifact, `daily-truth/route.ts:15-17`).

RLS four owner policies `user_id = auth.uid()`. **No accountant policy in v1** (§6). Add the table to `account-export.ts` and — nobody raised this — to `retention.ts`, because a note explaining a bank mutation is part of the administratie and bewaarplichtig, while free text will contain third-party personal data. v1 rule: the enum + snapshot are retained; the free-text note is erasable.

**Audit:** three new `AuditAction` values beside the six existing bank ones (`audit.ts:44-50`) — `bank.parked`, `bank.park_resolved`, `bank.park_withdrawn`, `entity_type: 'bank_transaction'` (the second bank-line-keyed stream after `unlink/route.ts:341-347`). Best-effort is acceptable *because* the park row itself is the durable record — unlike `ignore`, which changes a financial record's state and logs nothing. Do **not** make `audit_logs` the store: `audit.ts:15,170` documents writes as non-fatal, and there is no audit-log reader anywhere in `src/app`, so the "recover from the pre-delete snapshot" mitigation P1 proposed is a row only psql can read.

**Writes nothing in `bank_transactions`.** Not `status`, not `invoice_id`, not `category`, not `category_source`, not `category_confirmed`, not `auto_match_reason`.

**Writes nothing in `invoices`.** Not `status`, `amount_paid`, `payment_method`, `marked_paid_at`, `payment_date`, `accountant_status`, `accountant_note`, `field_confidence` — and deliberately **not** `reminders_paused` (§4).

**No `bank_tx_invoices` row inserted or deleted.** Because `amount_paid ≡ SUM(amount_applied)`, any link touch silently re-opens or closes an invoice. Parking is arithmetically link-neutral by construction.

**No `btw_filings` write.**

So for the Altena case: invoice 26701293 stays at `EUR 140,07` open, `amount_paid = 0`; the `EUR 30,49` stays uncategorised and therefore contributes `EUR 0` to omzet, kosten, voorbelasting and rubrieken 1a/1b/5a via the existing `if (!t.category) continue` at `financial-result.ts:369-370`; and it dates nothing, so `undatedPaidCount` (`readiness.ts:417-430`, `btw/file:124`) is not double-reported for kas owners.

### The one write two proposals wanted that must not happen

**[BANK-OPEN-QUESTION] clears the unconfirmed auto-category on park.** Rejected. It is marketed as buying a clean "EUR 0 everywhere" invariant; it is a money-touching write inside a money-neutral feature, and the attack found the expensive case: clearing a `pos_income` acquirer payout's category stops it consuming the covered-day card budget (`financial-result.ts:285-301, 388-411`), so a second PSP payout that was previously `excess → omzet + cashOmzetZonderBtw` becomes fully suppressed. **Parking then lowers omzet by EUR 200 and deletes the `cashOmzetZonderBtw` filing blocker at `btw/file/route.ts:122`.** Parking made the quarter quieter, cheaper *and* more filable. It also silently moves an already-filed quarter's kosten with no divergence signal, because a bare bank line carries no BTW so `computeFilingDivergence` (`btw-filing.ts:43-66`) reports `btwSaldoDelta = 0` and `QuarterlyOverview.tsx:415` renders nothing.

The invariant is bought properly by **gating the machine, not by rewriting the row** — §5.

**Product decision, stated once:** a line that already had a category keeps counting. Parking never pulls money out of a quarter. Silently removing a cost the owner asked about is a wrong number, and a wrong number is the unforgivable class.

---

## 4. THE INVOICE SIDE

The candidate invoice keeps its **true** figures. `status` stays `sent`/`overdue`, `amount_paid` stays 0, `openstaand` stays `EUR 140,07`, `overdueDays` (`overdue.ts:28-44`, pure) stays a fact. No false `EUR 109,58` is ever written — that is the point of the whole feature.

**It stays in the attention list.** `daily-truth/route.ts:233-238` keeps returning it; removing it would be false reassurance (locked constraint #3, cited at `vandaag/page.tsx:126-134`). It gets an **annotation**, not a suppression: *"Mogelijk al betaald — je zoekt dit nog uit."* Same for the aging surfaces.

**Its reconciliation badge survives for free.** Because `status` stays `pending`, `bank-recon-map.ts:70` still yields the suggestion and `bank-reconciliation.ts:85-94` still tags the invoice. The one on-screen hint that a payment might exist does *not* vanish exactly when the owner flags uncertainty — the failure any status-flip design would have caused. Same reason `pendingTransactions` (`bank-recon-map.ts:103`) still counts the line, so `IncomingManageClient.tsx:1745/1813` can never tell the owner "Niets om te matchen / Upload een bankafschrift" about a statement they already uploaded.

### Reminders — the guard, adjudicated

This is where the panel produced the most heat and the most error. Three findings must all be respected:

- **P1's answer (no guard, one sentence of copy) is untenable.** All eleven guards in `reminderTierDue` (`invoice-reminders.ts:107-150`) pass unchanged; `openstaandOf` demands the full total; the final tier fires `buildWikNotice` — a statutory fourteen-day demand with named incassokosten, to a third party, over money already received. P1's own weakest point concedes it. Its offered mitigation (`reminders_paused`) is unusable by construction: the pause is per invoice and the owner parked precisely because they do not know which invoice.
- **P2/P3's answer (suppress everything, keyed on the matcher's candidate) is worse in the other direction.** `bank-matching.ts:696-706` is a written prohibition on claiming a `choice` candidate — "claiming the ARBITRARY top of a near-tie". Near-ties are the population. The attacks are concrete: a EUR 40 credit quoting a customer-number `0114` permanently kills dunning on a EUR 1.815 receivable and then removes the EUR 315 art. 29 lid 1 reclaim; identical amounts on two months of a retainer aim the brake at the wrong invoice and send the WIK notice on the one already paid. And nothing expires it.
- **Release is as dangerous as suppression.** `reminderTierDue` sends only the highest reached unsent tier (`:131-145`), so a park held from day 7 to day 203 and then withdrawn makes the **statutory aanmaning the customer's first ever contact**, forty to two hundred days late, with the intermediate rungs permanently destroyed (they can never be the highest again). That is the debtor's best argument against the incassokosten claim.

**The rule:**

1. **Suppress only the irreversible tier.** Lower tiers keep going. A friendly "wil je hier nog naar kijken" over money possibly received is cheap and recoverable; a WIK notice with cost consequences is not. This single change kills both the "unchased forever" family and the "tier-jump to WIK" family, because the ladder never stops and no rung is ever skipped.
2. **Only on an owner-confirmed candidate.** The sheet offers one optional tick: *"Dit hoort waarschijnlijk bij factuur 26701293."* Stored as `owner_candidate_invoice_id`. If the owner does not tick it — the true `weet_niet` case — **nothing is suppressed**, and the copy must not claim otherwise. A 0.65 machine guess may never switch off a demand.
3. **Fail-closed pre-read keyed on `ownerIds`**, exactly like the creditnota read (`cron/reminders/route.ts:164-199`) — but distinguish a *transient* query error (fail closed, as today) from a *missing relation* (alert, non-200). The deploy-ordering attack is correct: a table shipped after the code silently kills dunning for every owner for days behind `ok:true`.
4. **Visible where reminders live.** No write to `invoices.reminders_paused` — that makes the park's undo responsible for restoring another feature's state, which is the `auto_match_reason` staleness trap (`unlink/route.ts:109` never clears it, so the amber banner at `BankClient.tsx:1730` lies after a manual re-confirm). Instead join and render on the invoice's reminder panel: *"Laatste aanmaning is uitgesteld — je zoekt een bankbetaling van EUR 30,49 nog uit."* A guard nobody can see is the same defect as no guard.
5. On resolve/withdraw, mark the suppressed final tier as superseded rather than pending, so it resumes at the next unsent rung.

**Bad debt: annotate, never suppress — both directions.** P2 excluded flagged invoices from `totalReclaimableBtw` *and* `totalRepayableBtw`. The lid-1 side (`bad-debt.ts:101`) losing a reclaim is money left on the table; the **lid-7 side (`:219`) losing a clawback is a self-inflicted naheffing met belastingrente** on a figure the owner *owes* — the exact outcome `bad-debt.ts:155-162` exists to prevent. Keep both invoices in `eligible` and in the totals, add a per-invoice line: *"Let op: er ligt nog een bankvraag van EUR 500,00 bij deze factuur — controleer of hij toch (deels) betaald is."* This matches the module's own doctrine, "an honest FLAG, never an automatic figure" (`:17-19`).

**`import-health`:** one optional input → `needs-review` (`:333-336`), so an invoice whose payment is under investigation is held out of bulk-confirm alongside `possible_duplicate` and `iban_changed`. Only when the owner confirmed the candidate.

**`verwerkt`:** parking is *allowed* against a verwerkt invoice — the park writes nothing on `invoices`, so `invoices_verwerkt_guard` (`database.sql:1396-1398`) has nothing to fire on. Resolving *by booking* hits the existing refusals (`confirm/route.ts:110`, `invoice_partial_payments.sql:127`) and the parked card is the first surface to render `decideRemoval`'s `alternative: { kind:'ask-accountant' }` (`invoice-removal.ts:135`), which has been returned into the void since it was written because `FacturenClient.tsx:1621-1630` passes only title/body/warning/confirmLabel.

---

## 5. DOWNSTREAM — per consumer

**Money engines — no change, no park filter.** `financial-result.ts:368-370`, `compute-result-range.ts:113-119`, `aangifte/route.ts:91-95`, `turnover/analytics/route.ts:76-82` stay status-blind and park-blind. Correct *because* the park writes neither of the two columns they read.

**⚠️ SILENT #1 — auto-categorize, bulkApply, and the memory path.** Add `open park` exclusion to `bank-auto-categorize.ts:50-58`, to `bulkApply`'s select **and** update guard (`categorize/route.ts:265, 281`) and to its remaining-count (`:295-301`), and to the `amount_only` tier of `bank-auto-confirm.ts`. This is the union of the two critical attacks and it is what actually buys the EUR-0 invariant. Without it: the nightly sweep or the shipped **"3 zekere invullen"** button (`CategoriseClient.tsx:256-264`) writes `category='kosten'` from `counterpart_memory`, the money enters the aangifte, and because `category_confirmed` stays false the park survives — so the tab header says "staat in geen enkel cijfer" while rubriek 1a carries it. Two contradictory truths about the same euro, permanently, with no bell and no audit row (`bulkApply` logs nothing).

Separate **visibility** from **write**: the parked line *stays* in the categorize list and in the head-count that governs "alles gecategoriseerd" (`categorize/route.ts:122-130`, "only 0 here means truly done"), and `CategoriseClient` must render the park badge and reason — otherwise the list itself is the destruction path. The single-tx POST (`:216-232`) stays open: it is the only way an answer can ever be recorded.

**⚠️ SILENT #2 — `trainMemory`.** Suppress it on any write that resolves a park (`categorize/route.ts:243, 310+`). One uncertain line must not teach the classifier — otherwise the app answers next month's identical line by itself using a guess the owner never made. Conversely, an *answered* park is the one write that *should* train it. Nobody raised this.

**⚠️ SILENT #3 — never gate on `status` or on the park in the dedup path** (`bank-ingest.ts:116-127` → `bank-import.ts:136-160`). A parked line must keep being recognised as a duplicate on an idempotent re-upload, or the statement double-counts into omzet/kosten. Positive property, explicitly preserved.

**Matcher / auto-confirm certain tier / reconcile cron / all categorize queues — unchanged, and this is the feature's engine.** All are `.eq('status','pending')`. When the real EUR 30,49 invoice arrives in August, the reference+amount tier books it and the bell fires (`bank-auto-confirm.ts:325-341`) with a clause naming the resolved park. A park expires by being answered, never by timing out.

**Readiness — the risk-vs-blocker fight, adjudicated by direction.** Both extremes were attacked successfully: P2's `missing` item produces unfair permanent reds for a retailer with twelve unidentifiable EUR 0,35 acquirer fees whose honest fix does not exist, and forwards that title to the accountant's board as the client's failure; P3's risk-only leaves the verdict green (`if (hasData && missing.length === 0 && score >= 90) status = 'ready'` is untouched by risks — 40 parked lines worth EUR 6.847 read `ready, 96%`), and P3's stated justification is factually wrong: `readiness-board.ts:18-34` forwards `missingTitles` only, risks travel as a bare `riskCount`, so the carefully written title reaches nobody.

Use the app's own deliberate, test-pinned asymmetry instead of inventing policy:

- a **parked credit** already hard-blocks today via `unmatchedIncomeCount` (`readiness/route.ts:130-138`, status-agnostic by design) → **do not add a second item**; enrich that blocker's detail instead. Both P2 and P3 double-count here: `openBank = unmatchedIncomeCount + parkedCount` reports 12 problems for 6 lines and states "28 van 40 banktransacties verwerkt" when 34 are resolved — a number the boekhouder can disprove from the ZIP in thirty seconds, which is the one thing `readiness.ts:11-18` says must never happen;
- a **parked debit** inherits `[NO-CODEER]`: one **risk**, count + euro total, self-clearing. `readiness.test.ts:121` stays green, nothing is knowingly re-pinned;
- **the number moves regardless:** `openBank = unmatchedIncomeCount + parkedDebitCount`, counted **disjointly**, in the bank subscore at `readiness.ts:287-290`, so a parked debit can never be arithmetically counted as `verwerkt` in a 30 %-weighted dimension. That is what makes parking the most expensive disposition without making it a red.
- **⚠️ SILENT #4 — fix the fix.** `readiness.ts:164` is a bare `{label:'Naar Bank', href:'/dashboard/bank'}`. `defaultQuarterKey = lastCompletedQuarter()` (`BankClient.tsx:820-838`), so in August a Q1 income blocker opens Q2, shows 0 everywhere, and the owner concludes it was handled. Give it `?year&quarter`, the pattern `unreviewedExcludedCount` already uses (`readiness.ts:340-362`).

**⚠️ SILENT #5 — the quarter roll. The park list must be cross-quarter.** This was the single most-repeated attack across all three panels and every proposal failed it. Every bank tab is `inQ`-filtered (`BankClient.tsx:831-887`), `/api/readiness` selects bank rows by date window (`:93-97`), quarter-close already fired for the previous quarter and `[ALREADY-FILED]` (`cron/quarter-close/route.ts:70-81`) skips filers forever. Result: on 1 October a Q2 park is open, still braking a demand, still an unclearable Q2 blocker — and visible on **zero default screens on either side**. Fix: the park tab and its count are quarter-agnostic, with the quarter as a badge per row (*"3 · 1 uit een eerder kwartaal"*), and the readiness park signal is counted date-unbounded up to the period end.

**Closing package — two corrections to all three proposals.** (a) The warning must be pushed in **`summarizeClosingPackage` (`:958-963`)**, not only in `assembleClosingPackageZip`. P1 pushed it "before `:671`" — the ZIP path — and costed the summary side as "`:1039-1041` gains `park_reason`", which is a `select("id").limit(1)` existence probe for `hasBankData` and counts nothing. Since `gapCount = summary.warnings.length` (`quarter-close.ts:44`), the quarter-close email would have been unchanged: the proposal's headline delivery claim was false as written. (b) Sort the park warning **first** in the array, because both `ownerBody` (`quarter-close.ts:65-69`) and `topGaps` `slice(0,3)` and a busy quarter pushes it to index ≥4 — the busiest quarters are exactly where the owner's own question gets truncated away.

The CSV — `vraagposten-bank.csv`, its own file per the ICP precedent (`closing-package.ts:681-690`) — must carry a **stable line id** (two EUR 14,95 lines from one counterpart on one day are otherwise indistinguishable, so an answer cannot be referenced) and must list **parks resolved within the quarter too**, with a status column (`open | opgelost | ingetrokken | genegeerd`). Open-only means the artifact loses the answer the moment it is used: a EUR 30,49 in kosten, invoice 26701293 still open at EUR 140,07, `2034 26701293` linking them, and nowhere any record of why they are not the same transaction — the "lijst zonder geheugen" complaint (`archive-reason.ts:4-23`) one subject type over.

**Also missing from every warning list today, and worth more than the button:** there is no code for an unresolved/uncategorised bank line at all. Ship that for *all* such lines, not just parked ones — see §9.

**`account-export.ts:251`** picks the table up as a joined dump instead of the ambiguous `not_found` token. Free win.

**`delete-statement`.** The separate table + `ON DELETE SET NULL` + snapshot means the hard DELETE (`:240-246`) can no longer destroy the decision. But define the orphan, because "the question survives" is not enough: **render the park list from `bank_line_parks`, not from the `/api/bank/match` DTO**, or an orphan has no card, therefore no *Terugzetten*, therefore an eternal blocker whose tab reads 0 while the filing gate refuses — two adjacent surfaces disagreeing out loud. Do not rely on re-attach by the dedup key (`bank-import.ts:101-113`): `contentKey` includes the amount, and the commonest reason to delete-and-re-upload is that the amounts were misparsed, so the key differs by construction. Instead: `delete-statement` resolves the parks it orphans with `resolved_action='regel_verwijderd'`, names the count in the dialog beside the existing `BankClient.tsx:1436` copy, and puts the ids in the audit snapshot it already takes before the destructive step (`:215-233`).

**`pay-toggle` / `unlink`** — cannot destroy or resurrect a stored park. This is the payoff of §2.

---

## 6. THE PROMISE PROBLEM — and the label

Every proposal named the same weakest point: **the accountant cannot see a bank line and cannot answer in the app.** `bank_transactions` RLS is owner-only in all four verbs (`database.sql:623-635`); the entire accountant bank surface is one integer fetched through `service_role` with a written Dutch rationale that "er komt niets méér mee dan een GETAL" (`accountant.repository.ts:80-98`); `accountant_subject_status.subject_type` allows only `('invoice','document')` (`accountant_subject_status.sql:22`) and its client policy is `SELECT`-only *by design* — an owner-authored row there inverts `vragen.ts:12-22` and trips the structural guard at `vragen.test.ts:111-123`.

What actually reaches the accountant in v1, therefore: **a warning in `overzicht.csv`'s "Let op" block and `overzicht.json` waarschuwingen, a row in `vraagposten-bank.csv`, and a `+1` in the quarter-close email's "met nog N aandachtspunt(en)".** Batch, quarterly, one-directional, pull-not-push. And note `quarter-close.ts:77-79` interpolates no warning messages into `accountantBody` — it prints the integer only, so a client with 4 missing PDFs and one delegated line produces a byte-identical email to one with 5 missing PDFs. Fix that string; it is one line and it is the difference between a signal and a digit.

Also, honestly: for a solo owner with no `accountant_clients` row — created only by the accountant-initiated `invite/accept` route — **nothing is pushed anywhere.** `/api/messages` 403s (`:79-85`), the quarter-close accountant loop iterates zero times, and `/api/closing-package` is an owner-initiated download. The proposals that promised "two guaranteed channels" have one owner-pull artifact for this population, and `VragenClient.tsx:198-202` already ships the honest sentence for exactly this case.

### The label

The owner asked for **"ik regel dat zelf met de boekhouder"**. [BANK-VRAAG] rejected it on `belofte.ts:32-34` grounds and replaced it with "Vraag aan mijn boekhouder". **I disagree, and I would keep the owner's words.**

`belofte.ts:32-34` forbids the *app* promising another person's handeling: *"Wij beloven de TOESTAND, niet de handeling van iemand anders."* "Mijn boekhouder regelt dit" violates that. But *"ik regel dat zelf"* is **first person, owner-voice, and it is the owner's own assertion about their own intention** — the app claims nothing it cannot see. It is the *most* honest framing available, and it is the only one that is still true when no accountant is linked, which dissolves the entire no-accountant attack at the copy layer instead of needing a conditional label.

"Vraag aan mijn boekhouder" is the framing that over-promises: it asserts a question has been *asked of* someone, which in v1 (no push, no read policy, no answer box) is exactly the second instance of the empty promise `invoice-removal.ts:135` already committed once.

**Copy (v1):**

> Knop (op `choice`, `none` en multi-kaarten; niet op `auto`): **Ik regel dit zelf**
>
> Titel: **Deze regel zet je apart om zelf uit te zoeken**
>
> Body: *"Er wordt niets geboekt: geen deelbetaling, geen categorie, en je cijfers veranderen niet. Factuur 26701293 blijft volledig openstaan (EUR 140,07). De regel gaat uit je actielijst en komt op 'Ik regel dit zelf'."*
>
> Wat wij vastleggen: *"Datum, bedrag, tegenrekening, kenmerk `2034 26701293` en je reden gaan mee in je kwartaalpakket, als vraagpost. We vullen zelf geen categorie meer in voor deze regel — jij of je boekhouder bepaalt wat het is."*
>
> Waarschuwing: *"Hij blijft meetellen als openstaand werk — je kwartaal wordt hier niet groener van. Je kunt hem met één tik terugzetten."*
>
> Alleen als de eigenaar de factuur aanvinkt: *"De laatste, wettelijke aanmaning voor factuur 26701293 stellen we uit zolang dit openstaat. De eerdere herinneringen gaan gewoon door, en de factuur blijft EUR 140,07 openstaan — wij verzinnen geen deelbetaling."*
>
> Bevestigen: **Apart zetten**
>
> Tabblad (zesde entry in de literal array op `BankClient.tsx:906-912`, vóór 'Genegeerd', **niet** kwartaal-gefilterd): **Ik regel dit zelf · 3 regels · EUR 412,80**
>
> Op de kaart: *"Apart gezet op 30-07-2026 — nog niet geboekt, telt mee als openstaand werk."* + redenlabel + **Terugzetten**
>
> Reden, optioneel, vier chips in de `ARCHIVE_REASON_LABELS` vorm (`archive-reason.ts:29-47`): **Weet ik niet** ("ik kan dit bedrag niet plaatsen") · **Privé of zakelijk?** ("ik weet niet of dit in de boekhouding hoort") · **Bedrag klopt niet** ("het factuurnummer klopt, het bedrag niet") · **Anders**
>
> In het kwartaalpakket ("Let op"-blok): *"Vraagposten bank: 3 regels, EUR 412,80 — de ondernemer zoekt deze zelf uit. Nog niet geboekt, nog niet gecategoriseerd (zie vraagposten-bank.csv)."*
>
> Readiness-risico (kop, want alleen koppen reizen naar het werkbord): **"3 bankregels staan als vraagpost open"** — detail: *"Je hebt deze zelf apart gezet. Zolang niemand ze uitzoekt, staan deze bedragen in geen enkel cijfer."*

Note what is *not* in the button copy: no "verstuurd", no "je boekhouder heeft dit". And **"bon ontbreekt" is deliberately not one of the four reasons** — see §8.

Borrow the noun *vraagpost* only where the accountant reads (the CSV name, the warning). It is the word they already use, and it makes the artifact instantly legible. **But do not implement the park as a category** (the tempting version of the same idea): a `vraagpost` category with `pnlRole 'excluded'` would drop the line out of `undocumentedCount`, land it in the `[AUTO-EXCLUDE-REVIEW]` hazard the codebase documents at `readiness.ts:57-68`, make `categorize`'s head-count read "alles gecategoriseerd" while the line has no identity, and — for a debit — push the money out of kosten entirely, which is the profit-overstating direction. Borrow the vocabulary, not the mechanism.

---

## 7. THE DEADLINE

**Quarter close (5 Jan/Apr/Jul/Oct).** The warning rides `summary.warnings` into `buildQuarterCloseNotice`. Three fixes the proposals missed: push it in `summarizeClosingPackage`; sort it first past both `slice(0,3)`s; interpolate it into `accountantBody`. Two skips must be handled or the only push channel misses exactly the wrong owners: `empty = (outgoingCount + incomingCount === 0)` (`quarter-close.ts:47`) skips a **starting** owner whose invoices are all still in the verify queue but who parked a EUR 4.200 credit — count parks into the non-dormancy test; and `[ALREADY-FILED]` (`cron/quarter-close/route.ts:70-81`) skips the owner who used the soft override, i.e. the one person who filed *with* an unresolved park. Do not skip a filer who has open parks: that is the one case where re-contacting is the point.

Timing honesty: a park created on 30 July, after the 5 July cron and before the 31 July filing, rides **only** the ZIP. Say so in the sheet rather than implying a push.

**BTW filing.** One **fifth soft blocker** in `btw/file/route.ts:117-124` naming the count and the euro total. Soft, per the route's own doctrine — *"This is a WARNING, not a hard block: filing is the owner's own declaration"* (`:105-106`) — overridable with `acknowledge:true` and audited as `btw.filed_despite_warnings` (`audit.ts:60`). The owner at 31 July with one genuinely unidentifiable EUR 30,49 must be able to file. **No first-ever hard gate for this.** Filing never clears a park: a deadline is not an answer.

**After filing.** Never block a correction; name the consequence — the only existing filings-aware edit path pushes a notice and states *"Nothing is blocked (the figures move, that is the point)"* (`invoice/[id]/archive/route.ts:113-133`). But attach the warning to the **right event**: the proposals show the suppletie sentence at *park* time, when nothing moves, and nothing at *resolution* time, when the figures actually move. The `categorize` POST has no `btw_filings` check, no `verwerkt` check, no audit and no notification, so resolving a park through it silently moves a filed quarter's kosten. Add the divergence notice to the resolution path.

Two things to say out loud that no proposal did. First, **the app tells the owner "Onder EUR 1.000 — verwerk dit in je volgende aangifte"** (`QuarterlyOverview.tsx:427`, `btw-filing.ts:30-32`) **and has no mechanism to do it**: every figure is date-scoped, so a resolved park changes the old quarter forever and can never appear in a later return. v1 does not fix that; it must not pretend to. Second, **for kasstelsel owners post-filing retro-movement is the default, not an edge case**: the bank line's own date places the BTW (`kas-payment-events-fetch.ts:137-159`), so every park resolved after the 31st moves a filed quarter. The kas sheet needs one extra sentence.

**Accountant marks the period verwerkt.** Parking stays possible (writes nothing on `invoices`). Booking is refused by the existing guards and the card renders the `ask-accountant` alternative with the shipped copy: *"De boekhouder heeft factuur 26701293 verwerkt. Vraag eerst om de verwerking ongedaan te maken."* Note the ordering hazard the panel found: because the park reaches the accountant *inside the artifact she reads while processing*, her answer systematically arrives after her own lock. Put the ordering in the CSV header — *"beantwoord de vraagposten vóór je facturen op verwerkt zet"*.

---

## 8. THE ABUSE RISK — and the minimum friction

The structural brake is that **parking never improves a number**: the debit stays in `undocumentedCount` (status untouched) and now also in the bank-subscore gap; the credit keeps its existing hard block; the line stays in `pendingTransactions` and in the categorize head-count that governs "alles gecategoriseerd"; and the euro total is on the tab and in the ZIP. Forty parks is forty rows the owner's own accountant will bill for. The social cost is more durable than a rate limit.

But the strongest attack in the whole panel was not about parking at all — it was about **the button next to it**. Negeren is one tap, no dialog, no reason, no audit row, and for a debit it *does* clear `undocumentedCount` and lets the score reach 100. So the honest button costs four interactions and keeps the risk up; the dishonest neighbour costs one and makes the quarter green. After one quarter every owner learns which to press, and the feature's net effect is a park route nobody uses. P1 conceded this as its fourth weakness and declined to scope the fix; **that concession is the feature.**

So the minimum friction is not friction on parking. It is:

1. **`/api/bank/ignore` gets the same reason vocabulary and an audit row, in the same release.** Non-negotiable. Otherwise the cheaper dishonest path dominates and the release makes the codebase *less* accountable than before.
2. **A pre-park resolution step, one tap earlier than the park.** The app already stores `counterpart_iban` (`bank-import.ts:178`) and treats an IBAN hit as a CERTAIN-tier signal (`bank-matching.ts:62, :552`) — and never shows it. Put it on the card: *"Eerdere betalingen aan deze IBAN: 6 × als kosten geboekt"* plus this counterparty's open invoices. Every euro of accountant time this feature bills is a euro the IBAN lookup might have saved.
3. **Route "bon ontbreekt" away from the park entirely.** This is a real finding and it narrows the population sharply. `bank-categories.ts:62-70`: the engine writes **no BTW for a bare bank line**, so categorising it `kosten` already yields exactly the fiscally correct treatment of a business payment without an invoice — **gross cost, EUR 0 voorbelasting** — and keeps the `[VOORBELASTING-RISK]` warning up. Meanwhile `attach-invoice` turns a photo into a real, confirmed, accountant-shared invoice. So for a missing receipt the honest actions are "boek als kosten zonder BTW-aftrek" or "bon toevoegen", not "park". The park is for lines where the owner cannot say whether it is business at all. Offer both as alternatives in the sheet; do not ship `bon_ontbreekt` as a reason chip.
4. **Offer an "ask the counterparty" alternative.** `RemovalAlternative` is `creditnota | undo-payment | ask-accountant` (`invoice-removal.ts:49-53`); add an `ask-counterparty` kind. For the Altena case the real answer is a specificatie from the wholesaler — [BANK-VRAAG] concedes this in its own weakest point and then does not design it. First alternative in the sheet: **"Vraag om een specificatie"**.
5. **Not on `auto` cards.** There the app believes it knows; the honest actions are confirm or Ontkoppelen.
6. **No bulk, no cap, no mandatory reason.** `archive-reason.ts:20-23`: a forced reason produces an answer worse than no answer, and a cap strands an owner with a genuinely messy statement. Instead: show the running count and euro total on the button, and above ten open parks in a quarter say the honest thing — *"Je hebt 10 vraagposten open. Bel je boekhouder, of loop ze samen door — een lijst van veertig leest niemand."*
7. **One open park per line** (unique index), and the route is idempotent on conflict.

---

## 9. RECOMMENDATION

**Build it — narrower, in two releases, and ship the honesty base first.**

Not "do not build": the state gap in §1 is real, and the one thing nothing else in the app provides is §2 — a way to revoke the app's licence to guess a category and to send a statutory demand on a line the owner has flagged. That is a data consequence, it is the owner's actual point, and neither Negeren-with-a-reason nor "leave it pending" delivers it.

Not "build as proposed": all three proposals shipped a false claim in their own text (P1's warning in the wrong array; P3's readiness-board risk titles; every proposal's quarter-scoped tab presented as durable), and all three chose derived state, which the attacks killed.

### Release 1 — the honesty base. No new button.

Every item here helps *all* unresolved bank lines, is independently correct, and is what makes Release 2 non-perverse.

- The missing `ClosingPackageWarning` code for unresolved/uncategorised bank lines, pushed in `summarizeClosingPackage`, sorted first, with a CSV. Confirmed gap: seventeen warning codes and none for this.
- Interpolate warning messages (or the counts) into `quarter-close.ts`'s `accountantBody`; count non-dormancy correctly.
- Reason enum + `bank.ignored` / `bank.restored` audit rows on `/api/bank/ignore`, and render the reason on the Genegeerd list.
- Quarter-scope `readiness.ts:164`'s fix href.
- Render `decideRemoval`'s `ask-accountant` alternative (`FacturenClient.tsx:1621-1630`). Four lines; closes an existing empty promise rather than adding a second.
- The IBAN/counterparty history panel on the bank card.
- A triage prompt over the **existing** `not_found` backlog — on day one the new tab reads 0 and Genegeerd holds the real money. *"43 genegeerde regels, 12 boven EUR 500 — wil je daar iets bij zetten?"*

### Release 2 — the button.

`bank_line_parks` with stored lifecycle and snapshot · owner-only RLS · the cross-quarter sixth tab rendered **from the table** · `Terugzetten` on the card · three audit actions · park exclusion in `bank-auto-categorize`, `bulkApply` + its count, and the `amount_only` tier · `trainMemory` suppression · disjoint readiness counting (debit risk, credit via the existing blocker, both in the subscore) · the fifth soft filing blocker · the final-tier-only reminder brake behind an owner-confirmed candidate with a fail-closed pre-read and a visible state on the invoice reminder panel · `bad-debt` annotation in both detectors · `import-health` needs-review · the CSV with stable ids and resolved rows · orphan handling in `delete-statement` · `account-export` + `retention`.

### Deliberately out of v1

- **The accountant read policy on anything bank-shaped.** It would be the first standing live read across a boundary whose Dutch rationale is written down (`accountant.repository.ts:80-98`). The ZIP is an owner-initiated download; a policy is not. Not in v1.
- **The in-app answer box.** [BANK-VRAAG]'s own weakest point calls it the single point of failure of the whole feature, and it is the only genuinely new surface with no precedent to copy. The real-world return channel is a per-client vragenlijst the accountant fills and sends back — which is why the CSV needs stable ids. Design the round trip in v2; do not fake it in v1.
- **Message + email at tap.** 38 taps on a PSP statement is 38 unbatched Sunday-night emails (`/api/messages` has no rate limit), and both previews truncate the question out (80 chars for the notification, hard-titled *"Nieuw bericht"*; 120 for the mail). If pushing at tap ever ships, it ships as one daily digest.
- **Any bad-debt suppression, any hard readiness blocker, any hard filing gate, any deadline escalation** (there is no owner-facing deadline surface to hang it on — `getAangifteDeadline` renders only on `AccountantWerkboard.tsx:111`).
- **Clearing the category on park.** See §3.
- **The evidence jsonb blob.** Unvalidated, will drift from `bank-matching.ts`, and the attack showed the frozen candidate figures going stale in a week and contradicting the ZIP's own `betaald/` split. Store the identity, re-derive the money live — the ZIP is `no-store` and rebuilt on every download, so a live read is free.
- **`parked_at`-driven nudges, bulk, and the reversal pair.** Named, not solved: a returned direct debit or chargeback is two lines netting to zero that the dedup key (`bank-ingest.ts:116-127`) cannot pair, and parking one half leaves a permanent phantom. After bank fees it is the commonest genuine "I don't know what this is". v2.

---

## 10. THE OPEN DECISIONS — yours, not mine

1. **The label.** I recommend keeping your words, in owner-voice: **"Ik regel dit zelf"**, with "je boekhouder" appearing only in the sentence that describes what travels in the kwartaalpakket. [BANK-VRAAG] wanted "Vraag aan mijn boekhouder"; I think that over-claims in v1. But it is your promise to make.
2. **The fiscal default for a parked debit: EUR 0, or gross kosten with EUR 0 voorbelasting?** Nobody raised this and it changes your IB. EUR 0 understates the cost and overstates profit; gross kosten is the prudent treatment for a business payment without an invoice and is already expressible today. I would default to EUR 0 (never guess) and offer "boek als kosten zonder BTW-aftrek" as an alternative in the sheet — but the default is a fiscal preference, not a design call.
3. **The reminder brake at all.** My rule is final tier only, owner-confirmed candidate only. You may prefer no brake plus louder copy — the trade is a possibly-wrong WIK aanmaning to a customer versus a possibly-unchased receivable, and it is your customer relationship.
4. **Whether the accountant ever gets a read policy on bank data**, or stays ZIP-only forever. This is the boundary you wrote the rationale for.
5. **Whether the free-text note exists at all**, given it will contain third-party personal data and collides GDPR erasure with the seven-year bewaarplicht. I would ship the enum in v1 and the free text in v2 with an erasable-field rule.
6. **What happens when the accountant leaves.** `accountant_clients` rows are deletable by either party. Open parks addressed at a departed accountant, and answers already written by them, need a policy: re-target, or freeze and label.
7. **Whether the existing `not_found` backlog gets triaged or left alone.** Triaging it delivers most of this feature's value to existing users on day one; leaving it guarantees two permanent, differently-audited set-aside populations.
8. **Whether "alles gecategoriseerd" may ever read green with an open park.** I have kept it counting the line, which means the categoriseren nag never fully stops. That is deliberate (no false reassurance), and it is the reason some owners will still reach for Negeren — which is exactly why Release 1 ships first.

---

# Bijlage A — wat het panel vergat (completeness-criticus)

Zestien punten die in geen van de drie ontwerpen voorkwamen. Een deel is in de synthese hierboven verwerkt; de punten die dat **niet** zijn, zijn de interessantste — met name de vraagpostenrekening als *categorie* in plaats van als state (A1), de asymmetrie van de boete-richting bij een geparkeerde CREDIT (A2), de Belastingdienst als lezer van het park-dossier (A6), en het omkeringspaar (A11).

**A1. The profession's own solution — a vraagpostenrekening / "nog uit te zoeken" suspense category — was never considered. `SELECTABLE_CATEGORIES` (src/lib/bank-categories.ts:34-42) has seven values and no such key; `PNL_ROLE` (:57-71) already has an 'excluded' role for transfer/prive/tax. Modelling the park as a CATEGORY rather than a new state was never put on the table by any of the three proposals.**

Every Dutch accountant already has this account, so it is the one framing the recipient recognises. It also comes with the machinery for free: an excluded category is already out of omzet/kosten/BTW by an existing code path (financial-result.ts:369-378), an unconfirmed excluded line is ALREADY counted by unreviewedExcludedCount with a working quarter-scoped deep link (readiness/route.ts:121-129, readiness.ts:340-362), and the line stays in every pending-scoped queue. Whether or not it wins on the merits, its absence means the design space was searched only along the axis of "new flag vs new status vs new table" — never "new category value".

**A2. Nobody said out loud that "worth EUR 0" is a chosen under-declaration, and that the penalty direction is asymmetric. Under-declaring BTW produces a naheffing plus belastingrente and possibly a boete; over-declaring is recoverable via suppletie or the next return. All three proposals default a parked line to EUR 0 in the aangifte and market that as money-neutral.**

For a parked CREDIT, EUR 0 is a structural under-declaration of omzet in a filed return — the expensive direction. The prudent bookkeeping default (declare an unidentified receipt at the high rate until proven otherwise, then correct downward) was never weighed against silence, and no proposal names the asymmetry in its copy. "Je cijfers veranderen niet" is presented as the safe option when it is the penalised one.

**A3. The voorbelasting treatment of a parked DEBIT is never stated. Without a factuur there is no aftrek (art. 15/35 Wet OB), so the correct treatment of an unidentifiable business payment is a GROSS cost with EUR 0 BTW — which is exactly what a bare bank line categorised 'kosten' already produces (bank-categories.ts:62-70: "the financial engine writes no BTW for a bare bank line").**

Every proposal treats "no category" as the honest state and EUR 0 kosten as neutral. It is not: the money left the account, so EUR 0 kosten OVERSTATES profit and inflates income tax, while the honest treatment (gross cost, no BTW deduction) is already representable today. The panel attacked the risk of a parked line wrongly counting, and nobody attacked the risk of it wrongly not counting.

**A4. The app already tells the owner "Onder EUR 1.000 — verwerk dit in je volgende aangifte" (QuarterlyOverview.tsx:427, btw-filing.ts:30-32) and there is no mechanism anywhere to do that. Every figure is date-scoped (compute-result-range.ts:113-119, aangifte/route.ts:91-95), so resolving a park changes the OLD quarter's numbers forever and can never appear in a later return.**

The post-filing exit path all three proposals lean on is advice the app cannot execute. Nobody defined the artifact a resolved park actually needs — a suppletie worksheet, or a carry-forward line the next aangifte can carry — so the owner is told to do something in the Belastingdienst portal that the app neither produces nor records. The divergence banner also only fires if the owner visits that quarter's screen.

**A5. The bewaarplicht lifecycle of the question/park record itself is undefined. src/lib/retention.ts computes deletion eligibility from the fiscal-year boundary (art. 52 AWR) against an account-level deletion_requests row; no proposal adds bank_line_questions / park_reason to that path, to the deletion sweep, or to per-record retention — only to account-export.**

A note explaining a bank mutation IS part of the administratie and is bewaarplichtig for seven years, so it must outlive the bank row (all three proposals let delete-statement destroy it, or make it an orphan nobody can reach). Conversely free-text vraag_text will contain third-party personal data ("lening van mijn broer", a customer's name) and a GDPR erasure request now collides with a retention duty. Neither direction was modelled.

**A6. The tax authority as a READER of the park file was never modelled. In a boekenonderzoek the park record cuts both ways: a timestamped "ik heb dit gemeld en gevraagd" is the owner's best defence against an opzet/grove-schuld finding, while forty lines reading "weet ik niet" is a written admission that the administratie does not meet art. 52 AWR.**

This is the stakeholder that decides how much integrity the record needs. If it is exculpatory evidence it must be append-only, timestamped, immutable and exportable — which rules out derived state, rules out a reason column that later writes can silently overwrite, and rules out a best-effort audit row as the only durable trace. Every proposal chose its storage without asking who might one day read it against the owner.

**A7. Nobody asked what an accountant actually does with an owner question. They work in Twinfield/Exact/SnelStart, import the mutations there, and the real-world return channel is a per-client, per-period vragenlijst (a spreadsheet or an email thread), not a web form. The CSV is the right instinct; no proposal designed the ROUND TRIP — a stable line id plus a fillable antwoord column the accountant can send back.**

Proposal 3's only invented surface is an in-app answer box, which its own weakestPoint calls the single point of failure of the whole feature; proposals 1 and 2 have no return path at all. A machine-readable, fill-and-return CSV would be cheaper than any of them and matches how the recipient already works. Without it the answer arrives by phone, and the owner has to re-enter it through the one path (categorize) that several attacks show destroys the question.

**A8. "The accountant leaves" is an undefined transition. accountant_clients rows can be deleted by EITHER party (accountant_clients_insert_consent.sql:56-59). Nothing defines what happens to an open question, to an answered-but-unread answer, or to an accountant read policy keyed on is_my_accountant_client when the link disappears.**

Switching accountants mid-quarter is normal, not an edge case. In-flight questions silently become addressed to nobody, answered_by points at a principal with no access, the whole delivery channel voids with no notification to either side, and there is no re-target ("deze 6 vragen liggen bij je vorige boekhouder"). A feature whose entire value is delivery to a named human must define what happens when that human is gone.

**A9. The cheapest resolution is data the app already stores and never shows: counterpart_iban. ibanMatches exists and an IBAN hit is a CERTAIN-tier signal (bank-matching.ts:62, :552); the column is populated on import (bank-import.ts:178) and read by the matcher and by search — but it is never surfaced on the card, and nothing offers "your last 6 payments to this IBAN were 'kosten'".**

No proposal includes a pre-park resolution step, so the button becomes the path of least resistance for lines the app could identify itself. For the prompting case the honest first move is "this IBAN is Aardappelgroothandel Altena, here is what you did last time, here are your open invoices from them" — resolution, not delegation. Every euro of accountant time this feature bills is a euro the IBAN lookup might have saved.

**A10. The population that already exists at install time is unmodelled. Every proposal is greenfield. Nobody asked what happens to the rows already sitting at status='not_found' — no reason, no audit row, no accountant visibility — which is verbatim the "lijst zonder geheugen" complaint archive-reason.ts:4-23 was written about, one subject type over.**

On day one the new tab reads 0 and the old Genegeerd tab holds the real backlog. A triage prompt ("43 genegeerde regels, 12 boven EUR 500 — wil je daar iets bij zetten?") plus a reason column on /api/bank/ignore would deliver most of this feature's value to existing users immediately, and it appears in no proposal. Shipping the new button without it also guarantees two permanent, differently-audited set-aside populations.

**A11. The reversal pair is never mentioned — in any proposal, attack, or ground-truth finding. A returned SEPA direct debit, a chargeback, a bounced payment: two lines that net to zero, often days apart. The dedup key (date, amount, description, counterpart, reference — bank-ingest.ts:116-127) cannot see the pair.**

After bank fees this is the commonest genuine "I don't know what this is" line, and it is the one case where parking one half is actively wrong: resolving that half alone double-counts, and parking one half leaves a permanent phantom that will never reconcile against anything. A question whose true answer is "this is the reversal of that line three days later" cannot be expressed in any of the three data models.

**A12. "Bon ontbreekt" — a reason chip in all three proposals — has no resolution path. The resolution it implies is a document upload, but nothing wires a park to the intake flow, to /api/bank/attach-invoice (the one existing hatch that RESOLVES rather than hides, per its own header), or to the supplier-cadence "de factuur die niet kwam" signal.**

The most clickable reason dead-ends. attach-invoice already turns an unexplained payment into a real, confirmed, accountant-shared invoice from a photo — for a missing-receipt line that is the correct action and it is a better outcome than any question. Offering "bon ontbreekt" without routing to it teaches owners to delegate a problem they could have closed in two taps.

**A13. The learning direction is inverted and nobody specified it. counterpart_memory is trained by the owner's guesses (categorize trainMemory), and several attacks show a park being categorised by memory or by a bulk sweep — while an ACCOUNTANT's answer, the highest-quality evidence in the system, trains nothing.**

Two concrete rules are missing from every proposal: a park must suppress trainMemory (one uncertain line must not teach the classifier), and an answered park should be the one write that DOES train it. Without the first, parking poisons future auto-categorisation; without the second, the same question gets asked every month for a recurring line.

**A14. An "ask the counterparty" alternative is missing. RemovalAlternative is `creditnota | undo-payment | ask-accountant` (invoice-removal.ts:49-53) — there is no ask-supplier / ask-customer kind, even though the app holds the counterparty's email and already sends mail. For the prompting EUR 30,49 the real answer is a specificatie from the wholesaler, which proposal 3 concedes in its own weakestPoint and then does not design.**

Routing to the accountant is the expensive answer to a question the counterparty can answer for free and definitively. If the alternative vocabulary gains one kind and the sheet offers "Vraag om een specificatie" first, a large share of these lines never becomes anyone's open question.

**A15. The null option is never argued. Three cheap non-features cover most of the value with no new state: (a) the missing closing-package warning for unresolved/uncategorised bank lines — a confirmed gap that gives the accountant visibility for ALL such lines, parked or not; (b) a reason column plus an audit row on the existing /api/bank/ignore; (c) rendering the dead ask-accountant alternative (invoice-removal.ts:135) into the messages channel that already sends email. Each proposal treats the button as given and never argues against building it.**

All three proposals name the same weakest point — the accountant still cannot see the line and cannot answer it in the app. If that is true, the button's name is the second instance of the exact empty promise the codebase already committed once, and the honest recommendation is: ship (a), (b) and (c) now, and do not ship the button until the return path exists. That recommendation was never on the table, so the decision is being made without its cheapest competitor.

**A16. Under kasstelsel, post-filing retro-correction is not an edge case but the default, and nobody said so. The bank line's own date places an invoice's BTW in a quarter (kas-payment-events-fetch.ts:137-159), so resolving a park months later dates that BTW into the quarter of the bank line — which is almost always already filed. resolveSchemeForQuarter is also per-quarter (vat-scheme.ts:32-41), so a park spanning a factuur→kas switch changes which dating rule applies to it.**

For a kasstelsel owner the soft filing blocker plus "nothing is blocked, the figures move" adds up to a guaranteed suppletie/carry-forward obligation on every park resolved after the 31st, not an occasional one. Only undatedPaidCount double-reporting was discussed; the systematic retro-movement, and the scheme-switch case, were not.

---

# Bijlage B — de fatale aanval

Dit is het bewijsstuk onder de belangrijkste ontwerpkeuze in §2 (*state wordt opgeslagen, niet afgeleid*). Het is geen bug in een implementatie — het is structureel: een afgeleide state heeft geen overgang om op te auditen of te notificeren.

- **Lens:** data-corruption · **severity:** critical
- **Getroffen voorstel:** [BANK-VRAAG-BOEKHOUDER] — "Vraag je boekhouder": één notitiekolom, geen vierde status. Parkeren is Genegeerd-mét-geheugen op een regel die 'pending' blíjft, plus de kaart-reconciliatie.csv-truc voor de aflevering.

**Scenario**

THE CATEGORISEREN TAP SILENTLY DESTROYS THE QUESTION. 12-02-2026, €1.847,00 debit, counterpart "MEDIAMARKT SAARLOUIS". Owner cannot tell whether it is the shop laptop or his son's console, so he taps Vraag je boekhouder → park_reason='prive_of_zakelijk', audit row bank.parked. Line leaves "Geen factuur", appears in "Voor je boekhouder" (1). 18-02: the app's own nudge sends him to /dashboard/bank/categoriseren. The parked line is IN that queue unchanged — the todo query is status='pending' + invoice_id IS NULL + category IS NULL (categorize/route.ts:122-141), which is exactly the parked shape, and CategoriseClient.tsx renders no park badge and no reason (the proposal edits only BankClient.tsx). He taps "Bevestigen" on the pre-selected suggestion 'prive' (CategoriseClient.tsx:360-368 → POST → categorize/route.ts:229 writes category_confirmed: true). Result, all at once: (a) the derivation's `category_confirmed = false` term goes false → the line vanishes from "Voor je boekhouder", from vragen-boekhouder.csv and from the owner_parked warning; (b) NO bank.park_cleared row is written — only /api/bank/park emits those — so audit_logs holds an open bank.parked with no closing event and an auditor asking "what happened to this question" gets no answer; (c) park_reason='prive_of_zakelijk' still sits in the row, so the DB and the app now disagree about whether a question is open; (d) 'prive' is pnlRole 'excluded' (bank-categories.ts:56-72), so €1.847,00 leaves kosten AND BTW entirely, and because category_confirmed=true it is invisible to unreviewedExcludedCount (readiness/route.ts:121-129) too — the [AUTO-EXCLUDE-REVIEW] hazard with the one countervailing signal switched off. The owner's recorded "I don't know" was converted into a confident exclusion by the fastest path through the app, and neither party is told. This is structural, not a bug: a derived state has no transition to audit or notify on, and the proposal's headline claim ("no clearing code anywhere", "not one of those files is edited") is precisely what forbids the fix.

**Voorgestelde fix**

Abandon the derivation. Store the park as a fact: `parked = park_reason IS NOT NULL`, and have each resolution writer NULL it with a logged bank.park_cleared event (apply_bank_payment, attach-invoice, categorize POST, unlink, pay-toggle). That is 5 small edits and it kills the minimal-reuse angle — which is the honest price. Minimum viable interim: select park_reason in both categorize queues, badge it in CategoriseClient with the reason label, and make the POST clear park_reason + emit bank.park_cleared.
