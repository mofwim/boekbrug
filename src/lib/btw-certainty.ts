// src/lib/btw-certainty.ts
// [BTW-CERTAINTY] How much weight the BTW figure may be given ON SCREEN.
//
// Pure, no I/O. Run: npx tsx src/lib/btw-certainty.test.ts
//
// WHY THIS EXISTS. computeResult never guesses a BTW rate: revenue booked without one counts in
// omzet and is reported separately as `cashOmzetZonderBtw`, and its BTW is simply absent from
// btwSaldo. That is the right arithmetic — inventing a rate would be worse. But the SCREEN then
// rendered btwSaldo as a large, confident amount with the caveat several blocks below it in grey
// body text, and on a real account that produced this:
//
//     BTW terug te ontvangen        € 2.779,58
//     Verschuldigd € 0,00    Voorbelasting € 2.779,58
//     ...
//     ⚠️ € 44.255,02 omzet staat nog zonder BTW-tarief
//
// Every number there is correct. The impression is the opposite of the truth: the owner owes BTW
// on €44k of revenue and is being told they get €2.779 back. Someone plans their cash around that.
//
// So the figure needs a companion that says how much it can be trusted, computed from the same
// numbers rather than left to each screen to re-derive.
//
// THE BOUND, and why it is a bound and not a guess. We cannot know the missing rate — some unrated
// revenue is legitimately 0% (export, BTW verlegd). But the Dutch rates are a closed set {0, 9, 21}
// (btw-rate.ts), so IF any of it turns out to be taxed at all, the smallest it can add is 9%. The
// unrated amounts are gross (financial-result.ts books the full cash/bank/till amount into omzet
// when no rate is known), so the least BTW hiding in them is amount × 9/109. Comparing that lower
// bound against the current saldo answers one question honestly: could assigning rates flip a
// refund into a payment? "Could" is the strongest claim available, and it is the one that matters.

import { round2 } from './invoice-totals'

/** The lowest non-zero Dutch VAT rate. The missing BTW cannot be smaller than this, if it is taxed. */
const LOWEST_TAXED_RATE = 9;

/** Below this the gap is rounding noise, not an omission worth qualifying a headline over. */
const EPS = 0.005;

export type BtwCertainty =
  /** Every euro of revenue carries a rate — the figure is what it says it is. */
  | "exact"
  /** Some revenue has no rate yet, so the figure is too low — but the direction still holds. */
  | "incomplete"
  /** The figure currently says "you get money back", and assigning rates could turn it into a
   *  payment. The amount must not be presented as a confident refund. */
  | "sign-could-flip";

export interface BtwCertaintyResult {
  level: BtwCertainty;
  /** Revenue booked with no BTW rate. Gross. */
  unrated: number;
  /** That revenue as a fraction of total omzet (0–1). 0 when there is no omzet. */
  unratedShare: number;
  /** The SMALLEST extra BTW the unrated revenue could carry, if it is taxed at all (9% of gross). */
  minMissingBtw: number;
}

export function assessBtwCertainty(input: {
  btwSaldo: number;
  omzet: number;
  cashOmzetZonderBtw: number;
}): BtwCertaintyResult {
  const unrated = Math.max(0, Number(input.cashOmzetZonderBtw) || 0);
  const omzet = Number(input.omzet) || 0;
  const btwSaldo = Number(input.btwSaldo) || 0;

  // The gross amount carries at most `rate/(100+rate)` of itself as BTW.
  const minMissingBtw = round2((unrated * LOWEST_TAXED_RATE) / (100 + LOWEST_TAXED_RATE));
  const unratedShare = omzet > 0 ? Math.min(1, unrated / omzet) : 0;

  if (unrated <= EPS) return { level: "exact", unrated: 0, unratedShare: 0, minMissingBtw: 0 };

  // A NEGATIVE saldo is a refund. If even the smallest possible missing BTW covers it, the refund
  // is not a refund yet — and that is the one case where showing the amount plainly misleads.
  const level: BtwCertainty =
    btwSaldo < 0 && minMissingBtw >= Math.abs(btwSaldo) ? "sign-could-flip" : "incomplete";

  return { level, unrated, unratedShare, minMissingBtw };
}
