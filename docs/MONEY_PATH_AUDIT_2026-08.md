# Money-path audit — August 2026

_A measured inventory of every module that touches an amount: what is proven, what is guarded but
not proven, and what is neither. Written because the product is about to be priced at € 49–149 per
office per month, and a bookkeeping app that is wrong about money is worse than no bookkeeping app._

**Method.** Every module under `src/lib` that mentions an amount, btw, a cent, a commission or a
settlement was classified by two facts that can be measured rather than judged: does a test import
it, and does it perform I/O. Nothing here is an impression of code quality.

---

## 1. The headline

**The arithmetic is unusually well guarded. The assembly around it is not.**

The pure engines that compute money are tested to a standard well above what this price point
implies. Every module that turns those engines into what a user sees talks to the database, has no
pure seam, and is therefore covered by source-level gates or by nothing.

That is not a new discovery — `RECONCILIATION_TRIANGLE.md` already says it: _"the pure engines are
unit-tested, but a live upload → DB → `/api/result` pass is the final proof."_ What this audit adds
is the size of it: **roughly 2,300 lines of money-carrying assembly with no behavioural test.**

## 2. Layer 1 — the pure engines: proven

| Module | Assertions |
|---|---|
| `triangle.ts` | 40 |
| `statement-reconcile.ts` | 36 |
| `turnover.ts` | 37 |
| `card-reconcile.ts` | 33 |
| `ubl-export.ts` | 31 |
| `draft-totals.ts` | 27 |
| `invoice-discount.ts` | 27 |
| `bank-statement-balance.ts` | 27 |
| `snelstart-mapping.ts` | 25 |
| `vat-scheme.ts` | 16 |
| `invoice-totals.ts` | 15 |
| `bank-reconciliation.ts` | 15 |
| `btw-reconcile.ts` | 14 |

Beyond the counts, three structural guards are worth naming because they catch the class of defect
that unit tests miss:

- **`[CENT]`** — cent rounding may exist in exactly one place (`invoice-totals.round2`). It was
  written after five different rounding implementations produced a ledger saying 4,52 and an
  e-invoice XML saying 4.51 on the same line. It fired twice during this audit's own work and was
  right both times.
- **The refusal principle** — the system blocks rather than guesses: an unknown btw rate stops an
  import instead of defaulting. For an office carrying the liability, this is the actual product.
- **`WAARHEID_AUDIT_2026-07.md`** — a dedicated review of `/dashboard/waarheid` found 15 defects,
  6 of them critical, including two of exactly the feared kind: _"the two engines disagreed on what
  a card payout is"_ and _"a failed PIN-ledger read made the reconciliation look cleaner than it
  was"_. **All 15 are marked fixed**, each with the mechanism named.

## 3. Layer 2 — the assembly: guarded at best

Every module below carries money and is reached by **no importing test**, because each performs
I/O against Supabase and has no pure seam to assert on. "Gates" are source-level assertions in
`lifecycle-gates.test.ts` — they pin structure, not behaviour.

| Module | Lines | Gates | What rides on it |
|---|---|---|---|
| `compute-result-range.ts` | 485 | 1 | The reconcile engine over an arbitrary window — behind `/dashboard/waarheid` and the result screens |
| `incasso-settle.ts` | 415 | 3 | Direct-debit settlement |
| `cash-settle.ts` | 414 | 3 | Cash settlement |
| `btw-rate-split-fetch.ts` | 153 | 0 | Splitting turnover across btw rates |
| `bad-debt-collect.ts` | 153 | 0 | Bad-debt relief |
| `vat-exemption-collect.ts` | 147 | 0 | Exemption handling |
| `turnover-book.ts` | 126 | 0 | Booking the day's turnover |
| `bank-recon-map.ts` | 104 | 0 | Mapping reconciliation results |
| `bank-auto-categorize.ts` | 99 | 0 | Learned categories applied to bank lines |
| `regime-collect.ts` | 72 | 0 | btw regime resolution |

`bank-auto-confirm.ts` (4 gates), `fair-use-gate.ts` (3), `bank-ingest.ts` (2), `bank-tx-links.ts`
(1) are in the same category with more structural cover.

**The concentration worth naming:** `compute-result-range.ts` is 485 lines, sits behind the screen
called _"je financiële waarheid"_, and has one source gate and no behavioural test. It is the single
largest untested money surface in the repo.

## 4. What was fixed during this audit

**`plan.ts` — the offer a buyer reads at the moment of commitment.** The only pure money-facing
module in `src/lib` with no test file. It is 85 lines of strings, which is exactly why it was
skipped, and exactly why it matters: `OFFER_NL` is pasted wherever someone is asked to bind
themselves, and the checkout makes them accept the Terms in the same flow. Its own header records
the defect it was built to prevent — the billing branch carried `priceLabel: "€ 12,00"` while the
binding terms published € 12,99, and ambiguity in your own general terms is construed against you.
Now tested (`plan.test.ts`, 7 tests): every amount must be derived, both offer sentences must quote
the same figure, no euro amount may appear that is not a published price, the three trust promises
must survive, and the inactive accountant band must never be advertised as live.

**`bank-ingest.ts` — a spreadsheet dropped on the bank importer.** Carried as "latent" in
`RECONCILIATION_TRIANGLE.md`. The path already detected the spreadsheet and told the owner, by
name, to import it via Dagomzet — then stored it anyway as `doc_type: "bankafschrift"`, `shared:
true`, **with its `content_hash`**. The owner follows the advice, uploads the same bytes to
Dagomzet, and byte-hash dedup rejects them as already seen. The app pointed at the right door and
locked it on the way past. Nothing errors; the day's turnover simply never arrives, the file is
filed as something it is not, and the boekhouder sees a kassa export in the bank section of
`/brug`. Fixed: no storage row, no hash claimed, nothing shared. Guarded by
`[SHEET-NIET-OPSLAAN]`, which was verified to fail when the fix is reverted.

