# Reconciliation triangle — status (honest)

The store's card takings have three witnesses of the same money:

1. **Till (POS Z-report)** — PIN total, **gross**. `daily_turnover` / `turnover-import.ts`.
2. **EFT terminal settlement** (Equens CTAP receipt) — card total per shift, **gross**, split
   per scheme. `eft-parser.ts`.
3. **Bank** — the acquirer's payout, **net** of commission, T+1, weekend shifts merged.
   Cross-checked by the bookkeeper's PIN/cash ledger (`ledger-import.ts`), also **gross**.

The honest loop: `till PIN == EFT gross` (Leg A — a break is a real discrepancy) and
`EFT gross − bank net = acquirer commission` (Leg B — a real cost + reclaimable BTW).

## What is DONE and PROVEN (pure libs, test-first, verified on the real Kiwi files)

| Module | Role | Tests |
| --- | --- | --- |
| `eft-parser.ts` | terminal settlement receipt → gross + per-scheme | 26 |
| `ledger-import.ts` | OVERZICHT/KASBOEK xlsx → per-day gross PIN/cash | 25 |
| `card-reconcile.ts` | Leg A + Leg B + commission, honesty guards | 20 |
| `triangle.ts` | assemble per-day inputs, aggregate commission | 13 |
| `financial-result.ts` | `computeResult(..., acquirerCommission)` books it as cost | 41 |
| `detect-file.ts` | route files to the right parser; close the false-green trap | 11 |

Proven end-to-end on the real files: POS PIN 2026-07-12 (1546.46) == EFT gross (1546.46) ==
Σ schemes; PIN ledger 2086.65 / cash ledger 216.45 == the till's gross on 2026-07-03.

## What is now WIRED into the live app

The triangle is connected end-to-end (commits a77233a + ba72eb1); the acquirer commission
is booked and profit is no longer overstated in `/api/result`:

1. **EFT storage** — `eft_settlements` table + migration + generated types.
2. **EFT ingest** — `POST /api/eft/import`: image/PDF → `ai.ts transcribeEftReceipt`
   (verbatim OCR) → the proven `parseEftSettlement` → preview → owner-reviewed commit
   (upsert). Commit requires terminal_id + period_nr so the natural key is complete
   (no NULL-key duplicate rows).
3. **Per-day `bankNetByDay`** — built in `/api/result` from `pos_income` lines, keyed by the
   same `parsePosSettlement(...).date ?? bookingDate` as the covered-day de-dup.
4. **`reconcileTriangle` + commission** — `/api/result` runs the triangle and passes the
   commission to `computeResult`, **de-duped as real code** (`netCommissionToBook` +
   `ACQUIRER_VENDOR_RE` over the raw invoice rows, gated to paid/received status). A
   `reconciliation` block (raw vs booked commission, Leg-A exceptions) is returned.
5. **Ledger mis-route guard** — a grootboek/kas xlsx on the turnover import gets a clear
   "wrong kind" message; a spreadsheet on the bank endpoint is reported truthfully
   (nonBankSpreadsheet) instead of a silent 0-transaction passthrough.

Verify with `docs/verify-triangle.sql` after applying the migration and uploading receipts.

## Still open (smaller, lower priority)

- **Ledger cross-check as a stored witness** — `parseLedgerSheet` exists and is tested, but
  the PIN/cash ledger totals are not yet stored/fed as `pinLedgerByDay` (the triangle uses
  it optionally; Leg A still verifies via till == EFT without it).
- **Closing-package**: its `computeResult` feeds only the BTW aangifte (commission has no
  BTW) and never shows profit, so it is intentionally unchanged. If a profit/commission line
  is ever added to the ZIP, wire the same triangle call there.
- **Persist the original Z-report** — `daily_turnover.document_id` exists but the import flow
  does not yet store the uploaded file and link it.
- **Latent**: a spreadsheet dropped on the bank endpoint is still stored as
  `doc_type:"bankafschrift"` with a content_hash — mis-filed, and its byte-hash could block
  re-uploading the same file to the correct importer.

These need a running app + Supabase to smoke-test; the wiring above is type-checked and the
pure engines are unit-tested, but a live upload → DB → `/api/result` pass is the final proof.
