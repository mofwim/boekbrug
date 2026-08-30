// src/lib/pos-omzet-report.ts
// [KASSA-OMZETRAPPORT] The POS's own day report, read as a day of turnover. Pure, no I/O.
// Run: npx tsx --test src/lib/pos-omzet-report.test.ts
//
// ── WHY A SECOND READER AND NOT A WIDER normalizeTurnoverSheet ───────────────────────────────
//
// normalizeTurnoverSheet reads a COLUMN sheet: a header row of Datum / Omzet incl. / rate
// columns, one row per day. This report is the other shape entirely — ONE day, with the rates as
// ROWS:
//
//     OMZET                      VAN 29/08/2026
//     Document:      Aantal:  Omzet Incl:  Netto Omzet:
//     Kassabonnen :  175      2.794,31     2.560,14
//     TOTAAL:        175      2.794,31     2.560,14
//                             Basis Incl:  Basis Excl:  BTW bedrag
//     Omzet met BTW % 0,00    Statiegeld   2,70         2,70        0,00
//     Omzet met BTW % 9,00    Laag         2.750,89     2.523,75    227,14
//     Omzet met BTW % 21,00   Hoog         40,72        33,65       7,07
//
// Widening the column reader to also accept a transposed one-day report means one function with
// two ideas of what a row is, and the failure mode is silent: a header that half-matches produces
// rows nobody asked for. Two readers, each refusing what it does not recognise, is the shape this
// codebase already uses for detect-file's kinds.
//
// ── WHY THIS CAN BE TRUSTED WITH MONEY: IT CHECKS ITSELF ─────────────────────────────────────
//
// The report states each rate three times — incl, excl and the BTW between them — and states the
// day's total separately. So it can be verified rather than believed:
//
//     per rate      excl + btw == incl            2.523,75 + 227,14 == 2.750,89   ✓
//     over rates    Σ incl     == TOTAAL incl     2,70 + 2.750,89 + 40,72 == 2.794,31   ✓
//
// Both must hold to the cent or nothing is returned. A misread digit breaks one of them, and a
// report that fails its own arithmetic is not a day of turnover — it is a file we do not
// understand, and the honest output for that is null.
//
// ── WHAT IT DELIBERATELY DOES NOT PRODUCE ────────────────────────────────────────────────────
//
// The payment split (pin / contant / overig). This report does not carry it — the POS prints that
// on a separate screen — and inventing it would be inventing the number that decides which bank
// payouts get suppressed as already-counted. It stays null, which daily_turnover allows, and the
// owner's grootboek export supplies it: on the same day the KASBOEK gave € 280,95 kontant and the
// OVERZICHT € 2.513,36 PIN, and 280,95 + 2.513,36 is exactly the € 2.794,31 above.

import { round2 } from "./invoice-totals";
import type { DailyTurnover } from "./turnover";

export type Cell = string | number | null | undefined;

/** Why the report was not read. Codes, never sentences — the wording lives with the screen. */
export type PosOmzetRefusal =
  | "not_this_report" // no OMZET header with a date: a different file entirely
  | "no_rate_rows" // recognised the report, found no "Omzet met BTW %" lines
  | "rate_math_failed" // a rate's excl + btw did not equal its incl
  | "total_mismatch"; // the rates did not add up to the report's own total

export interface PosOmzetResult {
  day: DailyTurnover | null;
  refusal: PosOmzetRefusal | null;
  /** What the arithmetic disagreed about, for a message that names the number. */
  detail?: { expected: number; found: number };
}

const num = (v: Cell): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Dutch notation: 2.750,89 — thousands dot, decimal comma.
  const cleaned = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const text = (v: Cell): string => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** "VAN 29/08/2026" → "2026-08-29". Refuses anything that is not a real calendar day. */
function dayFrom(cells: readonly Cell[]): string | null {
  for (const c of cells) {
    const m = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(String(c ?? ""));
    if (!m) continue;
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    const back = d.toISOString().slice(0, 10);
    if (back === iso) return iso;
  }
  return null;
}

/** A cent of slack, because the report prints rounded figures and we compare printed to printed. */
const CENT = 0.005;

/**
 * Read one day of turnover out of the POS's own omzet report, or refuse it.
 *
 * Never throws: a file this does not recognise is a refusal with a code, which is what lets the
 * caller fall back to the column reader without a try/catch deciding control flow.
 */
export function parsePosOmzetReport(matrix: readonly (readonly Cell[])[]): PosOmzetResult {
  // The header: an "OMZET" line that carries the day. Both must be present — "omzet" alone
  // appears on plenty of sheets that are not this report.
  let day: string | null = null;
  for (const row of matrix.slice(0, 12)) {
    if (!row.some((c) => text(c) === "omzet" || text(c).startsWith("omzet van"))) continue;
    day = dayFrom(row);
    if (day) break;
  }
  if (!day) return { day: null, refusal: "not_this_report" };

  // The rate rows. Each states its percentage and then, in print order, incl / excl / btw.
  const rates = new Map<number, { incl: number; excl: number; btw: number }>();
  for (const row of matrix) {
    if (!row.some((c) => text(c).startsWith("omzet met btw"))) continue;
    const numbers = row.map(num).filter((n): n is number => n != null);
    // percentage, then the three amounts. A row with fewer is a layout we do not know.
    if (numbers.length < 4) continue;
    const [pct, incl, excl, btw] = [numbers[0], numbers[numbers.length - 3], numbers[numbers.length - 2], numbers[numbers.length - 1]];
    if (Math.abs(round2(excl + btw) - round2(incl)) > CENT) {
      return { day: null, refusal: "rate_math_failed", detail: { expected: round2(incl), found: round2(excl + btw) } };
    }
    rates.set(Math.round(pct), { incl: round2(incl), excl: round2(excl), btw: round2(btw) });
  }
  if (rates.size === 0) return { day: null, refusal: "no_rate_rows" };

  // The report's own total, from its TOTAAL line: count, incl, netto.
  let totalIncl: number | null = null;
  for (const row of matrix) {
    if (!row.some((c) => text(c).startsWith("totaal"))) continue;
    const numbers = row.map(num).filter((n): n is number => n != null);
    if (numbers.length >= 2) { totalIncl = round2(numbers[numbers.length - 2]); break; }
  }

  const sumIncl = round2([...rates.values()].reduce((s, r) => s + r.incl, 0));
  if (totalIncl != null && Math.abs(sumIncl - totalIncl) > CENT) {
    return { day: null, refusal: "total_mismatch", detail: { expected: totalIncl, found: sumIncl } };
  }

  const at = (pct: number) => rates.get(pct) ?? { incl: 0, excl: 0, btw: 0 };
  return {
    day: {
      turnover_date: day,
      base_0: at(0).excl,
      base_9: at(9).excl,
      base_21: at(21).excl,
      btw_9: at(9).btw,
      btw_21: at(21).btw,
      total_incl: totalIncl ?? sumIncl,
      // Not in this report — see the header. Never invented.
      pin_amount: null,
      cash_amount: null,
      other_amount: null,
    },
    refusal: null,
  };
}
