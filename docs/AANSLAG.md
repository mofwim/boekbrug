# [AANSLAG] A letter from the Belastingdienst is never a cost

## The defect this closes

A voorlopige aanslag inkomstenbelasting, a Zvw-aanslag, a btw-naheffing or a motorrijtuigen-
belasting letter has every mark the reader is told to look for in an invoice: a sender, an
amount, an IBAN, a betaalkenmerk and a due date. Photographed and confirmed, it landed in
`kosten`, and the year's result was wrong by the owner's own income tax. The bank side already
knew (`bank-identity.ts`, category `tax`); the invoice side did not. Measured on the live
administration on 7 September 2026: no such row yet. It was one upload away.

## The rule (`src/lib/tax-letter.ts`)

| Kind | Books as | Why |
|---|---|---|
| inkomstenbelasting, zorgverzekeringswet | privé (0500) | A zzp'er's income tax is not a cost of the business |
| omzetbelasting | settlement (1500) | Tax already declared; never a cost, never voorbelasting |
| motorrijtuigenbelasting | kosten (4000) | A cost when the car is the business's |
| overig, or a Belastingdienst sender with no kind | vraagposten (2100), withheld and named | The safe side is to claim less |

Two handles, so the rule reaches every row: the stored `invoices.tax_kind` (the reader names
it), and the sender's name (`isTaxOfficeName`) for rows written by a path that never asked.

## What changes, and what does not

- **The reader** returns `tax_kind` (closed list, else null) and is told a tax letter carries no btw.
- **Every insert path** stores it: camera/upload intake, e-mail sync, e-mail upload, re-import,
  read-as-invoice. A tax letter never auto-books (`auto-advance.ts`, reason `tax_letter`).
- **The result engine** withholds the whole gross from `kosten` and from voorbelasting in both
  schemes and reports it as `aanslagen`; the year screen names it under the balance card.
- **The auditfile** books the letter against the account its kind names and leaves 1400 alone.
- **Unchanged:** the payable itself. The due date reaches the pay screen and the forecast, the
  bank line that pays it matches as before, the queue shows a badge naming the kind.

## Gates

`tax-letter.test.ts`, `financial-result-aanslag.test.ts`, the XAF and auto-advance tests, a render
test for the badge, and two `[AANSLAG]` lifecycle gates: every insert path carries the kind, and
the engine withholds in both legs.
