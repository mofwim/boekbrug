// src/lib/untaxed-amount.ts
// [NUL-POST] The part of an invoice that carries no BTW. Pure, no I/O.
// Run: npx tsx --test src/lib/untaxed-amount.test.ts
//
// ── WHAT THIS IS AND WHY EVERY DUTCH PACKAGE HAS IT ──
//
// Statiegeld, emballage, europallets and kratten carry no BTW. jortt, Silvasoft, SnelStart and
// Acumulus all book such a post as a SEPARATE 0% LINE beside the taxed goods line — that is the
// Dutch convention, not a preference. BoekBrug had no field for it, so the amount disappeared into
// total_ex_btw and took the derived rate with it.
//
// Measured on production, and the shape is unmistakable: 52 of 479 booked purchase invoices
// (EUR 40.761) compute a rate that is not 0, 9 or 21 while excl + btw equals the total EXACTLY.
//
//   Aardappelgroothandel Altena   6,50 %      Elegance Brands   8,38 %
//   Vars Foods                    8,45 %
//
// All three sit BELOW the lowest real rate, which is what an untaxed amount inside the base does:
// the BTW is right, the base is too big, so the quotient sags. (A rate BETWEEN two legal rates is a
// different animal — Enka Horeca lands at 10,63 % because it puts 9 % and 21 % lines on one invoice.
// That is what _btw_rows already models, and this file leaves it alone.)
//
// ── IT SITS INSIDE total_ex_btw, NOT BESIDE IT ──
//
// The single most important decision here, and it follows the Dutch convention rather than
// convenience: a 0%-line is part of the amount excluding BTW. So
//
//     total_ex_btw + btw_amount = total_inc_btw
//
// keeps holding exactly as before, everywhere in this app — every sum, every export, every filing.
// Only the RATE changes, and only because it was being computed over the wrong base:
//
//     rate = btw_amount / (total_ex_btw - untaxed_amount)
//
// Had the field been stored beside the base instead, every existing total in the product would
// have silently stopped adding up on the day it shipped.
//
// ── AND IT IS THE OWNER'S NUMBER, NEVER THE APP'S ──
//
// Nothing here reads a document. The amount is typed by the person holding the invoice, next to the
// other correction fields, because the app cannot tell EUR 12,60 of statiegeld from EUR 12,60 of
// anything else without reading the line — and a wrong guess here moves the voorbelasting. What the
// app may do is NOTICE: when the implied rate sits below the lowest legal rate, it can say so and
// offer the amount that would explain it. Proposing is not booking.

import { round2 } from "./invoice-totals";

/** The Dutch rates a purchase line can legally carry. 0 belongs here — it is a rate, not an absence. */
const LEGAL_RATES = [0, 9, 21] as const;

/**
 * The base the BTW was actually charged over.
 *
 * Clamped at zero: an untaxed amount larger than the base is a typo, and a negative base would
 * produce a nonsense rate that reads as authoritative.
 */
export function taxableBase(totalExBtw: number | null | undefined, untaxed: number | null | undefined): number {
  const ex = typeof totalExBtw === "number" && Number.isFinite(totalExBtw) ? totalExBtw : 0;
  const nul = typeof untaxed === "number" && Number.isFinite(untaxed) ? untaxed : 0;
  // Signs follow the invoice: a creditnota is negative throughout, so the base shrinks toward zero
  // from below. Math.max would flip it, so the clamp is on the ABSOLUTE size of the untaxed part.
  if (ex < 0) return Math.min(0, ex - Math.min(0, -Math.abs(nul)));
  return Math.max(0, ex - Math.abs(nul));
}

/**
 * The BTW rate this invoice actually charges, computed over the taxable base.
 *
 * Null when there is no base to divide by — never 0, which is a real rate and would read as
 * "this invoice is zero-rated" about an invoice the app simply could not judge.
 */
export function impliedRate(
  totalExBtw: number | null | undefined,
  btwAmount: number | null | undefined,
  untaxed: number | null | undefined,
): number | null {
  const base = taxableBase(totalExBtw, untaxed);
  const btw = typeof btwAmount === "number" && Number.isFinite(btwAmount) ? btwAmount : 0;
  if (Math.abs(base) < 0.005) return null;
  return (btw / base) * 100;
}

/**
 * How much untaxed amount WOULD explain this invoice at a legal rate?
 *
 * Only ever offered when the implied rate sits BELOW the lowest rate the BTW could plausibly carry
 * — the signature of an untaxed post hiding in the base. A rate between two legal rates is a mixed
 * invoice and gets nothing from here; suggesting statiegeld there would be a wrong answer in a
 * confident voice.
 *
 * Returns the amount and the rate it assumes, so the screen can say both. Null when nothing
 * plausible explains it, which is the honest answer far more often than not.
 */
export function untaxedThatWouldExplain(
  totalExBtw: number | null | undefined,
  btwAmount: number | null | undefined,
): { untaxed: number; rate: number } | null {
  const ex = typeof totalExBtw === "number" && Number.isFinite(totalExBtw) ? totalExBtw : 0;
  const btw = typeof btwAmount === "number" && Number.isFinite(btwAmount) ? btwAmount : 0;
  if (!(ex > 0) || !(btw > 0)) return null;

  const rate = (btw / ex) * 100;
  // Already a legal rate → nothing to explain. The tolerance matches the cent-rounding that moves
  // a real 9% invoice to 8,99 or 9,01.
  if (LEGAL_RATES.some((r) => Math.abs(rate - r) <= 0.2)) return null;

  // Which legal rate could this BTW belong to? Only one that is HIGHER than what the full base
  // implies: a smaller base gives a bigger quotient, so only a higher target is reachable by
  // removing an untaxed part. A rate between 9 and 21 is a mixed invoice, not this.
  const doel = LEGAL_RATES.filter((r) => r > 0).find((r) => rate < r - 0.2);
  if (doel === undefined) return null;
  // But it must be the LOWEST rate above it, and the gap must not be a mixed-rate blend: between
  // 9 and 21 both a blend and a 0%-post are possible, and this file does not guess between them.
  if (rate > LEGAL_RATES[1] + 0.2) return null;

  const base = btw / (doel / 100);
  const untaxed = round2(ex - base);
  // A hypothesis that removes almost nothing, or more than the whole invoice, explains nothing.
  if (untaxed < 0.01 || untaxed >= ex) return null;
  return { untaxed, rate: doel };
}
