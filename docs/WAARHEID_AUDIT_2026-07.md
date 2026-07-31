# Waarheid audit — July 2026

*A line-by-line review of `/dashboard/waarheid` and everything that feeds it: what was wrong, what
changed, and what was deliberately left alone.*

The screen's promise is unusually strict. It is called *"je financiële waarheid"*, it claims one
truth re-sliced by a time lens, and it claims never to hide a gap. Three classes of defect were
found against that promise:

1. **The screen said things that were false** — a hardcoded sentence about which date drives the
   figures, a divergence banner announcing a €0,00 BTW change, a link that opened a different
   period than the one it named.
2. **The screen stayed silent about gaps it knew about** — the engine computed four completeness
   signals that `/api/truth` dropped on the floor, including the ones the filing gate blocks on.
3. **Two figures on one screen could contradict each other** — the lens windows did not nest, and a
   slow response could overwrite a fast one.

Everything below was verified against the code before it was changed. All 127 test files pass;
`tsc --noEmit`, `eslint` and `next build` are clean.

---

## The files in scope

```
src/app/dashboard/waarheid/page.tsx           auth only
src/app/dashboard/waarheid/WaarheidClient.tsx the screen
src/app/api/truth/route.ts                    the lens → window → figures endpoint
src/lib/truth-lens.ts                         NEW — the window rules, extracted + tested
src/lib/compute-result-range.ts               the reconcile engine over an arbitrary window
src/lib/financial-result.ts                   computeResult — the money core
src/lib/triangle.ts + card-reconcile.ts       card-takings reconciliation
src/lib/kas-payment-events-fetch.ts           kasstelsel settlements + scheme resolution
src/lib/btw-filing.ts                         filed-snapshot vs live divergence
src/app/api/btw/file/route.ts                 file / unfile a quarter
src/components/quarterly/QuarterlyOverview.tsx  the aangifte screen waarheid links to
```

---

## What was already right

Worth stating, because most of the engine is careful work and none of it was touched:

- One window, one engine. `/api/result` and `/api/truth` both call `computeResultForRange`, so a
  quarter and any other window cannot drift apart.
- The de-dup rules in `computeResult` are genuinely thorough: a bank line carrying `invoice_id` is a
  payment not a second helping; an uncategorised line is never guessed into a total; a covered till
  day suppresses its bank/cash witnesses but only up to that day's card takings (`cardBudgetBound`),
  so off-till excess still counts; cash entries carry their direction so a refund reduces rather
  than adds.
- The ±5-day settlement buffer, and the fact that revenue rows are strictly in-window while the
  buffer only anchors re-attribution.
- `effDirOf` — a NULL-direction invoice is inferred from ownership rather than dropped.
- The per-quarter VAT-scheme rule, so switching to kasstelsel never rewrites a filed quarter.

The defects are at the seams: between the engine and the endpoint, between the endpoint and the
screen, and between the screen and the screen it links to.

---

## Critical

### 1. The screen told kasstelsel owners the opposite of the truth

`computeResultForRange` returns `scheme`, `undatedPaidCount` and `estimatedPortionCount`.
`/api/result` forwards all three. `/api/truth` returned none of them, and the client printed a
hardcoded line:

> *"Op basis van factuurdatum (niet betaaldatum)"*

For an owner on the kasstelsel that is precisely backwards — `computeResult`'s cash-basis branch
books BTW on the **paid** date. Worse, `undatedPaidCount` (paid money that cannot be placed in a
period) is the signal that blocks filing, that `/api/aangifte` warns about, and that
`/api/readiness` blocks "klaar" on. The truth screen was the only surface that never showed it.

**Fixed** — `/api/truth` now returns `scheme`, `undatedPaidCount`, `estimatedPortionCount` and
`unconfirmedIncomingCount`; the client branches the basis sentence on `scheme` and renders a warning
line for each signal.

### 2. Different lenses computed under different VAT schemes