## 5. The real risk is coverage, not correctness

`eft-parser.ts` normalises **one** acquirer format: Equens CTAP _"TOTALEN RAPPORT / EIND TOTALEN"_.

An office whose clients use CCV, Worldline, Mplus, Lightspeed or unTill gets nothing today. The
failure in the first sales conversation will therefore not be "your figures are wrong" — the
figures are the strongest part of this repo. It will be **"my files do not go in"**.

`MARKTPOSITIE_2026.md` stop point 6 states the test exactly: collect 10 real Z-reports and 10
terminal settlements from 10 businesses; if fewer than 6 parse without new code, this is a service
(route D), not a product. That remains the single most informative thing that can be done, and it
needs real files, not more code.

## 6. What would close the remaining gaps, in order of value

1. **A live `upload → DB → /api/result` pass.** The proof `RECONCILIATION_TRIANGLE.md` names as
   final and that no amount of unit testing substitutes for. Needs a running Supabase.
2. **A pure seam in `compute-result-range.ts`.** Extract the windowing and aggregation from the
   fetching, the way `truth-lens.ts` was extracted during the July audit — the same move, on the
   larger module, with the same payoff.
3. **Broaden `eft-parser.ts`.** Blocked on real settlement files; cannot be invented.
4. **Behavioural tests for `cash-settle` / `incasso-settle`** (829 lines between them), which will
   likely need the same extraction as (2) first.

## 7. The honest verdict

For € 49–149 per office per month, the arithmetic is defensible today and better than the market
study credits: the daily close is a real screen, `card-reconcile` is wired into `turnover.ts`,
`triangle.ts` and `compute-result-range.ts`, and every pure engine behind it is tested.

Two things are not yet true, and neither is hidden in this repo — both were already written down
before this audit and are confirmed by it. The system has never been proven end-to-end against a
live database, and it reads one acquirer format. The first is a day of work with credentials. The
second is ten real files away, and no more code will substitute for them.

---

## 8. Re-measured, 30 August 2026 — §6 items 2 and 4 worked, by the same method

Same two questions as §0: does a test import it, and does it perform I/O. Nothing below is an
impression.

**§6 item 2 was already done.** `result-range-assemble.ts` exists (459 lines, 17 tests) and
`compute-result-range.ts` is down to 268 lines. The extraction this audit asked for happened in
commit 8b90230, which named the problem exactly: _"The engine behind 'je financiële waarheid' had
no behavioural test, and could not have one."_

**§6 item 4 splits in two, and one half was reachable.** The I/O halves of `cash-settle.ts` and
`incasso-settle.ts` still need a database. But the *decisions* they carry do not, and those were
the untested part that mattered:

| Decision | Where | What a wrong answer does |
| --- | --- | --- |
| `belongsToIncassoSupplier` | `incasso-settle.ts` | books an invoice nobody paid |
| `incassoClientKey` | `incasso-settle.ts` | the idempotency lock; an unstable key double-books |
| `pnlRole` / `categoryLabel` | `bank-categories.ts` | sends a confirmed bank line to the wrong side of the P&L, or nowhere |
| quarter boundary | `snelstart-queue` vs `kasboek` | puts a euro in the wrong btw-aangifte |
| `buildPaymentLinkRows` | `bank-tx-links.ts` | a NULL `amount_applied` re-opens a settled invoice at its full total |

The last one needed the same extraction as item 2, on a module this audit did not list:
`bank-tx-links.ts` writes the rows `invoices.amount_paid` is derived from, and everything in it
did I/O except that single decision. It is `buildPaymentLinkRows` now — same logic, testable.

Each of the five was verified by breaking it and watching the new test fail: a drifted quarter end,
a weakened amount guard, a removed honesty line. A test that has never failed has not been shown to
work.

**What this did NOT change, and the reason to be careful reading it.** Two claims in §5 and §7
stand untouched, and they are the two that matter commercially:

* the system has still never been proven end-to-end against a live database;
* `eft-parser.ts` still reads one acquirer format.

Neither is a coverage problem and neither is closed by more tests. §6 items 1 and 3 remain exactly
as written.

**One correction to how §5 reads.** "The real risk is coverage, not correctness" is right about the
assembly and misleading about the whole. Coverage here is not organised by module: it lives in
source-level gates in `lifecycle-gates.test.ts` and in files named after the GUARD rather than the
module — `credit-backstop.test.ts` and `ex-incl-fix.test.ts` test functions that live in `ai.ts`,
which itself has no `ai.test.ts`. Counting test files per module therefore understates it. Three of
the modules that looked untested on that count turned out to be covered, and one file written on
that assumption had to be deleted again. Measure by "which decision is asserted", not by "which
file has a neighbour".

---

## 9. The four defects the adversarial pass found, closed 31 August 2026

§8 measured the *coverage* gap. This section is the other kind of finding: places where the code
was wrong, not merely unwatched. All four came out of a fan-out audit over the money path whose
findings were then verified one at a time against production data before a line was changed —
because a plausible finding that nobody checked is how an audit starts costing more than it saves.

Two of the four are gone. Two were real in shape and reachable by nobody today; both are recorded
here as *measured*, not as *dismissed*.

