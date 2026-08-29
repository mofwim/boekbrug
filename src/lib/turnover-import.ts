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
import { round2 } from "./invoice-totals";
import { amsterdamToday } from "@/lib/format-nl";

export interface ImportWarning {
  row: number;                 // 1-based data row (as the owner sees it), 0 = sheet-level
  code: string;
  message: string;             // Dutch, human-readable
}

export interface NormalizeResult {
  rows: DailyTurnover[];
  warnings: ImportWarning[];
}

/**
 * [DATE-WINDOW] The window a turnover day can possibly fall in. A day of takings cannot lie in
 * the future, and nothing in this app predates 2000.
 *
 * It exists because ONE slipped digit (2026 → 2062) used to be permanent and nearly invisible:
 * every quarter-bounded reader — readiness, kasboek, aangifte, the analytics panel, the result
 * engine — filters the day away, while /api/cash and /api/daily-truth sum daily_turnover.cash_amount
 * over ALL time with no date bound, so the phantom day silently inflated the drawer balance for
 * good. And the analytics panel defaults to the quarter of the MOST RECENT booked day, so the
 * Dagomzet page itself would open on Q1 2062 showing that one row while the owner's real quarter
 * sat behind the navigation — the "geboekt ✓ maar niks te zien" trap that default was written to
 * prevent, in a worse form.
 *
 * `todayAmsterdam` is injected so this stays pure and testable. Tomorrow is allowed: a device
 * clock or a timezone edge can legitimately be a day ahead of the server.
 */
export const TURNOVER_DATE_FLOOR = "2000-01-01";

