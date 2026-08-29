// src/lib/pos-commission.ts
// [COM-IN-DE-REGEL] The acquirer commission that the BANK LINE already states. Pure, no I/O.
// Run: npx tsx --test src/lib/pos-commission.test.ts
//
// ── WHERE THIS CAME FROM ─────────────────────────────────────────────────────────────────────
//
// Measured on a real shop (Kiwi Food Market, Q2 2026, 91 days, ING). Its credit-card payouts
// carry the gross and the commission inside the description itself:
//
//   AFREK. BETAALAUTOMAAT MAST REFNR. F9Q3BH DAT. 202618 AANT. 12 BRUTO 21055 /COM D377
//   AFREK. BETAALAUTOMAAT VISA REFNR. F9Q3BH DAT. 202618 AANT.  2 BRUTO  4044 /COM  D69
//
// 210,55 − 3,77 = 206,78. 40,44 − 0,69 = 39,75. Both exact, and exact on all 22 such lines in
// the quarter: Σ BRUTO − Σ COM equalled Σ amount to the cent.
//
// This matters because of what the same measurement found about the OTHER 384 payout lines. The
// debit schemes (MAES, DBMC, VPAY, VIDB — 13.270 transactions, € 174.472,51) settle GROSS: on 16
// days the till's PIN total matched the bank payout to the cent, and the residual across the whole
// quarter equalled the credit-card gross almost exactly. There is no commission hidden in a debit
// payout to find. The acquirer bills those separately, monthly, and that invoice was already
// booked as a cost.
//
// So for an ING shop the entire Leg-B prize is what these lines state — and Leg B could never
// reach it, because reconcileTriangle needs an EFT terminal settlement as the gross witness and
// `eft_settlements` is EMPTY across the whole production database. The commission was printed on
// the statement, in plain text, exact to the cent, and nothing read it.
//
// ── WHY IT REFUSES RATHER THAN PARSES ────────────────────────────────────────────────────────
//
// A number scraped out of free text is a guess until something proves it. This one can prove
// itself: the line carries gross, commission AND the amount actually received, so the identity
//
//     BRUTO − COM === the line's own amount
//
// must hold. When it does, the commission is not an interpretation — it is arithmetic the bank
// itself supplied. When it does not, this module returns null and the caller counts it as
// unverified. Never a partial read, never a "best effort" euro on a money path.
//
// That guard also settles the sign question without inventing an answer. `D` is the only prefix
// observed on `/COM`; a `C` (or anything else) that does not satisfy the identity as a deduction
// is refused rather than assumed to mean the opposite.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
//
// Not a replacement for the triangle. reconcileTriangle compares three independent witnesses and
// finds discrepancies this cannot see (a missing bon, a terminal fault, a payout keyed to the
// wrong day). This reads ONE number off ONE line. It is narrower and, for that number, stronger.

/** Cents, as the bank writes them: whole numbers, never a float. */
export interface PosCommissionLine {
  /** Gross card takings for the batch, in cents. */
  grossCents: number;
  /** The acquirer's commission deducted from it, in cents. Always positive. */
  commissionCents: number;
}

/** One bank line as this module reads it. */
export interface PosCommissionInput {
  description: string | null;
  /** The amount actually credited, in euros, signed as stored. */
  amount: number | null;
}

const BRUTO_RE = /BRUTO\s+(\d{1,12})(?!\d)/;
// The optional letter is the bank's own sign marker ('D' in every line observed). It is captured
// only so the identity below can refuse anything whose meaning is not the one we verified.
const COM_RE = /\/COM\s+([A-Z]?)\s*(\d{1,12})(?!\d)/;

/** Euros to whole cents, without the float error that makes 210.55 * 100 = 21054.999…. */
function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * The gross and commission this line states — or null when it states none, or states a set that
 * does not add up to the amount actually received.
 *
 * Refusing the second case is the whole point: a line whose own arithmetic fails is a line we do
 * not understand, and a commission booked from a misread description is a cost that never existed.
 */
export function parsePosCommission(input: PosCommissionInput): PosCommissionLine | null {
  const { description, amount } = input;
  if (!description || amount == null || !Number.isFinite(amount)) return null;

  const g = BRUTO_RE.exec(description);
  const c = COM_RE.exec(description);
  if (!g || !c) return null;

  const grossCents = Number(g[1]);
  const commissionCents = Number(c[2]);
  if (!Number.isSafeInteger(grossCents) || !Number.isSafeInteger(commissionCents)) return null;
  // A zero commission is a real statement ("we took nothing"), but a zero GROSS with a commission
  // is not a batch — it is a line this module has no reading for.
  if (grossCents <= 0 || commissionCents < 0) return null;

  // The identity. Everything above is a candidate; only this makes it a fact.
  if (grossCents - commissionCents !== toCents(amount)) return null;

  return { grossCents, commissionCents };
}

export interface StatedCommission {
  /** Σ commission over the lines that verified, in euros. */
  total: number;
  /** Σ gross over those same lines, in euros — the base the rate is measured against. */
  gross: number;
  /** How many lines stated a commission AND proved it. */
  lines: number;
  /**
   * Lines that stated BRUTO and /COM but did NOT satisfy the identity. Never folded into the
   * total, always reported: a format this module misreads must be visible, not silently zero.
   */
  unverified: number;
}

/**
 * Sum the commission the bank stated across a window's card payouts.
 *
 * Cents throughout, converted once at the end — summing euros would reintroduce exactly the
 * rounding drift the [CENT] rule exists to prevent.
 */
export function statedCommission(lines: readonly PosCommissionInput[]): StatedCommission {
  let totalCents = 0;
  let grossCents = 0;
  let ok = 0;
  let unverified = 0;
  for (const line of lines) {
    const parsed = parsePosCommission(line);
    if (parsed) {
      totalCents += parsed.commissionCents;
      grossCents += parsed.grossCents;
      ok++;
    } else if (line.description && BRUTO_RE.test(line.description) && COM_RE.test(line.description)) {
      // It looks like one of ours and did not add up. That is the interesting failure.
      unverified++;
    }
  }
  return { total: totalCents / 100, gross: grossCents / 100, lines: ok, unverified };
}
