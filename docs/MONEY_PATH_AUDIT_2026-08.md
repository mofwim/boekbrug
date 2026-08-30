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
