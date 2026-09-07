# Bedrijfsmiddelen — the asset register and its depreciation

*Why a purchase of € 450 or more is not a cost of its year, what the app does about it, and
what it deliberately leaves to the boekhouder.*

## The rule (belastingdienst.nl)

- A bedrijfsmiddel with acquisition cost **below € 450** is deducted in one year. The line is
  **ex btw** when the btw on it is deductible and **incl btw** when it is not (vrijgesteld, KOR).
- Otherwise it is depreciated: **per year = (aanschafkosten − restwaarde) ÷ gebruiksduur**, with
  the gebruiksduur in whole years and **at most 20% a year** — so five years or more.
- The first year counts **from the month of ingebruikname**, pro rata by months. The
  Belastingdienst's own example: € 30.000, ten years, restwaarde € 5.000 → € 2.500 a year; bought
  on 1 October → 3/12 × € 2.500 = € 625 in that year.

The formula, the month rule, the threshold and the 20% cap are pinned in
`src/lib/depreciation.test.ts` with that example.

## What the app does

1. **The register** (`/dashboard/bedrijfsmiddelen`, table `assets`): one row per asset, with or
   without a purchase invoice — a koeling bought before BoekBrug belongs in it too and keeps
   depreciating from its own date. The owner writes; a linked boekhouder reads
   (`assets_accountant_read`). An asset moves the winst, so writing it is the owner's signature.
2. **The result** (`financial-result.ts`): a registered purchase's ex-btw amount is
   **withheld from kosten** and reported as `investeringen`; the window's depreciation
   (`afschrijvingen`) enters kosten. Under kasstelsel too — kasstelsel is a btw rule, and this is
   an income-tax rule. **The btw-aangifte does not move**: voorbelasting on the purchase is
   deducted exactly as before.
3. **The year screen** shows kosten with "waarvan afschrijvingen", the investment that is not in
   the costs, and the boekwaarde on 31 December. When the register could not be read it says so
   and shows no boekwaarde — a € 0 over a failed read is a number someone copies into a form.
4. **The auditfile (XAF)** books an asset purchase to 0100 Inventaris instead of 4000 Kosten and
   adds one MEM entry per asset per closed month (4900 / 0110). Only the cumulative-depreciation
   RGS code could be verified (`BMvaBeiCae`); the others stay `null` on purpose.
5. **Candidates**: the register screen asks "is dit een bedrijfsmiddel?" only for a purchase of
   € 450 or more from a supplier with at most two invoices in two years. Measured before this
   was built: ~260 purchases over € 450 in the live administration and all but one are stock —
   an amount alone classifies nothing. "Nee, inkoop" is remembered per invoice.

## What it deliberately does not do

- Decide what is an asset. Never by amount, never by supplier name.
- Willekeurige afschrijving (starters), the bodemwaarde of a bedrijfspand, investeringsaftrek
  (KIA), and the boekwinst or -verlies on a sale. Each is named on the screen as a boekhouder's
  call; the register stops depreciating in the month of disposal and does nothing more.
- A gebruiksduur under five years: the migration refuses it (`assets_life_ordinary`).

## Deploy order

The migration `supabase/migrations/assets.sql` is applied by hand. Before it, the code reads an
empty register (a missing table is not an error) and every figure is byte-identical to today's.
After it, an owner with no rows sees exactly the same figures. Only a row changes a number.
