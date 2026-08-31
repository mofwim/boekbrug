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