export function turnoverDateOutOfWindow(iso: string, todayAmsterdam: string): boolean {
  const tomorrow = new Date(`${todayAmsterdam}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return iso < TURNOVER_DATE_FLOOR || iso > tomorrow.toISOString().slice(0, 10);
}

/**
 * Today in Amsterdam, as the app pins every other date boundary.
 *
 * [EEN-KLOK] Doorgegeven, niet nagebouwd. Deze functie stond hier twee keer in de repo — hier en
 * in format-nl.ts — met dezelfde regels erin getypt. Zolang beide gelijk zijn merkt niemand het,
 * en dat is precies het probleem: wie de ene ooit bijstelt (een schrikkelseconde, een andere
 * zone-strategie, een testbare klok) laat de andere achter, en dan bestaan er twee antwoorden op
 * "welke dag is het bij de eigenaar" — één in de kassa en één op de factuur.
 *
 * De aanroepers hoeven niets te weten: ze importeren hem nog steeds hier vandaan.
 */
export { amsterdamToday };

export type Cell = string | number | null | undefined;

const r2 = round2;

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

/**
 * [DATE-REAL] Does this ISO string name a day that EXISTS? The two parsers below validate the
 * month (1-12) and the day (1-31) INDEPENDENTLY, so "31-02-2026" came out as "2026-02-31" — a
 * string that looks like a date and is not one. It then passed the commit route's shape test
 * (ISO_DATE) and reached a Postgres `date` column, which rejects it and fails the ENTIRE upsert:
 * one bad cell, and a whole month of turnover comes back as "kon dagomzet niet opslaan" with
 * nothing naming the row. Round-tripping through UTC is the cheap, exact check.
 */
export function isRealCalendarDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
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
  // [DATE-REAL] Both forms now have to name a day that exists — 31 February is refused here
  // rather than three layers down at the database, where it takes the whole import with it.
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isRealCalendarDate(iso) ? iso : null;
  }
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD-MM-YYYY / DD/MM/YYYY
  if (m) {
    const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
    const iso = `${m[3]}-${mo}-${d}`;
    if (isRealCalendarDate(iso)) return iso;
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
export function normalizeTurnoverSheet(
  matrix: Cell[][],
  // [DATE-WINDOW] `today` is INJECTED, not read from the clock inside. This module's header
  // promises a pure normalizer, and reading `new Date()` here would have quietly broken that:
  // the same sheet would yield different warnings depending on when it was parsed, and this
  // file's tests — which run against real dated Z-report data — would rot with the calendar.
  opts?: { today?: string },
): NormalizeResult {
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
    if (!date) {
      // Skipping a blank or a "Totaal" row is right and always was. Skipping a row whose date
      // cell HAS content we could not read is a dropped sales day, and it used to happen in
      // total silence — the very thing [TURNOVER-BLANK-GROSS] below refuses to do for a missing
      // gross. The tightened parser above makes this reachable for an impossible date too
      // (31-02), so the day must be named rather than quietly lost.
      const raw = String(row[cols.date] ?? "").trim();
      const grossHere = num(row[cols.gross]);
      if (raw && grossHere !== 0) {
        warnings.push({
          row: dataRow + 1,
          code: "date_unreadable",
          message: `Rij met omzet ${grossHere.toFixed(2)}: de datum "${raw}" is niet te lezen als een bestaande dag — deze rij is NIET geïmporteerd. Controleer de datum en importeer opnieuw.`,
        });
      }
      continue;
    }
    dataRow += 1;

    const gross = num(row[cols.gross]);
    if (gross === 0) {
      // [TURNOVER-BLANK-GROSS] A blank "Omzet incl." is normally an empty day — skip it. But if the
      // row still carries PIN/cash/other takings OR per-rate bases, it's a REAL sales day with a
      // MISSING gross total: silently continuing would drop that day's omzet + BTW (a hidden revenue
      // understatement). We still don't import it — a fabricated gross would guess the BTW split — but
      // we WARN so the human sees the day, fixes the sheet, and re-imports, instead of losing it.
      const payActivity =
        (cols.pin >= 0 ? num(row[cols.pin]) : 0) +
        (cols.cash >= 0 ? num(row[cols.cash]) : 0) +
        sumCols(row, cols.other);
      const rateActivity =
        sumCols(row, cols.otherRate0) + sumCols(row, cols.otherRate9) + sumCols(row, cols.otherRate21) +
        sumCols(row, cols.htRate0) + sumCols(row, cols.htRate9) + sumCols(row, cols.htRate21);
      if (payActivity > 0 || rateActivity > 0) {
        warnings.push({
          row: dataRow,
          code: "gross_missing_with_payments",
          message: `Dag ${date}: er staan betalingen of BTW-bedragen, maar "Omzet incl." is leeg — deze dag is NIET geïmporteerd. Vul de omzet aan en importeer opnieuw.`,
        });
      }
      continue; // never import a day with an unknown gross (the BTW-split would be a guess)
    }
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
      // by arithmetic. With a Netto column that is a direct signal — pick the closer of the two
      // totals. Without one, the question is answered by RECONSTRUCTING the gross under each
      // reading and seeing which one lands on the number the sheet actually reports.
      const raw0 = sumCols(row, cols.otherRate0);
      const raw9 = sumCols(row, cols.otherRate9);
      const raw21 = sumCols(row, cols.otherRate21);
      const sumRates = raw0 + raw9 + raw21;
      const hasNet = cols.net >= 0 && netTotal > 0;
      // [NO-NETTO] The no-Netto rule used to be a tolerance: "call it gross only when the columns
      // sum to within 2% of the gross total, else net". That reads as conservative and is not,
      // because 0% money is IDENTICAL under both readings and still counts toward the sum.
      //
      // A shop with statiegeld: €100 at 0% and €1 at 21%, net columns, gross €101,21. The columns
      // sum to €101 — 0,2% off the gross — so the old rule called them gross, divided BTW out of
      // the €1, and booked €0,83 + €0,17 where €1,00 + €0,21 was owed. The 0% money, which the
      // decision cannot depend on, is what dragged the sum inside the tolerance. Turn the day
      // around (columns really gross) and the same rule agrees — which is the tell that the
      // tolerance was measuring the wrong thing.
      //
      // The two candidates below differ by exactly raw9·0,09 + raw21·0,21, which IS the BTW at
      // stake. So they can only be close when there is nothing to get wrong, and no tolerance
      // constant is needed: whichever reconstruction lands nearer the reported gross wins.
      const grossIfGross = sumRates;                            // columns already carry the BTW
      const grossIfNet = raw0 + raw9 * 1.09 + raw21 * 1.21;     // columns are net → add it
      const isGross = hasNet
        ? Math.abs(sumRates - gross) <= Math.abs(sumRates - netTotal)
        : Math.abs(grossIfGross - gross) <= Math.abs(grossIfNet - gross);
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

  // [DATE-WINDOW] Name any day that cannot exist BEFORE the owner approves. The commit route
  // refuses them outright; showing them here means the refusal is never a surprise, and the
  // owner sees which cell to fix rather than a rejected file.
  //
  // The sentence says what the route actually DOES, which it did not: "deze dag wordt niet
  // opgeslagen" describes a partial import — one day dropped, the rest booked — and the route has
  // no such mode. It refuses the whole payload ("Er is niets opgeslagen"), on purpose: a
  // half-imported month is worse than an unimported one because nobody can tell which half is in.
  // So the owner read that one day would be skipped, pressed Goedkeuren, and got a hard failure
  // over a file they had just been told was fine apart from one row. Two surfaces, one refusal,
  // one sentence.
  const today = opts?.today ?? amsterdamToday();
  for (const dt of rows) {
    if (turnoverDateOutOfWindow(dt.turnover_date, today)) {
      warnings.push({
        row: 0,
        code: "date_out_of_window",
        message: `${dt.turnover_date}: deze datum kan niet kloppen (een omzetdag ligt niet in de toekomst). Controleer het jaartal in je Z-rapport en importeer opnieuw — zolang deze datum erin staat, wordt het hele bestand niet opgeslagen.`,
      });
    }
  }

  if (rows.length === 0) {
    warnings.push({ row: 0, code: "no_rows", message: "Geen dag-omzet rijen met een geldige datum gevonden." });
  }
  return { rows, warnings };
}
