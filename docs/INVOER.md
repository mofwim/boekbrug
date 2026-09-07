# [INVOER] Which files and data the app must be able to read

Researched 7 September 2026 against what a Dutch zzp'er and their boekhouder actually hand over,
and checked against the readers in `src/lib/`. Sources are listed at the end.

## What the app reads today

| Source | Format | Reader | State |
|---|---|---|---|
| Bank statement | MT940, CAMT.053 (all NL banks) | `bank-parser.ts`, `bank-ingest.ts` | Balance-checked, continuity-checked |
| Bank export | CSV: ING, Rabobank, ABN AMRO, bunq, SNS, ASN, Regiobank, Triodos, Knab | `bank-csv.ts` | Per-bank column maps |
| Bank live | PSD2 via Enable Banking | `enablebanking-*.ts` | Deduplicated against uploads |
| Purchase invoice / receipt | PDF, JPG, PNG, HEIC (normalised client-side) | AI read + `safecore.ts` | Held when the read is not grounded |
| E-invoice | UBL 2.1 / Peppol BIS 3.0, Factur-X (embedded in PDF) | `ubl-*.ts`, `ubl-embedded-pdf.ts` | Read before the AI, never guessed |
| Archive | ZIP (daily till-closing bundles) | `archive-*.ts` | Opened, not discarded |
| Till day | Z-report PDF text, EFT/CTAP receipt | `daily-sales-report.ts`, `eft-parser.ts` | Verified on real Kiwi files |
| Sheets | XLS/XLSX/CSV: turnover per day, grootboek, kasboek | `detect-file.ts`, `spreadsheet-ingest.ts` | Verified on real Kiwi files, to the cent |

## What is missing, ranked by what it costs an owner

### 1. A letter from the Belastingdienst is not an invoice — and today it becomes one

Every zzp'er receives a voorlopige aanslag inkomstenbelasting and a Zvw-aanslag; many get a
btw-naheffing or a motorrijtuigenbelasting letter. Photographed and uploaded, such a letter has a
betaalkenmerk, an amount, an IBAN and a due date — everything the AI prompt lists as the marks of
an invoice. It is read as one, the owner confirms it, and `financial-result.ts` adds it to
`kosten`. Income tax paid from the business account is a **private withdrawal**, not a cost; a
btw-naheffing is a **settlement** of tax already declared; only motorrijtuigenbelasting on a
business car is a cost. The bank side already knows this (`bank-identity.ts` category `tax`); the
invoice side does not.

Today the database holds no such invoice, so nothing is wrong yet. It is the first upload away.

**What to build ([AANSLAG]):** the AI read names the letter's kind (`omzetbelasting`,
`inkomstenbelasting`, `zorgverzekeringswet`, `motorrijtuigenbelasting`, other), the intake keeps
it as a payable so the due date reaches the pay screen and the forecast, and the result engine and
the XAF export book it where it belongs: privé, the btw settlement account, or cost. No sample
file needed; the rule is in the law, and the letters are uniform.

### 2. XAF 3.2 stops being accepted on 1 January 2027

The auditfile export (`xaf-export.ts`) writes XAF 3.2. The Belastingdienst published XAF 4.0 in
February 2025 (4.0.3 is current), and its ODB notice of 22 April 2026 says that from 1 January
2027 only 4.0 is accepted. 4.0 cuts the elements from about 250 to about 90 and carries the RGS
code per account, which the export already has.

**Built ([XAF-4], 7 September 2026):** the owner handed over the 4.0.3 package (XSD, FunHie,
Toelichting, test file). One builder now writes both envelopes from the same balanced entries;
the 4.0 output is validated against the official XSD with xmllint in the tests, the route takes
`?version=4.0`, both screens offer both files, and the quarter package ships both. See
`docs/XAF4.md`.

### 3. Netted settlements: one document that carries revenue AND cost

Thuisbezorgd, Uber Eats, bol.com, Mollie, SumUp, Zettle and Adyen all pay out a **net** amount and
document it in one weekly or per-settlement file: turnover at 9% and 21%, commission at 21%, tips
without btw, refunds, and the payout. Read as a purchase invoice, only the commission books; the
turnover is missed and the bank payout has no invoice to match. Every Dutch package handles this
with a tussenrekening.

**Built for Mollie ([MOLLIE-AFREKENING], 7 September 2026):** no file at all — the
Settlements API, with the key the app already holds. Fee as a cost, payout line as a transfer,
payments not ours named for the owner. See `docs/MOLLIE_AFREKENING.md`. The same shape fits
SumUp and Zettle (public APIs on GitHub). Thuisbezorgd, Uber Eats, bol.com and Adyen have no
public sample and no reachable API spec here: **one real file per platform is still needed.**

### 4. PDF bank statements

Owners without an MT940/CAMT export hand over PDF statements. `detect-file.ts` deliberately does
not treat a PDF as a statement; it reaches the AI as a document. A layout-aware PDF reader per
bank is possible (the Z-report reader shows the pattern) but is wrong without samples: each bank's
PDF differs and a misread line is a wrong balance. **Needs one real PDF per bank.**

### 5. Other POS daily exports

The Z-report and EFT readers were built on Kiwi's till. Lightspeed, untill, MplusKASSA, Zettle
and SumUp each export a daily CSV/PDF with their own column names. **Needs one file per system.**

## Confirmed as already right, no work needed

- **MT940 is being retired by the banks** (BNG from August 2026; CAMT.053 is the successor). The
  app reads CAMT.053 with balance and continuity checks, so nothing changes for the owner.
- **E-invoicing B2B becomes mandatory in 2030 via Peppol** (ViDA; domestic 1 January 2030,
  cross-border 1 July 2030; draft bill Q4 2026). The app already writes and reads UBL / Peppol
  BIS 3.0. Sending through a Peppol access point is a later product decision, not a reader.

## Sources

- Mollie: settlement and balance exports as MT940 / CSV / CODA / PDF; CSV headers in Dutch for NL.
  https://help.mollie.com/hc/en-us/articles/115000667809 ·
  https://docs.mollie.com/docs/settlement-report
- XAF 4.0: https://odb.belastingdienst.nl/auditfiles/xmlauditfile-financieel-xaf-v-4-0-3/ ·
  https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave2/enterprise-resource-planning/dynamics365-finance/use-regulatory-update-audit-file-financial-xaf-4-netherlands-2026 ·
  https://balticassist.com/netherlands-xaf-4-0-2027-deadline/
- Banks: https://www.bngbank.nl/nieuws/bng-ondersteunt-vanaf-augustus-2026-alleen-elektronisch-rekeningafschrift-CAMT.053 ·
  https://www.ing.nl/zakelijk/betalen/betalingen-doen/bestandsformaten
- Thuisbezorgd / Uber Eats: https://www.jortt.nl/boekhouden/hoe-boek-ik/hoe-boek-ik-thuisbezorgd-verkoop-facturen/ ·
  https://www.jortt.nl/uitleg/faq/verkoop-via-thuisbezorgd-en-of-ubereats/
- bol.com: https://balancify.nl/kennisbank/e-commerce/bol-com-uitbetalingen-aanleveren-voor-de-administratie-zo-werkt-het/
- Voorlopige aanslag is private for a zzp'er: https://www.jortt.nl/uitleg/faq/als-zzp-zvw-boeken/
- ViDA / Peppol: https://www.peppol.nu/news-items/e-facturatie-b2b-verplichting-nederland-peppol-2030/ ·
  https://www.accountancyvanmorgen.nl/2026/03/12/verplichte-e-facturatie-komt-eraan-wat-betekent-vida-voor-uw-mkb-clienten/
