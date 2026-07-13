// src/lib/turnover-import.ts
// [TURNOVER-IMPORT] Pure normalizer: a raw spreadsheet cell grid → the internal
// DailyTurnover schema. NO SheetJS, NO I/O — the file-format adapter (xlsx-adapter.ts)
// hands us a plain matrix, and everything downstream (analytics, reconciliation, the
// result engine) speaks DailyTurnover, never Excel/CSV. That boundary is the whole point:
// swap the parser, the KPIs don't change. Fully testable (run: npx tsx
// src/lib/turnover-import.test.ts) against the real feb.xls layout.
//
// Format reality (learned from a real store's Z-report, feb.xls): columns are matched by
// HEADER TEXT (not position — POS exports reorder), and the per-rate columns are trusted
// by ARITHMETIC, not by their label. That file labels its per-rate columns "Base TC 9%"
// but the values are GROSS (incl. BTW) — proven because the per-rate columns sum to
// "Omzet incl.", not to "Netto Omzet". So we detect gross-vs-net per row and derive the
// net base + BTW accordingly. Trust the math, not the label.

import type { DailyTurnover } from "./turnover";

export interface ImportWarning {
  row: number;                 // 1-based data row (as the owner sees it), 0 = sheet-level
  code: string;
  message: string;             // Dutch, human-readable
}

export interface NormalizeResult {
  rows: DailyTurnover[];
  warnings: ImportWarning[];
}

export type Cell = string | number | null | undefined;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Parse a cell to a number: accepts a JS number or an NL/EN string ("1.234,56" / "1234.56"). */
function num(v: Cell): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim();
  if (!s) return 0;
  // NL number: dot = thousands, comma = decimal. Only strip dots when a comma is present.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  s = s.replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a header cell for matching: lowercase, collapse spaces, strip %/punct spacing. */
function normHeader(v: Cell): string {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Parse a date cell → ISO 'YYYY-MM-DD', or null. Accepts ISO, DD-MM-YYYY, DD/MM/YYYY, Date. */
function parseDate(v: Cell): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD-MM-YYYY / DD/MM/YYYY
  if (m) {
    const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) return `${m[3]}-${mo}-${d}`;
  }
  return null;
}

interface ColMap {
  date: number;
  gross: number;               // "Omzet incl."
  net: number;                 // "Netto Omzet"
  rate0: number[];             // may be several 0% columns → summed
  rate9: number[];
  rate21: number[];
  cash: number;                // "Contant"
  pin: number;                 // "PIN"
  other: number[];             // "Betaling_*" → summed
}

/** Locate the header row and map known Dutch labels → column indices (position-independent). */
function mapColumns(matrix: Cell[][]): { header: number; cols: ColMap } | null {
  for (let h = 0; h < Math.min(matrix.length, 10); h++) {
    const heads = (matrix[h] ?? []).map(normHeader);
    const find = (re: RegExp) => heads.findIndex((x) => re.test(x));
    const findAll = (re: RegExp) => heads.map((x, i) => (re.test(x) ? i : -1)).filter((i) => i >= 0);
    const date = find(/^datum/);
    const gross = find(/omzet incl/);
    if (date < 0 || gross < 0) continue; // not the header row
    return {
      header: h,
      cols: {
        date,
        gross,
        net: find(/netto/),
        rate0: findAll(/base.*\b0\s*%/),
        rate9: findAll(/base.*\b9\s*%/),
        rate21: findAll(/base.*\b21\s*%/),
        cash: find(/contant/),
        pin: find(/^pin$|\bpin\b/),
        other: findAll(/betaling/),
      },
    };
  }
  return null;
}

const sumCols = (row: Cell[], idx: number[]) => idx.reduce((s, i) => s + num(row[i]), 0);