`compute-result-range.ts` resolved the scheme at the window **start**. Correct for a quarter — it is
what stops a scheme switch retroactively rewriting a filed period. Quietly wrong for the
multi-quarter windows the lens introduced: `ytd` starts 1 January, `all` starts `2015-01-01`. An
owner who moved to kasstelsel on 1 April got "Dit kwartaal" on kas and "Dit jaar"/"Alles" entirely
on factuur. The year did not equal the sum of its quarters, on a screen whose premise is that there
is one truth.

There is no single basis that is correct for such a window, so the fix does not invent one.

**Fixed** — new `resolveOwnerSchemeSpan` (one profile read) reports the basis at both ends of the
window. The figures keep the start-resolved basis (unchanged, never rewrites a filed period) and
`spansSchemeChange` + `schemeSince` travel to the screen, which now says the period crosses the
switch and which basis was used.

### 3. `eft_settlements` was read unpaginated, unordered, and errors were discarded

The one read in `compute-result-range.ts` that still used a bare `const { data } = await …`.
PostgREST caps a response at ~1000 rows and truncates **silently** — the exact hazard
`supabase-paginate.ts` exists to prevent, and which the file's own comment condemns twelve lines
earlier about `daily_turnover`. With no `.order()`, the surviving 1000 rows were an arbitrary
subset.

A till shop with several terminals settling per shift passes 1000 rows inside one quarter and blows
far past it on "Dit jaar"/"Alles". Missing EFT gross makes Leg B under-report the acquirer
commission, so **kosten land too low and resultaat too high** — with a 200 and no warning.

**Fixed** — read through `fetchAllRows`, ordered by `id`, throwing on error like every other source.

### 4. "Naar de BTW-aangifte van deze periode" opened a different period

`WaarheidClient` renders the link with `?year=…&quarter=…`. `QuarterlyOverview` never read the URL:
no `useSearchParams`, no `next/navigation` import, state seeded from module constants derived from
`lastCompletedQuarter()`. From the "Dit kwartaal" lens (Q3) the link opened **Q2**. Same layout,
different period, nothing to indicate it had moved — the exact bug `quarter.ts`'s own header says
was fixed: *"a link from one to another never lands on a different quarter"*.

**Fixed** — `useQuarterFromUrl()` seeds both views via the shared `quarterFromParams` validator
(bounds 2000–2100, Q1–Q4, falling back to the last completed quarter, so a bare visit is unchanged).
The page wraps the component in `<Suspense>` as `useSearchParams` requires.

### 5. A slow lens response could overwrite a fast one

`load()` had no cancellation, no sequencing, no abort. The lenses are not equally expensive: "Alles"
walks years of invoices, bank lines, kassadagen and card payouts; "Dit kwartaal" walks three months.
Tapping Alles then Dit kwartaal let the slow response land last, leaving the chip on "Dit kwartaal"
while the heading, the amounts and the file button all belonged to "Alles". Wrong period,
right-looking screen, no error.

**Fixed** — a generation counter in a ref; only the newest request may write state, and a superseded
request cannot clear the spinner the current one is showing.

### 6. The divergence banner announced a BTW change of € 0,00

`computeFilingDivergence` sets `changed` if **any** of five deltas moved. The banner fired on
`changed` and then narrated only `btwSaldoDelta`, comparing with `>= 0`. Two realistic paths to the
nonsense sentence *"de BTW is met € 0,00 gestegen (je moet meer betalen)"*: a late 0%-BTW cost
invoice (kosten moves, BTW does not), and a correction where verschuldigd and voorbelasting move
equally. Meanwhile `omzetDelta`/`kostenDelta` were computed, returned, and never shown — so a change
to the profit that feeds the inkomstenbelasting was invisible.

**Fixed** — `btw-filing.ts` gained `btwChanged`, `resultaatChanged` and `resultaatDelta`. The banner
tells each true story separately, and has a third branch for "something moved but neither the saldo
nor the result did" that never claims a euro figure. 15 new assertions cover it.

---

## Medium

### 7. A quarter that had not ended could be marked as filed

