# PROEF — the test that decides whether BoekBrug is a company

Written on 9 September 2026, on the consultant's advice and the owner's decision: **stop
building Core; put BoekBrug in real use and measure money, not opinions.**

## The question

Not "does BoekBrug have a market?" but:

> Is there a group of small business owners willing to change how they work because BoekBrug
> stops money leaking between their work and their invoices?

Yes → a company. No → good software. The screens do not answer this; only real use does.

## Who, how long

- **5 to 10 businesses in two cohorts of five: bouw and dienstverleners** (docs/DIENST.md — the
  largest segment, closest to the Core, with a leak measurable from the first week). If five of
  one cohort cannot be found, whoever is actually willing to enter their real work — a garage
  that says yes beats a bouwbedrijf that says maybe.
- **4 to 6 weeks** of real use: their real customers, their real hours, their real purchase
  invoices. Not a demo account.
- **No new features during the test** unless a participant hits a wall that stops them closing the
  loop Werk → Kosten → Factuur → Betaling → Marge. A wish is not a wall.

## What we ask before the test starts (baseline, per business)

| Question | How we get the number |
|---|---|
| How often does a job end and you are not sure everything was invoiced? | their estimate, per month |
| How often is there arbeid + onderdelen + meerwerk and something never reaches the invoice? | their estimate, per month |
| After a job closes, do you know what it cost you and what it brought in? | yes / no / sometimes |
| How many days from the end of the work to the invoice? | their estimate |
| How many hours a month are written down but never invoiced? | their estimate |

## What BoekBrug measures during the test (per business, per week)

These are facts the app already records; none is a survey answer.

- Work created, work invoiced, days between "klaar" and the invoice.
- Hours on work: with a rate, without a rate (the ones that would fall off the invoice).
- Meerwerk lines on work not yet on an invoice, in euros.
- Purchase invoices from known suppliers attached to no work, in euros.
- Work over its begroot amount, and by how much.
- Work with a known margin (werkelijk), an estimated one (geschat), an incomplete one.
- Aanbetalingen issued and settled (bouw).

The number that matters most, the North Star: **% of revenue whose real margin BoekBrug knows.**

## The one question after two weeks, and again at the end

> **"Waar heeft BoekBrug je geld bespaard of gevonden?"**

Not "what do you think of the software". We are listening for sentences like:

- "Die drie uur had ik anders niet gefactureerd."
- "Dat onderdeel was kwijtgeraakt."
- "Ik wist niet dat die klus verlies draaide."

Write each one down with the euro amount the app can attach to it. That list is the product's
value in the owner's own words.

## Success criteria, decided before the test

After the first 10 businesses:

1. **5 to 7 say BoekBrug found money they would not have invoiced, or showed them the real
   margin of a job.**
2. **3 or more pay the real price** (€25 to €45 a month) when the test ends.
3. **Two months later they are still using it.**

All three → continue: Garage next, then Schoonmaak, then Transport, each as a business decision.
Fewer → stop and change the positioning, the target or the problem before doubling the
investment. Four thousand green tests prove the software works, not that the market wants it.

## What we do not build during the test, written on the wall

No planning, no agenda engine, no werkbon signatures, no customer portal, no crew management,
no payroll, no HR, no fleet, no route planning, no TMS, no inventory, no ERP features, no more
Core, no sixth trade. Only a wall that stops a paying participant from closing the money loop.

## What changed on 9 September so the test measures the right thing

- The Werk screen opens on **"Wat laat jij liggen?"**: what is ready to invoice and its amount,
  meerwerk not invoiced, hours without a rate, a supplier's bon on no work, work over its
  estimate, a contract ending. The list of work comes second.
- Creating work asks four things — the customer, the work, what identifies it, what was agreed —
  and folds the rest behind "Meer velden". The money questions come while the work runs.
- An accepted offerte can be invoiced in part (aanbetaling) and the final invoice settles it.

## Where the numbers come from

`src/lib/werk-stand.ts` (the position), `src/lib/werk.ts` (counts, signals, readiness, margin),
`GET /api/werk?stand=1`. Everything is per owner and readable by them; nothing in this protocol
needs a new table.
