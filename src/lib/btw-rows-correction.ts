// src/lib/btw-rows-correction.ts
// [SPLIT-CORRECTIE] The owner's correction of the per-rate BTW split, validated.
//
// ── WHY THE SPLIT IS EDITABLE AT ALL ──
// field_confidence._btw_rows is the specification as it stands ON THE PAPER — one row per rate,
// read by the checklist ("nagerekend") and by import-health, which holds an invoice when the
// split contradicts the totals. The reader gets it wrong exactly like any other field, and until
// now a wrong split was permanent: the checklist kept comparing the totals against a
// specification nobody could fix. The owner manages their business; the app is the tool.
//
// ── AND WHY IT MAY NOT BE EDITED FREELY ──
// A split that does not ADD UP to the invoice's own totals is worse than no split: every
// downstream reader would hold or clear the invoice based on arithmetic that contradicts itself.
// So a corrected split must pass, to the cent-ish, the same three facts the paper claims:
//   · each row's btw is its base × rate (rounding tolerance per row);
//   · the bases sum to total_ex_btw and the btw's to btw_amount (the FINAL totals — the ones
//     being written in the same request when amounts are edited together);
//   · rates are real Dutch rates, one row per rate.
// [CREDIT-SIGN] A creditnota stores its totals negative and its split rows follow that sign —
// the validation compares SIGNED values, so a credit split must be negative like its totals.
//
// Pure module: the route calls validate, the tests bite without a database.

// [CENT] The one cent-rounder — this file wrote its own and the gate bit, as designed.
import { round2 as r2 } from "./invoice-totals";

export interface BtwRow {
  rate: number;
  base: number;
  btw: number;
}

export type BtwRowsVerdict =
  | { ok: true; rows: BtwRow[] }
  | { ok: false; reason: string };

const ALLOWED_RATES = new Set([0, 9, 21]);
/** Per-row and per-sum tolerance: one rounding step on each side of the comparison. */
const TOLERANCE = 0.02;


/**
 * Validate an owner-submitted split against the invoice's (final) totals.
 * An EMPTY array is valid and means "clear the specification" — the caller decides storage.
 */
export function validateBtwRows(
  raw: unknown,
  totals: { totalExBtw: number; btwAmount: number },
): BtwRowsVerdict {
  if (!Array.isArray(raw)) return { ok: false, reason: "De specificatie moet een lijst van tariefregels zijn." };
  if (raw.length === 0) return { ok: true, rows: [] };
  if (raw.length > 3) return { ok: false, reason: "Een Nederlandse factuur kent hoogstens drie tarieven (21%, 9% en 0%)." };

  const rows: BtwRow[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const e = entry as { rate?: unknown; base?: unknown; btw?: unknown };
    const rate = Number(e?.rate);
    const base = Number(e?.base);
    const btw = Number(e?.btw);
    if (!ALLOWED_RATES.has(rate)) {
      return { ok: false, reason: `Tarief ${String(e?.rate)}% bestaat niet — kies 21, 9 of 0.` };
    }
    if (!Number.isFinite(base) || !Number.isFinite(btw)) {
      return { ok: false, reason: "Vul bij elke tariefregel een grondslag en een BTW-bedrag in." };
    }
    if (seen.has(rate)) return { ok: false, reason: `Tarief ${rate}% staat er twee keer in — één regel per tarief.` };
    seen.add(rate);
    // The row's own arithmetic: btw = base × rate. Rate 0 therefore requires btw 0 exactly
    // (within tolerance) — a 0%-row carrying BTW is a contradiction, not a rounding.
    const expected = r2(base * (rate / 100));
    if (Math.abs(btw - expected) > TOLERANCE) {
      return {
        ok: false,
        reason: `Bij ${rate}% over ${base.toFixed(2)} hoort ${expected.toFixed(2)} aan BTW — er staat ${btw.toFixed(2)}. Controleer welk getal verkeerd is.`,
      };
    }
    rows.push({ rate, base: r2(base), btw: r2(btw) });
  }

  // The split must BE the totals, redistributed — signed, so a creditnota's negative split
  // matches its negative totals and a positive split on a credit is refused, not sign-flipped.
  const sumBase = r2(rows.reduce((s, r) => s + r.base, 0));
  const sumBtw = r2(rows.reduce((s, r) => s + r.btw, 0));
  if (Math.abs(sumBase - totals.totalExBtw) > TOLERANCE) {
    return {
      ok: false,
      reason: `De grondslagen tellen op tot ${sumBase.toFixed(2)}, maar het bedrag excl. BTW is ${totals.totalExBtw.toFixed(2)} — de specificatie moet de factuur zelf zijn, verdeeld per tarief.`,
    };
  }
  if (Math.abs(sumBtw - totals.btwAmount) > TOLERANCE) {
    return {
      ok: false,
      reason: `De BTW-bedragen tellen op tot ${sumBtw.toFixed(2)}, maar de factuur draagt ${totals.btwAmount.toFixed(2)} aan BTW.`,
    };
  }

  // Stable order, highest rate first — the order the paper and every screen use.
  rows.sort((a, b) => b.rate - a.rate);
  return { ok: true, rows };
}
