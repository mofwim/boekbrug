// src/lib/day-card-takings.ts
// [DAG-UIT-DE-BANK] What the bank already says a trading day's card takings were.
// Pure, no I/O. Run: npx tsx --test src/lib/day-card-takings.test.ts
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────
//
// HandmatigeDag.tsx asks the owner to type `pin_amount` for a day with no Z-report. Measured on
// the live database: one shop has 142 such days carrying € 253.210,30 of card takings that its
// own bank statement already describes, line by line, with the takings date in each description.
//
// ── WHY THE BANK LINE IS THE TAKINGS, AND WHERE IT IS NOT ────────────────────────────────────
//
// This only works because of what the acquirer contract turned out to be, verified on 91 real
// days: the Dutch debit schemes (Maestro, V-Pay, Debit Mastercard, Visa Debit — 98,4% of that
// shop's card volume) settle GROSS. On 16 days the till's PIN total matched the bank payout to
// the cent. Nothing is deducted from those payouts, so the credited amount IS the takings.
//
// The credit schemes do not: they settle net of commission, and state their own gross in the
// description ("BRUTO 21055 /COM D377"). So a credit line's takings is its BRUTO, not its amount.
//
// Hence the rule below: use the stated gross where there is one, the credited amount where there
// is not. That is exactly what reproduced the till on the days that could be checked.
//
// ── WHAT THIS IS, AND IS NOT, ALLOWED TO CLAIM ───────────────────────────────────────────────
//
// It is NOT a Z-report and must never be presented as one. Two things it cannot know:
//
//   · CASH. The bank sees none of it. A day prefilled from here is missing every cash sale, which
//     is why this fills ONE field and never the day.
//   · THE BTW RATE SPLIT. The whole reason HandmatigeDag exists (its own header: an owner with no
//     kassa "had no way to record a rate split ANYWHERE", and /api/btw/file blocks a filing on
//     exactly that). A bank line carries no rate and this invents none.
//
// And one it cannot verify: an acquirer that settles DEBIT net would make the credited amount a
// payout rather than takings, and this would then be too low. `allGrossKnown` reports whether
// every line in the day proved its own gross, so a surface can present a certainty it has rather
// than a certainty it assumed. Everything here is a SUGGESTION the owner confirms — never a
// written figure.

import { parsePosSettlement } from "./turnover";
import { parsePosCommission } from "./pos-commission";
import { round2 } from "./invoice-totals";

/** One card payout, as the bank stored it. */
export interface CardPayoutLine {
  date: string | null;
  amount: number | null;
  description: string | null;
}

export interface DayCardTakings {
  /** Σ takings for the day: the stated gross where there is one, the credited amount otherwise. */
  total: number;
  /** How many payout lines the figure rests on. */
  lines: number;
  /** Of those, how many stated their own gross (so their contribution is takings beyond doubt). */
  grossStated: number;
  /**
   * TRUE when every line stated its gross. Then `total` is the takings without relying on the
   * shop being on a gross-settlement contract for its debit schemes.
   */
  allGrossKnown: boolean;
  /**
   * FALSE when the period also holds card payouts that name a WEEK instead of a day — the credit
   * schemes — so this day's takings are knowingly INCOMPLETE by an unknown share of them.
   *
   * The figure is then a floor, and a surface must say so rather than offer it as the day.
   */
  complete: boolean;
  /** Σ takings the bank could not place on any day. 0 when there are none. */
  unplaced: number;
}

/**
 * Which trading day a payout belongs to — ONLY when the bank printed a real date for it.
 *
 * NO booking-date fallback, and that is the whole correctness of this module. The credit-card
 * lines carry a WEEK number ("DAT. 202618"), which parsePosSettlement rightly refuses to read as a
 * date. Falling back to the booking day pins a week of credit takings onto whichever single day
 * the payout happened to post. Checked against seven real days of till data, that fallback
 * overstated 4 May by € 250,99 (€ 1.941,30 against a till of € 1.690,31) while leaving the four
 * surrounding days short by € 44 to € 122 — money moved off the days that earned it and piled onto
 * one that did not.
 *
 * With the fallback gone, every day this module answers for is built only from payouts the bank
 * itself dated. On the same seven days that turns 4 May exact to the cent, and leaves the days
 * with credit-card activity UNDER their till total by exactly the credit portion — never over it.
 * Understating is the survivable direction for a figure an owner is about to accept, and
 * `complete` below says out loud when it is happening.
 */
function takingsDayOf(line: CardPayoutLine): string | null {
  return parsePosSettlement(line.description).date;
}

/**
 * What the bank says this day's card takings were, or null when it says nothing about that day.
 *
 * Null rather than zero: "the bank shows no card payout for this day" and "the shop took € 0,00
 * on card" are different facts, and only the owner knows the second one.
 */
export function cardTakingsForDay(
  lines: readonly CardPayoutLine[],
  isoDay: string,
): DayCardTakings | null {
  let cents = 0;
  let count = 0;
  let grossStated = 0;
  let unplacedCents = 0;
  for (const line of lines) {
    const takingsOf = (l: CardPayoutLine) => {
      const stated = parsePosCommission(l);
      // A line that proved BRUTO − COM against what was credited states its own takings.
      return stated ? { cents: stated.grossCents, gross: true } : { cents: Math.round((l.amount ?? 0) * 100), gross: false };
    };
    const day = takingsDayOf(line);
    if (day === null) {
      // The bank named a week, not a day. It belongs to SOME day in that week and this module
      // will not guess which — but its existence is what makes the day figure a floor.
      unplacedCents += takingsOf(line).cents;
      continue;
    }
    if (day !== isoDay) continue;
    count++;
    const t = takingsOf(line);
    cents += t.cents;
    if (t.gross) grossStated++;
  }
  if (count === 0) return null;
  return {
    total: round2(cents / 100),
    lines: count,
    grossStated,
    allGrossKnown: grossStated === count,
    complete: unplacedCents === 0,
    unplaced: round2(unplacedCents / 100),
  };
}
