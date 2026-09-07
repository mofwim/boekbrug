# [VOORUIT] The cash-flow forecast: how much money in 7 and in 30 days

The owner's first question every week is "kom ik uit?" — will there be enough. The app held every
number it needed and never put them together: the last statement's closing balance, the drawer,
every open purchase invoice with its due date, every open sales invoice with the client's measured
pace, and eight weeks of till takings. This tile does the sum on Vandaag, under the BTW reservation.

## What it is

| Part | Where | Nature |
|---|---|---|
| Engine | `src/lib/cashflow-forecast.ts` | Pure. Day-by-day ledger over the horizon, lowest point, note codes. |
| Words | `src/lib/cashflow-forecast-copy.ts` + `vooruit.*` in `messages.ts` | Pure. One sentence per note code, nl/en/ar, direction on the object. |
| Route | `src/app/api/cashflow/route.ts` | Assembles inputs only. Decides nothing. |
| Panel | `src/components/cashflow/CashflowPanel.tsx` | Renders what it is handed. No language of its own. |

## The rules, and why each is the safe side

- **Now = bank + lines since the statement + drawer.** The bank figure is the closing balance of
  the newest statement per account (`bankBalanceOf`), plus every bank line dated after it. For one
  account that is exact: a line after the statement's end date cannot be inside its balance. With
  several accounts a line cannot be placed on one of them, so only lines after the newest
  statement count, and the tile says so.
- **A purchase invoice without a due date is not counted.** It is named with its amount. A date the
  app invents is a payment the owner did not plan.
- **An overdue purchase invoice counts today.** It is money that should already have left.
- **A sales invoice is expected on the client's measured pace** (median days from invoice to
  payment over the last 365 days, at least three paid invoices), else on its due date.
- **A sales invoice already past its expected date is not counted.** It is late. A forecast that
  books late money as tomorrow's is the kind that gets an owner into an overdraft. Named, so the
  owner chases it.
- **Open amounts come from the one rule** (`openAmountSigned`), net of creditnotas and of known
  payment differences. Never `total_inc_btw`.
- **Takings are an average over BOOKED till days** (pin + cash, last 56 days), spread over the
  horizon by booked days per week. No till, no takings — and a thin sample (under 14 days) is named.
- **An unknown bank balance produces no "now" and no end figure.** Only the movements. Never 0.
- **Unreadable bank lines withhold the balance** rather than show a stale one without them.
- **A failed invoice read is no answer (503),** never an empty list. Empty reads as "nothing to pay".

## What it does not do

It does not know about salary, rent that is not invoiced, tax assessments not yet in the app, or
the owner's private drawings. It is the sum of what the administration holds, and it says what it
left out.