The file button was offered for the `this-quarter` lens and the server never checked that the period
was over. Freezing a mid-quarter snapshot makes every subsequent sale read as a divergence against
it, and past €1.000 the screen starts demanding a **suppletie for an aangifte that does not exist**.

**Fixed** — the server returns `409 quarter_not_ended` (not overridable by `acknowledge`: this is not
the owner's judgement call), the response carries `quarterEnded`, and the client disables the button
with copy explaining why instead of offering an override dialog.

### 8. The screen showed two of the four things the filing gate blocks on

The gate blocked on unconfirmed purchase invoices, omzet-zonder-tarief, dateless invoices and
undated paid money. The screen showed the middle two. So the first an owner heard about unconfirmed
purchases was the 409 dialog after tapping the file button. Symmetrically, the screen warned about
unreconciled kassadagen, which the gate does not check.

**Fixed** — `unconfirmedIncomingCount` and `undatedPaidCount` now render as honesty lines. The two
sets are at parity.

### 9. The filing gate could not see NULL-direction purchase invoices

The gate counted with `.eq("direction", "incoming")` — a column test. Everywhere else in the engine a
purchase invoice whose `direction` is NULL is inferred from ownership (`effDirOf`, the `[FIN-4]`
rule). Those rows are excluded from the figures but were invisible to the gate, so a quarter with
unconfirmed purchases could pass it unchallenged.

**Fixed** — the count now comes from `computeResultForRange`, over the same rows the money uses, with
the same effective-direction rule. This also removes a query and a fail-open/fail-closed branch: if
the engine read fails the whole request fails, which is correct for a filing gate.

### 10. The lens windows did not nest

Quarter windows ran to the last day of the quarter (correct — it is the tax period, and it must
match the aangifte). `ytd` and `all` were capped at today. Anything dated ahead counted in "Dit
kwartaal" and was missing from "Dit jaar" **and** from "Alles", so a quarter could out-total the
year containing it and "Alles" could fail to contain everything.

**Fixed** — every lens is now a whole period: a year runs to 31 December, "Alles" has no upper
bound, and `isLiveWindow` ("loopt nog") is what says a period is unfinished. The invariant
**kwartaal ⊆ jaar ⊆ alles** is asserted at five boundary dates in `truth-lens.test.ts`.

### 11. "Today" was the server's UTC day, not the owner's Amsterdam day

`resolveWindow` used `new Date()` with `getUTC*`. Vercel runs in UTC, so between 00:00 and 02:00
Dutch time the UTC day is still yesterday — and this value decides which **quarter** the owner sees.
At 00:30 on 1 July the screen showed Kwartaal 2 as "dit kwartaal", and the loopt-nog / afgesloten
badge flipped with it. Every other date-sensitive surface already pins Europe/Amsterdam
(`format-nl.ts`, the crons, Kas, Vandaag, Facturen); this route was the outlier.

**Fixed** — `amsterdamToday()`, the existing shared helper. The filing gate uses it too.

### 12. `commission_issue` days were invisible

`reconcileCardPeriod` counted `gross_mismatch` and `incomplete` days. A day whose payout exceeds its
card gross, or whose commission is implausible, gets status `commission_issue` — it books **no**
commission, so the period's costs are knowingly incomplete — and was counted in neither total. It
appeared in the accountant's CSV and nowhere else.

**Fixed** — `commissionIssueDays` added to `CardPeriodResult` and surfaced through to the screen's
kassadagen warning. A day carries exactly one status, so the three counters stay disjoint and are
safe to sum; a test asserts that.

### 13. The two engines disagreed on what a card payout is

`toResultBankTx` treats a line as a settlement when it is `pos_income` **or** a credit whose text
names a known acquirer (even when the owner tapped plain `omzet`). The triangle's bank feed asked
the database for `category = 'pos_income'` and nothing else. A mis-categorised acquirer payout
therefore had its omzet suppressed as "already counted by the till" while the triangle saw no
bankNet for that day — so Leg B booked no commission (a real deductible cost silently dropped,
resultaat overstated) **and** the day was additionally reported as incomplete.

**Fixed** — one buffered bank read now serves both legs, with the pos feed derived through
`toResultBankTx`. The two agree by construction, and it costs one query fewer.

### 14. Unlocking a filing gave no feedback on failure

The DELETE response was discarded, so a failed unlock looked exactly like a successful one: the
reload re-rendered the still-filed quarter and the owner concluded the button did nothing.

**Fixed** — `res.ok` checked, error toast, mirroring the file path.

### 15. A failed PIN-ledger read made the reconciliation look cleaner than it was

`.catch(() => [])`. The read must stay soft (`ledger_daily` may not exist on every deployment), but
losing the witness can only **remove** gross-mismatch detections — an all-clear that is weaker than
it appears.

**Fixed** — the read stays soft; `reconciliation.pinLedgerAvailable` travels out and the screen says
the check could not run rather than presenting an unrun check as a passed one.

### 16. `commissionBooked` reported a cost that was never booked

Under kasstelsel the triangle delta is deliberately not auto-booked (`computeResult` is passed 0),
but the response still reported `commissionToBook`.

**Fixed** — one `commissionActuallyBooked` value feeds both the engine call and the response.

---

## Also cleaned up

- **Stale comments.** The client and page headers described an "Aangepast" lens that does not exist
  in `LENSES`. The `year` and `custom` lenses remain reachable via the API but not via the UI —
  documented as such rather than described as shipped.
- **`FiledInfo.figures` was typed `TruthResult`**, promising a `resultaat` the API never sends
  (`btw_filings` has no such column). Narrowed to `Omit<…>` so the type states what is actually
  there.
- **401 handling.** An expired session rendered "Kon je waarheid niet laden" with a retry button
  that could only 401 again. It now redirects to `/login`.
- **`omzetZonderBtwNonCash`** was computed by the engine, never forwarded, and the copy hedged with
  *"bij Kas of Dagomzet"*. It is now forwarded and the guidance names the one screen that can fix it.
- **`resolveWindow` extracted** to `src/lib/truth-lens.ts`. A Next route cannot export helpers, so
  the window rules — carrying an invariant — had no test coverage at all. Now 48 assertions.

---

## Deliberately not changed

- **`/api/aangifte` re-implements the reconcile pipeline inline** rather than calling
  `computeResultForRange`. That duplication is a real drift risk (it already differs on the triangle
  and the `+5` end buffer), but consolidating it is a change to the concept-aangifte's numbers and
  belongs in its own reviewed piece of work, not smuggled into this one.
- **Rounding.** The aangifte rounds every rubriek to whole euros and 5a is the sum of the *rounded*
  rubrieken (`aangifte.ts`), so the concept total can sit a euro or two off the exact cents on
  waarheid. That is the Belastingdienst's rounding, not a second truth — now stated in the client
  header comment instead of the previous flat claim that the two "can never disagree".
- **No caching.** Every lens tap recomputes the full pipeline, and "Alles" now scans wider still.
  Adding a cache to a *living truth* surface is a product decision (how stale may the truth be?), so
  it is flagged rather than decided here. Worth watching for function-timeout risk on large accounts.
- **The accountant path is half-built.** `/api/truth` accepts `?clientId`, the screen never sends it,
  and `/api/btw/file` ignores it (filing is the owner's own declaration). Left as-is; noted so the
  next person does not read the parameter as a working feature.
- **`datelessVerifiedCount` is account-wide, not window-scoped**, but is shown under any lens with
  period-sounding copy. Behaviour preserved — the count is a genuine "counts nowhere" signal — but
  the copy is worth revisiting.

---

## Verification

```
npx tsc --noEmit          clean
npx eslint <changed>      clean
npm run build             compiled successfully
127 test files            0 failed
```

New coverage: `truth-lens.test.ts` (48 assertions, including the containment invariant at five
boundary dates and the Amsterdam-day quarter boundaries), plus 15 in `btw-filing.test.ts` for the
divergence split and 5 in `card-reconcile.test.ts` for the exception counters.
