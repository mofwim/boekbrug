// src/lib/spreadsheet-ingest.ts
// [SHEET-INTAKE] Pure planner that turns an uploaded spreadsheet (a shop's monthly kassa
// Z-report, or the bookkeeper's PIN/kas grootboek export) into the exact rows the two
// EXISTING commit pipelines already store — daily_turnover (authoritative omzet + BTW) and
// ledger_daily (a reconciliation WITNESS, never money). This is the missing piece that lets
// the unified upload page book these files instead of filing them away as opaque "documents".
//
// No I/O, no SheetJS here — the caller hands us the cell matrix (from xlsx-adapter) and does
// the upsert. Fully testable (run: npx tsx src/lib/spreadsheet-ingest.test.ts) against the
// real Mei.xls / pin_ontvangst.xlsx / contant.xlsx layouts.
//
// Money-truth contract:
//   - TURNOVER feeds the VAT return, so it is only marked commit-safe when the normalizer's
//     own per-row arithmetic cross-checks pass with ZERO warnings (net+BTW ≈ gross, and the
//     payment split ≈ gross). Any warning → NOT auto-committed; the owner reviews in Dagomzet.
//     This mirrors the invoice auto-advance bar: clean+verified → book (reversible, audited);
//     anything flagged → human.
//   - LEDGER never reaches the P&L (reconcileTriangle uses it only as a gross cross-check), so
//     it is always safe to store — it can never move a money figure by itself.

import { detectSheetKind, type SheetKind } from "./detect-file";
import { parseKasboekSheet, type KasboekImportResult } from "./kasboek-import";
import { normalizeTurnoverSheet, type Cell, type ImportWarning } from "./turnover-import";
import type { DailyTurnover } from "./turnover";
import { parseLedgerSheet, ledgerDailyTotals, type LedgerKind } from "./ledger-import";

export interface TurnoverPlan {
  rows: DailyTurnover[];
  warnings: ImportWarning[];
  /** True only when there are rows AND no warnings — the sole condition for auto-committing
   *  omzet into the VAT picture without a human glance. */
  commitSafe: boolean;
}

export interface LedgerPlan {
  kind: LedgerKind; // pin | cash | bank | other
  accountNr: string | null;
  rows: { ledger_date: string; received: number; spent: number }[];
}

export interface SpreadsheetPlan {
  kind: SheetKind; // turnover | ledger | kasboek | unknown
  turnover?: TurnoverPlan;
  ledger?: LedgerPlan;
  /** [KASBOEK-LEZEN] Gelezen kasboek. Nooit een boeking — zie het blok in planSpreadsheetIngest. */
  kasboek?: KasboekImportResult;
}

/**
 * Classify a parsed spreadsheet matrix and produce the commit rows for its pipeline.
 * Returns kind: "unknown" (with no rows) for anything that is neither a kassa Z-report nor a
 * grootboek export — the caller then falls back to storing the raw file in bestanden.
 */
export function planSpreadsheetIngest(matrix: Cell[][]): SpreadsheetPlan {
  const kind = detectSheetKind(matrix);

  if (kind === "turnover") {
    const { rows, warnings } = normalizeTurnoverSheet(matrix);
    return {
      kind,
      turnover: { rows, warnings, commitSafe: rows.length > 0 && warnings.length === 0 },
    };
  }

  // [KASBOEK-LEZEN] Gelezen, geteld, en NIET geboekt. De reden staat voluit in kasboek-import.ts:
  // een deel van deze uitgaven staat al in de app, geboekt via de factuur die ermee is betaald, en
  // de boekhouder zet drie facturen op één regel van € 1.754,35. Klakkeloos overnemen boekt dubbel
  // in het kasboek — waar een dubbele uitgave het saldo verlaagt en niemand het merkt tot de lade
  // niet meer klopt. Welke regel welke bestaande boeking IS, kan alleen de eigenaar zeggen.
  if (kind === "kasboek") {
    const kasboek = parseKasboekSheet(matrix);
    if (!kasboek || kasboek.rows.length === 0) return { kind: "unknown" };
    return { kind, kasboek };
  }

  if (kind === "ledger") {
    const { ledger } = parseLedgerSheet(matrix);
    if (!ledger) return { kind: "unknown" }; // header looked like a ledger but didn't parse → store raw
    const daily = ledgerDailyTotals(ledger);
    const rows = [...daily.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ledger_date, t]) => ({ ledger_date, received: t.received, spent: t.spent }));
    if (rows.length === 0) return { kind: "unknown" };
    return { kind, ledger: { kind: ledger.kind, accountNr: ledger.accountNr, rows } };
  }

  return { kind: "unknown" };
}

/** A short Dutch human label for a ledger kind — used in the owner-facing result message. */
export function ledgerKindLabel(kind: LedgerKind): string {
  switch (kind) {
    case "pin": return "PIN-ontvangsten";
    case "cash": return "contante ontvangsten";
    case "bank": return "bankmutaties";
    default: return "grootboekregels";
  }
}
