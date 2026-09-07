# [XAF-4] The auditfile in the schema the Belastingdienst accepts from 2027

## Why

The Belastingdienst published XML Auditfile Financieel 4.0 on 19 February 2025 (4.0.3 on 10 April
2025). Its ODB notice says that from 1 January 2027 only 4.0 is accepted; 3.2 (2014), the schema
every Dutch package imports today, stops being accepted on that day. The app wrote 3.2 only.

## What it is

One builder, two envelopes. `buildXafFile(input, { version: "4.0" })` writes the same balanced
entries as the 3.2 file — the same journals, the same lines, the same refusals — inside the 4.0
schema. A test asserts the two files' line triples are identical.

| 3.2 | 4.0 | Note |
|---|---|---|
| `xmlns="http://www.auditfiles.nl/XAF/3.2"` | `…/Belastingdienst/BCPP/1.1/structures/XmlauditfileXAF_4.0` | The XSD's targetNamespace, which the official test file uses. The Toelichting §3.7 names a different one; the schema is the authority. |
| `companyIdent` (required, empty when unknown) | `Commercenr` (optional, omitted when unknown) | |
| `leadReference` | `RGScode`, unique per account (rule [0003]) | The three omzet accounts share `WOmz`, so in 4.0 none carries it. |
| — | `Source` on every transaction | "BoekBrug" |
| — | `invRef` on every line that comes from an invoice | The invoice number, a factuurvereiste. |
| — | `openingBalance` (optional) | Not emitted. BoekBrug keeps no balance sheet; a 0.00 opening balance would be a claim. Stated in the file's LET OP block. |

Everything else — header, customersSuppliers, vatCodes, periods, transactions — has the same
element names and order in both schemas.

## Where

- `/api/xaf?year=2026&version=4.0` (default stays 3.2 until the accountants' packages import 4.0).
- The year screen and the accountant werkboard offer both files.
- The quarter package ships both: `Auditfile-YYYY-tm-Qn.xaf` and `…-XAF4.xaf`, and LEESMIJ says
  to import one of the two, never both.

## Proof

`schemas/xaf/` holds the official XSD and the Belastingdienst's own test file. The test
`[XAF-4] the output validates against the official XSD` runs xmllint against the schema: first on
the official test file (proving the validator), then on a 3.2 file (which must fail), then on a
rich 4.0 file and an empty one (which must pass). The Belastingdienst's ValidatieTestService
(vts.belastingdienst.nl, regeling XAF_AuditfileFinancieel, release XAF_AuditfileFinancieel_4.0)
is the final check and needs an ODB subscription; the consistency rules it adds ([0004]–[0010]:
totals equal sums, debit equals credit per transaction) are what the builder already enforces by
construction.
