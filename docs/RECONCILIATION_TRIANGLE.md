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

## What is NOT wired yet (⚠️ the commission is 0 in production TODAY)

`reconcileTriangle` is called by **no route**, and **no caller passes `acquirerCommission`**
(the `result`, `aangifte`, `readiness` routes and `closing-package.ts` all use the 5-arg
form → it defaults to 0). So in the live app the acquirer commission is **still not booked**
and **profit is still overstated** — the pure engines above are correct but unreachable.

Remaining wiring to make the loop live (needs a running app + Supabase to verify):

1. **Store EFT settlements** — a `eft_settlements` table + migration; an OCR/parse route
   that runs `looksLikeEftReceipt` → `parseEftSettlement` on a photographed receipt
   (add an `eft_afsluiting` document kind to `ai.ts`).
2. **Store the ledger cross-check** — route OVERZICHT/KASBOEK xlsx via `detectSheetKind`
   → `parseLedgerSheet` (not the bank endpoint).
3. **Per-day `bankNetByDay`** — query `pos_income` settlements grouped by takings day.
4. **Call `reconcileTriangle`** in the result/aangifte/readiness/closing-package paths and
   pass `totalCommission` into `computeResult` — **de-duped** against any acquirer-fee
   invoice already in `kosten` (today that de-dup is documented in a comment only; it must
   become real caller code, or the fee is double-counted).
5. **Surface** the commission + Leg-A exceptions in the closing package and the owner view;
   persist the original Z-report as evidence.
6. **Fix the latent trap**: a spreadsheet dropped on the bank endpoint is stored as
   `doc_type:"bankafschrift"` with a content_hash — mis-filed, and its byte-hash can later
   block re-uploading the same file to the correct importer.

Until steps 1–5 land and are smoke-tested, treat the profit/commission figures in the live
app as NOT yet reconciled.
