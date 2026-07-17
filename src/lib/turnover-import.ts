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
  // [L1] Capture the SIGN before the separators are normalised and non-numerics stripped.
  // Accounting/POS exports write a negative (a refund/correction day) as "(1.234,56)" or a
  // leading/trailing minus. The old strip removed the brackets and dropped the sign, so a
  // refund day was counted as POSITIVE omzet — an overstatement. Detect all three forms.
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/^-/.test(s) || /-$/.test(s)) negative = true;
  // Disambiguate NL ("1.234,56") vs EN ("1,234.56"): whichever separator appears LAST is
  // the decimal; the other is the thousands separator. This fixes EN thousands, which the
  // old "comma → decimal" rule misread ("1,234.56" → 1.23456). A bare comma (no dot) is
  // treated as an NL decimal — the norm for a Dutch POS export.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    // [QF5] Lone dot, no comma. In NL data a dot is the THOUSANDS separator when it groups
    // exactly 3 digits ("2.500" = 2500, "1.234.567" = 1234567); it is a decimal point
    // otherwise ("2.5", "12.50", "1234.567"). Without this a whole-euro Z-report value like
    // "2.500" imported as 2,50 — a 1000× understatement of omzet + BTW that the net+btw≈gross
    // cross-check can't catch when the whole row scales the same way.
    const digits = s.replace(/[^\d.]/g, "");
    if (/^\d{1,3}(\.\d{3})+$/.test(digits)) s = s.replace(/\./g, ""); // NL thousands → strip dots
  }
  // Sign is already captured — strip EVERYTHING non-numeric (incl. minus/brackets) so a
  // stray "12-34" can't be misparsed; then re-apply the detected sign.
  s = s.replace(/[^\d.]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/** Normalize a header cell for matching: lowercase, collapse spaces, strip %/punct spacing. */
function normHeader(v: Cell): string {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Parse a date cell → ISO 'YYYY-MM-DD', or null. Accepts ISO, DD-MM-YYYY, DD/MM/YYYY, Date. */
function parseDate(v: Cell): string | null {
  if (v == null) return null;
  // Excel serial date: a bare number in the Datum cell (the .xls stores dates this way).
  // The adapter's cellDates usually converts it to a Date→ISO, but handle a raw serial
  // defensively so a mis-tagged cell never silently drops the whole day. The 1899-12-30
  // epoch absorbs Excel's 1900 leap-year quirk for any modern date.
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
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
  // Per rate, split into HT (Hors Taxe = NET) and OTHER ("Base TC" = gross, or a generic
  // "Base" whose gross/net is decided by arithmetic). When HT columns exist (month.xls),
  // base = HT and BTW = TC − HT (exact). When they don't (feb.xls), the OTHER set is a
  // single set interpreted by arithmetic. This is what stops HT+TC being summed (which
  // doubled the omzet on the real month.xls export).
  htRate0: number[]; htRate9: number[]; htRate21: number[];
  otherRate0: number[]; otherRate9: number[]; otherRate21: number[];
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
    // Base columns for a rate, split by whether the header carries the HT (net) marker.
    const baseCols = (rate: number, wantHt: boolean) =>
      heads
        .map((x, i) => (new RegExp(`base.*\\b${rate}\\s*%`).test(x) && /\bht\b/.test(x) === wantHt ? i : -1))
        .filter((i) => i >= 0);
    return {
      header: h,
      cols: {
        date,
        gross,
        net: find(/netto/),
        htRate0: baseCols(0, true), htRate9: baseCols(9, true), htRate21: baseCols(21, true),
        otherRate0: baseCols(0, false), otherRate9: baseCols(9, false), otherRate21: baseCols(21, false),
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
  const has9 = cols.htRate9.length + cols.otherRate9.length > 0;
  const has21 = cols.htRate21.length + cols.otherRate21.length > 0;
  if (!has9 && !has21) {
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

    const hasHT = cols.htRate0.length + cols.htRate9.length + cols.htRate21.length > 0;

    let s9: { base: number; btw: number };
    let s21: { base: number; btw: number };
    let base0: number;

    if (hasHT) {
      // Pair mode (month.xls): HT is the NET base, TC is the GROSS. Decide gross-vs-net
      // PER RATE, not globally — a single global hasHT flag mis-booked a rate that appears
      // ONLY as a TC (gross) column: its HT sum was 0, so btw = gross − 0 = the WHOLE gross
      // and net omzet vanished, silently (net+btw still equalled gross, so the cross-check
      // passed). Per rate: HT+TC → btw = TC − HT (exact); HT only → btw = net·rate; TC only →
      // derive net arithmetically from the gross (net = gross/(1+rate); btw = gross − net).
      const splitRate = (htCols: number[], tcCols: number[], rate: number): { base: number; btw: number } => {
        const net = sumCols(row, htCols);
        const gross = sumCols(row, tcCols);
        if (htCols.length && tcCols.length) return { base: r2(net), btw: r2(gross - net) };
        if (htCols.length) return { base: r2(net), btw: r2((net * rate) / 100) };
        if (tcCols.length) {
          const n = gross / (1 + rate / 100);
          return { base: r2(n), btw: r2(gross - n) };
        }
        return { base: 0, btw: 0 };
      };
      s9 = splitRate(cols.htRate9, cols.otherRate9, 9);
      s21 = splitRate(cols.htRate21, cols.otherRate21, 21);
      // 0% carries no BTW; HT and TC are the same money there — prefer HT, else TC.
      base0 = r2(cols.htRate0.length ? sumCols(row, cols.htRate0) : sumCols(row, cols.otherRate0));
    } else {
      // Legacy single-set (feb.xls / a net-only POS): one "Base" set, gross-vs-net decided
      // by arithmetic. With a Netto column, pick the closer of gross/net; without one, only
      // call it gross when the columns SUM to the gross total (≤2%), else treat as net base.
      const raw0 = sumCols(row, cols.otherRate0);
      const raw9 = sumCols(row, cols.otherRate9);
      const raw21 = sumCols(row, cols.otherRate21);
      const sumRates = raw0 + raw9 + raw21;
      const hasNet = cols.net >= 0 && netTotal > 0;
      const isGross = hasNet
        ? Math.abs(sumRates - gross) <= Math.abs(sumRates - netTotal)
        : Math.abs(sumRates - gross) <= 0.02 * Math.max(1, Math.abs(gross));
      const split = (raw: number, rate: number) =>
        isGross
          ? { base: r2(raw / (1 + rate / 100)), btw: r2(raw - raw / (1 + rate / 100)) }
          : { base: r2(raw), btw: r2(raw * (rate / 100)) };
      s9 = split(raw9, 9);
      s21 = split(raw21, 21);
      base0 = r2(raw0);
    }

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