| # | Where | What it did | State |
| --- | --- | --- | --- |
| A | `auto-incasso.ts` | an auto-collection the owner reversed was re-booked within the hour, forever | **fixed** |
| B | `cash-settle.ts` | a failed read was misread as "the column is gone", deleting real cash movements | **fixed** |
| C | `cash-settle.ts` | an unreadable invoice direction is guessed, silently | **guess kept, now reported** |
| D | `cron/reconcile` | an owner who paid only part in cash was invisible to the hourly pass | **fixed** |

**A — the undo that did not survive the hour.** The idempotency key is derived from the invoice and
its vervaldatum, so it is identical on every run. But it is *stored* in the `bank_tx_invoices` row,
and the undo deletes that row — so the correction removed the very record that made the booking
unrepeatable. Nothing in the undo path knew what an incasso was; nothing in the settle path read
the marker it writes itself. `amount_paid` is clamped, so the books stayed self-consistent while
asserting a payment that never happened, and under the kasstelsel the restored `payment_date`
decided the quarter — voorbelasting claimed on money that never left the account.

**B — the probe that could not tell two things apart.** Documented in full in its own commit. The
short version: `settlement_id` exists in production, so the deploy window the fallback was written
for has closed, and every `false` the probe could still return was a false one — each costing two
hard-deleted cash movements and a third re-dated across a possible quarter end.

**C — why the guess stays.** Refusing to guess is worse than guessing here, and that is worth
writing down so nobody "fixes" it later: `computeCashSettlementSync` deletes every linked entry
whose invoice is absent from the paid set, so dropping an invoice with an unreadable direction
would *remove* a real cash movement rather than merely mis-sign it. The column is nullable with no
default and no check constraint, and is clean today — 605 invoices, 586 incoming, 19 outgoing, not
one null. The report is what will say the day that changes.

**D — the hole in the safety net.** "Who has cash to reconcile" is a definition written once and
spelled twice; the second spelling, in the cron, had only half of it. The half it lost was exactly
the case the cron exists for — the owner whose synchronous reconcile failed and who therefore has
no drawer entry to be discovered by.

### What this changes about §5 and §7

Nothing in §7. The verdict there is about the arithmetic and it still holds; none of these four was
an arithmetic error. All four were the same shape, and it is the shape §5 predicted: **a decision
taken correctly in one place and not read in another.** A key that is stable but stored where an
undo deletes it. A probe whose two possible failures mean opposite things. A definition spelled
twice. That is the assembly layer, not the engines — which is precisely where §3 said the risk was.

§6 items 1 and 3 remain open and are still not closable from here: one needs a live database pass,
the other needs real acquirer files.

---

## 10. One signature, hunted deliberately — 31 August 2026

§9 ended on the observation that all four defects shared a shape: **not an arithmetic error, but a
decision taken correctly in one place and not read in another.** That is a searchable signature, so
this pass searched for it on purpose rather than asking again for "bugs" — one seam class per
reader (idempotency keys, markers, definitions spelled twice, capability probes, undo paths,
coercions, rounding, period assignment, truncation, owner scoping), each finding then put to three
independent skeptics instructed to refute.

The refute rate is the useful number: **most findings did not survive.** Nothing below is included
because an agent asserted it.

### Fixed, each verified against production before a line was changed

| What | Where | Why it was the signature |
| --- | --- | --- |
| A reversed auto-incasso re-booked hourly | `auto-incasso.ts` | the idempotency key was stable, and stored in the row the undo deletes |
| "Opnieuw inlezen" erased the guard for it | `reimport-carry.ts` | the marker that replaced the key was not on the carry allow-list |
| Four more probes read "busy" as "column gone" | `column-probe.ts` | one question, five spellings, five copies of one bug |
| € 5.321,68 of phantom discrepancy | `money-invariants.ts` | the write path was fixed; the rows it left were not |
| Three audit checks that could never fire | `scripts/money-audit.ts` | the checks were right; the caller fed them two columns short |
| Auto-collected AND dunned, on the same invoice | `cron/payment-due` | "which supplier collects this?" was spelled twice, and the spellings disagree |
| A slow query moved cash payments into the wrong BTW quarter | `kas-payment-events-fetch.ts` | the probe defect a sixth time, wearing a try/catch instead of a boolean |
| The board warned about a link the owner made by hand | `bank/unlink`, `bank/confirm` | a marker with one writer, one clearer, and two paths that should have cleared it |
| Two reads that said "nothing here" before finishing | `verkoop/page.tsx`, `incoming/missing` | a recovery written, argued for, and unreachable because the read never threw |

The payment-due one is the sharpest of the set, because the disagreement is
load-bearing in both directions: `belongsToIncassoSupplier` falls through to the
supplier's name key — deliberately, since that is what reaches invoices imported
before the supplier registry existed — while the reminder ladder matched on
`supplier_id` alone. An invoice in that gap is collected by the bank *and* claimed
by the ladder, and the route's own comment already said what that costs: "de
eigenaar maakt dan een tweede keer over en moet dat bij zijn leverancier
terugvragen." Two invoices were sitting in it.

The probe cluster is worth reading as the lesson. I fixed ONE of them by hand, wrote it up, and the
signature-hunt then found the same eight lines in four more files — including one whose own
`[NO-SILENT-EMPTY]` comment forbids exactly the outcome its probe produced, and which defended the
read one line *below* the probe that gates it. A rule guarded by a hand-written list is not
guarded; a rule with five spellings is five rules.

### Verified and NOT fixed, with the reason