/**
 * Normalize a raw spreadsheet grid into DailyTurnover rows + warnings. The per-rate
 * amounts are interpreted by arithmetic: if the three rate columns sum closer to the
 * gross total than to the net total, they are gross (incl. BTW) and we divide out the
 * BTW; otherwise they are already net and we add BTW on top. Every row is cross-checked
 * (net+BTW ≈ gross, and cash+pin+other ≈ gross); a mismatch is a WARNING, never a
 * silent "clean" import.
 */
export function normalizeTurnoverSheet(matrix: Cell[][]): NormalizeResult {
  const warnings: ImportWarning[] = [];
  const rows: DailyTurnover[] = [];

  const mapped = mapColumns(matrix);
  if (!mapped) {
    warnings.push({ row: 0, code: "no_header", message: "Geen herkenbare kop-rij (Datum / Omzet incl.) gevonden." });
    return { rows, warnings };
  }
  const { header, cols } = mapped;
  if (cols.rate9.length === 0 && cols.rate21.length === 0) {
    warnings.push({ row: 0, code: "no_rate_columns", message: "Geen BTW-tarief kolommen (9% / 21%) gevonden — kan omzet niet per tarief splitsen." });
  }

  let dataRow = 0;
  for (let r = header + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const date = parseDate(row[cols.date]);
    if (!date) continue; // skip blanks / total rows without a real date
    dataRow += 1;

    const gross = num(row[cols.gross]);
    if (gross === 0) continue; // an empty day — nothing to import
    const netTotal = cols.net >= 0 ? num(row[cols.net]) : 0;

    const raw0 = sumCols(row, cols.rate0);
    const raw9 = sumCols(row, cols.rate9);
    const raw21 = sumCols(row, cols.rate21);
    const sumRates = raw0 + raw9 + raw21;

    // Gross-vs-net detection: which total do the rate columns match?
    const isGross = Math.abs(sumRates - gross) <= Math.abs(sumRates - netTotal);

    const split = (raw: number, rate: number) =>
      isGross
        ? { base: r2(raw / (1 + rate / 100)), btw: r2(raw - raw / (1 + rate / 100)) }
        : { base: r2(raw), btw: r2(raw * (rate / 100)) };

    const s9 = split(raw9, 9);
    const s21 = split(raw21, 21);
    const base0 = r2(raw0); // 0% base == gross == net

    const cash = cols.cash >= 0 ? num(row[cols.cash]) : 0;
    const pin = cols.pin >= 0 ? num(row[cols.pin]) : 0;
    const other = sumCols(row, cols.other);

    const dt: DailyTurnover = {
      turnover_date: date,
      base_0: base0,
      base_9: s9.base,
      base_21: s21.base,
      btw_9: s9.btw,
      btw_21: s21.btw,
      total_incl: r2(gross),
      pin_amount: cols.pin >= 0 ? r2(pin) : null,
      cash_amount: cols.cash >= 0 ? r2(cash) : null,
      other_amount: cols.other.length ? r2(other) : null,
    };
    rows.push(dt);

    // Cross-checks (tolerant: a few cents of per-line rounding across a day is fine).
    const tol = Math.max(0.05, 0.005 * gross);
    const netPlusBtw = base0 + s9.base + s21.base + s9.btw + s21.btw;
    if (Math.abs(netPlusBtw - gross) > tol) {
      warnings.push({ row: dataRow, code: "rate_total_mismatch",
        message: `${date}: som van tarieven (${netPlusBtw.toFixed(2)}) ≠ Omzet incl. (${gross.toFixed(2)}).` });
    }
    const paySum = cash + pin + other;
    if ((cols.cash >= 0 || cols.pin >= 0) && Math.abs(paySum - gross) > tol) {
      warnings.push({ row: dataRow, code: "payment_total_mismatch",
        message: `${date}: som van betaalwijzen (${paySum.toFixed(2)}) ≠ Omzet incl. (${gross.toFixed(2)}).` });
    }
  }

  if (rows.length === 0) {
    warnings.push({ row: 0, code: "no_rows", message: "Geen dag-omzet rijen met een geldige datum gevonden." });
  }
  return { rows, warnings };
}
