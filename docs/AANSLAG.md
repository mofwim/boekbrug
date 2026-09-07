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
- **Motorrijtuigenbelasting** is the one kind that IS a cost — for its whole gross. A "btw" the
  reader split off any letter is a misread (no letter of the Belastingdienst carries btw) and
  never reaches 5b or account 1400, in either scheme.
- **Under kasstelsel** the kinds come from the settlement fetch, not from the window's dated
  invoices: a voorlopige aanslag dated 20 March and paid 5 April is a Q2 settlement of a Q1
  letter, and Q2's own date-range map had never seen it — it booked as a cost with voorbelasting.
  `fetchSettlementEvents` now carries `taxKindByInvoice` for every settled purchase and
  `mergeSchemeOpts` merges it like the rate mix and the deductions.
- **The kind can only come from the tax office.** The reader's `tax_kind` is dropped unless the
  vendor name is the Belastingdienst; an accountant's invoice for "verzorgen aangifte
  inkomstenbelasting" is a cost with reclaimable btw, and the model named it after the tax it
  mentioned. The name rule accepts "Belastingsdienst" and "Rijksbelastingdienst" too.
- **The owner corrects it.** The correction editor (`InvoiceCorrectionModal`, the amounts door)
  carries "Soort document": ordinary invoice or one of the five kinds. A stored kind on a
  non-tax-office sender is still honoured — that is the owner's word.
- **The closing package and the CSV export** list a letter as `aanslag <kind>`, keep it out of
  the per-rate inkoop table and give it its own gross line, so the overview and the concept
  aangifte in the same package no longer contradict each other.
- **Unchanged:** the payable itself. The due date reaches the pay screen and the forecast, the
  bank line that pays it matches as before, the queue shows a badge naming the kind.

## Gates

`tax-letter.test.ts`, `financial-result-aanslag.test.ts`, the XAF and auto-advance tests, a render
test for the badge, and two `[AANSLAG]` lifecycle gates: every insert path carries the kind; the engine withholds
in both legs, MRB books gross without voorbelasting in both legs and in the auditfile, the
settlement fetch builds and merges the settled kinds, the reader gates on the sender, the door
and the editor offer the kind, and the package and export name a letter as one.