**The turnover import can overwrite a day the owner already claimed.** `daySourceConflict`
(`till-day.ts:296`) is the guard for "one day, one source". It has exactly two readers — both manual
doors (`till/sale`, `turnover/day`). The single writer, `turnover-book.ts:105`, upserts on
`(user_id, turnover_date)` without consulting it; `till-book.ts:95` says so in its own comment. So a
Z-report import can claim a day that already carries hand-entered cash `omzet` rows, and the
covered-day rule then skips those rows as presumed duplicates — the hand-entered turnover leaves the
books silently.

Structure verified here (two readers, one writer, and the writer's own admission). Not fixed for two
reasons, both worth stating rather than quietly deferring: it needs a product decision (should an
import refuse such a day, warn, or merge — and what does the owner see?), and another session was
editing this exact area the same night, including the covered-day rule itself. A collision in cash
accounting bought nothing that waiting does not.

**A concurrent partial creditnota can pass a gross-only database guard.** Three skeptics
independently traced this end to end: `creditnota_partial.sql:40` drops the unique index that
serialised this path, and the replacement trigger sums document totals rather than per-line
quantities, while the per-line ceiling is enforced in the route between a read and an insert. Two
simultaneous requests for the same line both land.

Carried here on skeptic agreement, NOT on my own end-to-end reading, and that distinction is the
point of writing it down. It also needs a migration, and a migration against a production database
while nobody is awake is not a thing to do on an agent's say-so.

### For the owner, not for the code

The revived duplicate check finds **eleven groups of live purchase invoices** sharing a supplier and
an invoice number modulo punctuation — one of them three copies — including the pair the check was
written for: `26/1876` and `26 / 1876`, same date, same € 665,02, both paid.

Ten of the eleven were created between 5 and 19 July, and `possible-duplicate-collect.ts` landed on
19 August. So they are residue and not a detector failure — the detector did not miss them, it did
not exist. Each surviving copy counts its total into kosten and its BTW into voorbelasting a second
time, so this is real exposure and not a display problem. Nothing was touched: which of two invoices
is the real one is a judgement about somebody's administration, and §6's rule holds.

### Still open from this pass, in the order I would take them

Each survived three skeptics. None has been changed, and the reason differs:

1. **A concurrent partial creditnota passes a gross-only database guard**
   (`creditnota_partial.sql:74`). Needs a migration; not something to apply to a
   production database on an agent's own judgement.
2. **An undone bank booking is re-made within the hour** (`bank/unlink`). The same
   defect as the auto-incasso one, and the module header's promise — "fully
   reversible (owner can unlink)" — is what it breaks. Needs a design choice
   (a new column, or overloading `auto_match_reason`) with effects on the readiness
   board, and `bank-auto-confirm.ts` was being edited by another session the same
   night.
3. **A turnover import can claim a day the owner already filled by hand**
   (`turnover-book.ts:105`). Verified structurally: `daySourceConflict` has two
   readers, both manual doors, and the single writer consults neither. Needs a
   product decision about what the owner sees.
4. **The filed aangifte rounds once where the concept rounds per rubriek**
   (`aangifte/route.ts:465`), producing a €1 phantom suppletie prompt on an
   unchanged return.
5. **An ignored bank line keeps counting in the P&L** (`bank/ignore`). Marking a
   duplicate 'dubbel' hides it from the matcher and leaves its cost in kosten and
   its BTW in voorbelasting.

The pattern across everything fixed tonight is worth keeping in front of whoever
picks these up: **not one was an arithmetic error.** Every single one was a fact
established correctly in one place and not read in another — a key stored where an
undo deletes it, a marker not on a carry list, a definition spelled twice, a
recovery path that could not be reached, a probe whose two failures mean opposite
things. The engines were never the risk. The seams are.

## 11. A second pass, in parallel — 31 August 2026

Written by a session working alongside §10, on the same night. It found no arithmetic error either,
and that is now two independent passes reaching the same conclusion by different routes.

The shape here was slightly different from §10's. Where that pass hunted one signature — a fact
established in one place and not read in another — this one kept running into a second: **a check
that could not fire.** A guard that answers "fine" to every input is not a weak guard, it is the
reason nobody looks any more.

### Fixed, each verified against production before a line was changed

**A dollar statement was booked as euros, on both doors that write bank transactions.**
`bank-ingest` has refused non-euro statements from the start, reading `parsed.currency` — and
`parseBankCsv` wrote the literal `"EUR"` into that field for every file it parsed, whatever the
file's own Munt/Valuta/Currency column said. The refusal could not fire for a single CSV. The bank
FEED (Enable Banking, whose own sample data is Danish) had no check at all, and that is the worse
door: it runs on a cron with nobody watching. `bank_transactions` has no currency column, so a
foreign line stored as a number is thereafter indistinguishable from euros. Also closed for CAMT,
which carries `Ccy` per `<Ntry>` and could declare EUR at the top while holding dollar lines.

**Emptying the prullenbak could leave a booking without its bewijsstuk.** Eight foreign keys point
at `documents`; seven are `ON DELETE SET NULL` and one is `CASCADE`. The delete SUCCEEDED and took
the link with it — no error, no audit line, and afterwards no way to tell an invoice that never had
a scan from one whose scan was thrown away. The CASCADE one is worse than it looks:
`bank_statement_periods.document_id` deletes the COVERAGE record, and coverage is an input to
`computeDrawerBalance` and the financial result, so an owner could watch his kasresultaat change
because he emptied his bin. Refused now, with the reason, from inside `deleteDocument` rather than
from the route that happens to call it.

**Two iDEAL clicks at once could take a customer's payment and book nothing.** The create route
puts down a placeholder row immediately before calling Mollie; the cleanup treated every placeholder
as stranded and DELETED it. A concurrent request then handed out a checkout URL for a row that no
longer existed, the customer paid, and the webhook answered `ok: true` on an unknown row — after
which Mollie stops retrying. Money in the bank, nothing in the books, no trace. The route already
knew the right reading: its 23505 branch says an empty checkout_url means the winner is still busy.
Two places read the same sign and drew opposite conclusions.

**A second cashier ringing up mid-rebuild made the day's turnover short a whole ticket.**
`rebuildTillDay` reads a day's sales and writes an ABSOLUTE total; a ticket landing between those
two steps is lost from `daily_turnover` while staying visible in `till_sales`, so every screen still
looks right. Fixed by convergence rather than a lock — a rebuild is idempotent, which is the
module's own stated reason for rebuilding instead of applying a delta.

**Three owners were told their numbering was unbroken over numbers that were never written.**
`checkContinuity` builds its series from the invoices, so a series with no invoice has no bucket and
`burnedAtEnd` — the only check that sees the END of a series — is never computed for it.
`series.every(...)` over an empty list is `true`. Measured: two owners with a creditnota counter at
1 and 2 and zero creditnota's. The ordinary cause is a discarded draft, which is a perfectly good
answer — the owner just has to be asked before he can give it.

**A bank line the owner marked private kept its cost in kosten and its BTW in voorbelasting.**
Three of the five ignore reasons (`prive`, `dubbel`, `niet_van_mij`) are statements that the money
does not belong in the books; the route's own comment called the reason "een NOTITIE, geen besluit".
The fourth, `geen_factuur` (rent, lease, a subscription), is a real cost and MUST keep counting —
which is why this is a rule per reason and not a filter on status. The consequence now stands
visibly under both pickers, derived from the rule so the sentence cannot drift from what happens.

**The filed aangifte produced a €1 phantom suppletie on an unchanged return.** §10 item 4, closed.
The concept's 5g is the SUM of per-rubriek rounded amounts (what the paper form asks for); the
filed snapshot's raw total was rounded ONCE, with `Math.round` where the rubrieken beside it use a
symmetric rounding. The screen subtracted the two displays. The real suppletie machinery
(`computeFilingDivergence`) compared raw with raw all along and was never wrong — only the sentence
was.

**The auditfile never said which VAT scheme its dates should be read under.** It books on invoice
date, correct under both schemes — but under the kasstelsel the BTW is due in the quarter of
PAYMENT, and nothing in the file said so. The regimeNotes already declared the KOR and the undivided
0% turnover; the scheme is the only one of the three that moves the timing of everything. They also
moved from behind `</company>` to above `<auditfile>`, where a reader meets them before the figures
rather than after several thousand journal lines.

### The method, since it is the transferable part

Every one of these was verified against the production database before anything was changed, and
several turned out to be **latent** — the mechanism real, the damage not yet done. Those are said as
such rather than dressed up. Three had already fired: the three burned creditnota numbers, and
(from §10) the eleven duplicate purchase invoices.

Every gate added here was checked by deliberately reintroducing the defect and confirming it bites.
That caught four gates of mine that would have passed over the very thing they claimed to pin —
including one that looked for a report within 900 characters of a branch and found an unrelated one
further down the file, and one whose `[^)]*` could not cross a `new Date()`. A gate that reads the
wrong region reports nothing and calls itself green.

### Still open after both passes

§10's list stands, minus item 4 (closed above). Item 1 still needs a migration, item 2 a design
choice, item 3 a product decision, item 5 is closed above. Two operational items also remain and
are the owner's to do, not an agent's: applying
`supabase/migrations/accountant_amount_guard_restore.sql` (a security regression plus a mandate
tightening), and deciding what to do about the 14 invoices whose `amount_paid` is 0 while their
links cover the total exactly — `recompute_invoice_amount_paid` would repair them, but that writes
to real books.

### §11 continued — the later half of the same night

**Two doors for "mark this invoice paid" disagreed.** `/api/email/confirm`'s 'pay' action wrote the
status and not `amount_paid`; pay-toggle, the bank confirmation and the auto-confirm all write both.
Five purchase invoices sit in production as paid/bank/0/no-links. The aangifte is unaffected —
`isSettled` reads `amount_paid > 0 || status === 'paid'` precisely for legacy rows — but the money
audit reports them with a sentence describing the wrong thing.

**The money audit was crying wolf.** `btw_arithmetic` reported three live invoices as "ex 0 + btw 0
is not € 1.040,12 — dit getal staat in je aangifte", about a split the reader has not reached yet.
The check's own comment forbids exactly this ("een schending verzinnen uit een gat is hoe een audit
ophoudt geloofd te worden") and covered NULL but not zero. One genuine break exists in the books
(€ 176,40) and deserved not to be lost among three false ones.

**The three screens a return is filed from had no render coverage** — aangifte, klaar, waarheid —
which is the class AGENTS.md opens with. Verified by reintroducing that exact defect.

**Every owner was told their zelfstandigenaftrek might lapse.** All nine have zero time entries, so
all nine got the full red warning about the largest deduction a zzp'er has. urencriterium.ts's own
rule 3 draws the line this crossed: only registered hours count, and that is a statement about the
registration, "the difference between a fact and an accusation".

### Checked and found SOUND — recorded so nobody re-investigates

**The UBL creditnota flip.** `ubl-export.ts` negates quantity and line total while keeping the unit
price a magnitude, and that is correct: Peppol BIS 3.0 states a credit note's amounts positive with
type code 381, and BR-27 forbids a negative `cbc:PriceAmount`. `CR-20260002` in production has the
shape that would break a naive reading (negative quantity AND negative line total) and comes out
right. The `?? 1` default cannot express a negated line, but no invoice_line in production has a
null quantity, and the module's comment reasons about that default deliberately.

**The cash-drawer axis.** My first pass reported two owners below zero. That was my error: it summed
`cash_entries` alone, and till takings enter the drawer through `daily_turnover` without a
cash_entries row. Corrected, one owner's low point is +€59 (not −€41) and the other's is −€892,86
(not −€2.804,45). The remaining negative is real, and the app already detects it — `drawer_negative`
reports it and the filing gate blocks on it. No code defect; the owner's data has a question in it.

### One complete feature that nothing calls

`src/lib/found-money.ts` — `foundMoney()`, fully written and tested, imported by nothing. It turns
the one figure the reconciliation genuinely FINDS (the acquirer commission that was silently
inflating profit) into something an owner learns about. Its own header says why that matters: the
figure "reaches exactly one place: a stat tile on /dashboard/waarheid, alive for as long as that
screen is open", and "for an owner who does not open that screen it is work the app did that nobody
will ever learn about".

Not wired here, and the reason is the same one §10 gives for its item 3: WHERE this surfaces is a
product decision, not a wiring task. It puts a new claim about money in front of the owner, and the
module itself is careful about the framing (MARKTPOSITIE_2026.md §5: lead with "your profit is
overstated", never with "we found you € 340"). It takes a `RangeResult`, which
`computeResultForRange` already produces, so wiring it anywhere is a few lines once the destination
is chosen. Two other modules are also uncalled — `deck.ts` (buildDeck) and `recon-confirm-client.ts`
(confirmReconPayment) — and were not investigated further.

---

## 11. The signature hunt, closed out — 31 August 2026

§10 listed five survivors as open. They are settled, along with the rest of the pass: 35 findings,
105 skeptic verdicts, 22 survivors of a 2-of-3 majority. Every one is now fixed, written as a
migration, or recorded here with the measurement that says why not.

### Fixed in code

| Where | What it did |
| --- | --- |
| `cron/payment-due` | auto-collected AND dunned the same invoice — two spellings of one supplier question |
| `kas-payment-events-fetch` | a slow query moved every cash payment into the wrong BTW quarter |
| `bank/unlink`, `bank/confirm` | the quarter-close board warned about a link the owner made by hand |
| `verkoop`, `incoming/missing` | two reads that said "nothing here" before finishing |
| `kas-payment-events-fetch`, `readiness`, `debiteuren` | three id-list reads that die at the gateway |
| `btw-reservation`, `api/aangifte` | the reservation asked for €1 less than the return just filed |
| `turnover/day`, `turnover/import`, `turnover-book` | a day's takings could be typed over, imported over, or deleted out from under itself |
| `closing-package` | the accountant's ZIP dated a cash payment from a different quarter than its own aangifte |
| `bank-auto-confirm`, `bank/unlink` | "one tap undoes it" lasted about an hour |
| `xaf-export` | the auditfile told the Belastingdienst a purchase was free |

### Written as migrations, NOT applied

Three, each idempotent and each stating in its own header that the assistant did not run it:

- `bank_auto_book_blocked.sql` — the column that makes an undone bank booking stay undone. The code
  is deploy-safe on both sides: without the migration the app behaves exactly as today.
- `accountant_vat_deduction_guard.sql` — `vat_deduction` was in no version of the accountant deny
  list, and it moves the client's rubriek 5b by the invoice's whole btw_amount. Adding it to the
  gate's list immediately failed six redefinitions; all six carry it now, which is the
  order-independence that gate exists to create.
- `creditnota_per_rate_ceiling.sql` — the only one I could not measure against a database, and its
  header says so and asks to be run when a normal creditnota can be made to confirm one still
  succeeds.

### Measured, and deliberately not changed

- **The kasstelsel quarter attribution** (`bulk-undo-pay`, `invoice-scan`). Both real: an invoice
  settled across two quarters warns about one, and the booked-invoice scan buckets a correction by
  invoice date where kas books it by payment date. Neither is reachable — **zero kasstelsel owners**
  in production, one invoice with multiple instalments, none spanning two quarters — and both need
  per-instalment dates plumbed through a screen another session was editing the same night.
- **An unmatched categorised bank line double-counts against its invoice.** Verified, and the
  finding's framing is incomplete: the unlink does not create the double count, it returns to the
  ordinary unmatched state which predates any link. Removing it means either deleting the invoice
  attach-invoice created — nothing marks which those are — or discarding the owner's own
  classification.

### Two findings were already fixed while the pass ran

The `/api/aangifte` phantom suppletie and the ignored-bank-line P&L leak were both closed by another
session the same night. Worth recording because the useful discipline is the same one that produced
everything above: **check the current code and the live database before acting on a finding, however
confident it sounds.** Two of twenty-two were already done, one migration's deny list turned out to
be six files wide, and one of my own SQL statements had a bug I only found by re-reading it.

---

## 12. The guard that only one of three writers had — 31 August 2026

An earlier pass found that a bill the owner marked paid by hand puts its cost in the books before
its bank debit ever arrives; the matcher excludes paid invoices, so the debit finds no candidate,
and a confident memory hit codes it `kosten` — the same cost twice, in the resultaat and in the
closing package. The fix landed in `bank-auto-categorize.ts` and was documented there at length.

It was documented in the one place it was not most needed. Three code paths write a category the
owner did not answer for personally, all running the same classifier over the same rows:

| Writer | Reached by | Had the guard |
| --- | --- | --- |
| `applyLearnedBankCategories` | import, cron, `/bank` load | yes |
| `bulkApply` | **the "N zekere invullen" button** | no |
| the `[ZELFDE-TEGENPARTIJ]` spread | confirming one line of a party | no |

The unguarded pair includes the one the owner presses.

### Measured before changing anything

Across production, 53 uncategorised bank lines — together **€ 31.188,87** — sit against a paid
invoice that already explains them (same direction, same amount to the cent, settled within a
fortnight). Of those, **45 (€ 22.821,96)** would be confidently coded `kosten` by one press of the
button, at one owner. Nothing downstream would have flagged it: readiness counts *excluded*
categories, and a doubled `kosten` is not excluded, it is deductible.

### What changed

The decision moved to `src/lib/bank-double-booking.ts` and the three writers ask it. Not copied —
copying it is what produced the defect. Two details were only visible once it was shared:

- **The spread and the sweep never read the line's date.** Without it every magnitude match reads
  as undatable, which the rule resolves toward holding — safe, but it would have frozen the sweep
  the owner presses. Both reads now select `date`, and the gate says why.
- **`mollie_payment_links` has RLS on with zero policies**, by design: every other access in the
  app goes through the service role. A guard wired with the caller's RLS client would have read an
  empty set, and "no rows" is indistinguishable from "this owner has no Mollie" — the payout hold
  would have been silently off on exactly the path that needed it. The route hands the probe a
  service-role client scoped to that `user_id`, and a probe that could not run reports
  `molliePayoutKnown: false` instead of an answer.

### The gate names no writers

A list of writers is what went missing the first time: the second and third were written later, by
someone reading the first. `[DUBBEL-GEDEKT]` in `lifecycle-gates.test.ts` derives the set from the
source instead — every update that stamps `category_confirmed: false` onto `bank_transactions` is,
by the app's own convention, a machine's inference rather than the owner's answer, which writes
`true` — and requires each one to consult the guard inside the loop that reaches it.

Verified by negative control, including the one that matters: a fourth writer added in a brand-new
file the gate had never heard of fails it on the day it is written.

### The half that only appeared once the first half worked

Blocking the machines opened a quieter door. A held line lands on the categorisatie screen looking
exactly like a line nobody could classify — same card, a `kosten` chip already selected, a confirm
button under it. One tap books the cost a second time, with the app's own suggestion saying it was
right, and the owner has no way of knowing.

So the screen was given what the server knows: the hold arrives as `already_booked`, the line is
excluded from the "N zekere invullen" hint (the sweep will not write it; promising it there is a
number that cannot be delivered), and it reaches the owner with **nothing chosen**, under a sentence
naming what already carries the amount. They may still pick `kosten` — two identical costs a
fortnight apart are possible — but they have to mean it.

The friction this adds is measurably nil: of the 53 held lines, 45 were the ones the button would
have coded and the other 8 were never going to be auto-coded at all. Nothing that used to be filled
in silently and correctly stopped being filled in.

The copy lives in `bank-already-booked-notice.ts` rather than in the component, and the reason→copy
map is a `Record` over the hold union rather than a switch with a default: a third hold reason stops
compiling until it has words, where a default branch would have shipped it wearing the wrong ones.

---

## 13. The checker said the guards were applied. They were not. — 31 August 2026

`docs/WELKE_MIGRATIES_STAAN_ER.sql` answers the one operational question that matters between a
written migration and a protected database: **what still needs applying?** It reported a clean
sheet — 114 migrations, 2 open. Both of those were already known.

It was wrong, and wrong in the direction that costs the most.

`prevent_accountant_amount_changes` is written by **nine** migration files. The probe asked whether
the FUNCTION exists — and it has, since the first of those nine. So all nine reported TOEGEPAST,
while the function running in production was missing three protected columns:

| Column | What an accountant could move without it |
| --- | --- |
| `vat_deduction` | rubriek 5b of the client's aangifte, by the invoice's whole `btw_amount` — on € 10.000 + 21% that is € 2.100, silently, in the return that goes to the Belastingdienst |
| `discount_type` | the invoice-level discount the e-factuur's amounts are derived from |
| `discount_value` | the same |

Both guards were written weeks ago, both were reported to the owner as "written, not applied", and
the one tool that answers "did I apply it?" said yes. That is not a migration that was forgotten —
it is a measurement that could not see what it claimed to check.

This is the same defect the file's own header is about, one level down. That header records the
question drifting behind the folder ("de VRAAG staat hier met de hand in"), which was fixed by
generating it. Nobody asked whether the ANSWER could drift: **existence stops being evidence the
moment a second file writes the same object.** Eight functions in this repo are written by more
than one migration, covering about twenty files.

### What the probe measures now

For a function with more than one definer, the generated query reads the deployed body and checks
every `NEW.`/`OLD.` column reference that **every** current definition contains — what the folder
unanimously says belongs in that function, whichever file you happen to open. Run against
production it returns exactly `.discount_type, .discount_value, .vat_deduction`.

The intersection and not the union, deliberately: a union would carry a column one definition
deliberately dropped, and then an alarm goes off that can never be cleared — which teaches everyone
to click it away, the failure this file's own header warns about twice.

Where several definitions share no column reference at all (a non-trigger function), the list says
so in words rather than falling silent: *"GEEN INHOUDSMETING — Deel 1 valt hier terug op het bestaan
van de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft."*

The gate derives its rule from the generated list rather than from a list of functions someone
maintains: **no function name may be probed by mere existence from more than one file**, unless the
list itself explains why it cannot be measured. A tenth redefinition of anything fails it on the
day it is written.

### Also closed

`src/lib/recon-confirm-client.ts` was deleted. The audit recorded it as "a complete feature nothing
calls"; it is not a feature, it is a second spelling of `useInvoiceReconciliation.confirmMatch`,
which two screens do call — and the worse of the two: it reports a 409 `invoice_already_paid` as
`'error'`, so an invoice the auto-confirm had already booked would have shown the owner "mislukt".
`deck.ts` is not uncalled either: `scripts/generate-deck.mts` builds from it.

### Applied to production, 31 August 2026 — with the owner's approval

`accountant_discount_guard.sql` (which carries the full 24-column deny list, including
`vat_deduction`) was applied. Checked before applying, because a `CREATE OR REPLACE FUNCTION`
silently resets what it does not restate: the live function was `SECURITY INVOKER`, no
`search_path`, `VOLATILE` — exactly what the file produces, so nothing was lost. Verified after:

| Check | Result |
| --- | --- |
| the file's own CONTROLE block (4 assertions) | all true |
| `vendor_iban` / `payment_reference` / `document_id` still protected | yes |
| both mandate exceptions (opstellen, bevestigen) still reachable | yes |
| trigger still attached to `invoices` | yes, 1 |
| `security definer` / `search_path` / volatility | unchanged |
| the new body probe, the one that reported the hole an hour earlier | TOEGEPAST, nothing missing |

And then the guard was made to **bite**, in a transaction that always aborts: acting as a uid that
is neither sender nor receiver and holds no mandate, `vat_deduction`, `discount_value` and
`vendor_iban` were each GEWEIGERD; acting as the invoice's own receiver, `vat_deduction` was
TOEGESTAAN — so `/dashboard/incoming/manage`, the one screen that writes that column, still works.
The proof left nothing behind; the row it ran against is byte-for-byte as it was.

A deployed text is not a working rule. The difference is one query, and it is the query nobody runs.

### One truncation found while verifying the fix itself

The generator caps a migration at six probes, chosen alphabetically. `vat_exemption.sql` has six
ordinary column and constraint probes, so `function_body` — which sorts after both — fell off the
end. A cap that cuts exactly the sharpest measurement is a silent truncation of the same kind as
the defect it was written for, so a body probe now survives the cap unconditionally and the gate
walks the folder: every file that rewrites the guard must carry one.

(The finding before it was mine, not the tool's: I read the emitted marker list with a `grep` that
dropped its first field and briefly believed `amount_paid` had gone missing. It had not — all 24
columns were there. Worth recording, because it is the third time this week that the thing which
looked broken was the measurement rather than the thing measured.)

### Still open, and now accurately reported

- `bank_auto_book_blocked.sql` and `creditnota_per_rate_ceiling.sql` — the two the checker always
  named correctly (they create objects that do not exist yet).
- `accountant_vat_deduction_guard.sql` reads TOEGEPAST now and that is correct: its columns are in
  the deployed body. The two files are two spellings of one deny list, which is the convention this
  family documents — whichever runs last, the list is whole.
- The 14 invoices with `amount_paid = 0` whose links cover the total (7 incoming € 1.071,89,
  7 outgoing € 4.249,79): approved for repair via `recompute_invoice_amount_paid`, not yet run.

---

## 14. The 14 invoices, repaired — 2 September 2026

Approved by the owner, run against production, verified both ways.

Fourteen invoices sat `status = 'paid'` with bank links covering their total exactly and
`amount_paid = 0`. Six belong to a real owner, eight to the demo dossier. The aangifte was never
affected — `isSettled` reads `amount_paid > 0 || status === 'paid'` precisely for rows like these —
but every screen and check that reads `amount_paid` saw zero, and the money audit described them
with a sentence about the wrong thing.

### What was checked before writing

- **The deployed function, not the file.** `recompute_invoice_amount_paid` is written by TWO
  migrations. The one live in production is `invoice_partial_payments.sql`'s: it writes
  `amount_paid` and nothing else. `invoice_payment_date_rederive.sql`, which also re-derives
  `payment_date`, **has not been applied** — which the new body probe from §13 reports correctly,
  and which mattered here: a repair that moved fourteen payment dates is a different act entirely.
- **Every trigger on `invoices`.** Six, all BEFORE. The two `verwerkt` guards do not fire
  (`accountant_status` is null on all fourteen), the creditnota ceiling does not fire (all fourteen
  are `factuur`), and the accountant guard's first exception passes for a service-role caller.
- **The scheme.** Both owners are `vat_scheme = 'factuur'`, so BTW follows the invoice date and
  `amount_paid` cannot move a quarter even in principle.

### How it was run

One statement, therefore one transaction — all fourteen or none. The defect was **re-asserted per
row inside that statement** (`amount_paid = 0` AND links covering the total), so a row that had
stopped matching between the measurement and the write would have excluded itself instead of being
written blindly.

### Verified after

The same aggregate query, before and after, over both owners by direction and quarter:

| Column | Result |
| --- | --- |
| `som_inc`, `som_btw` (the aangifte's inputs) | **byte-identical in all 8 groups** |
| `openstaand` | byte-identical |
| row counts | byte-identical |
| `amount_paid` over the invoice total | 0 before, 0 after |
| `som_betaald` | +297,12 · +401,99 · +774,77 · +3.847,80 = **€ 5.321,68**, exactly the measured set |

And app-wide afterwards: **0** invoices still matching the defect, **0** whose `amount_paid`
disagrees with its links by more than a cent, **0** claiming more paid than their total.

No tax figure moved. That is the claim the before/after pair exists to support, and it is the only
reason a repair to real books was worth running at all.
