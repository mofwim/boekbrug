// src/lib/found-money.ts
// [GEVONDEN] What the reconciliation found that nobody would otherwise have seen — in euros.
// Pure, no I/O. Run: npx tsx --test src/lib/found-money.test.ts
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// The app computes exactly one figure that IS money rather than a total of money the owner
// already knew about: the acquirer commission that card-reconcile.ts recovers on Leg B. Its own
// header records what happened before it existed — the old reconcileDay compared gross till
// takings straight to the net bank payout and swallowed the difference in a tolerance, "waarmee
// de acquirer-commissie stilzwijgend verdween (winst overschat)".
//
// That figure is computed on every result window and then thrown away. There is no table for it
// (55 in this schema, none stores a reconciliation OUTPUT — eft_settlements, daily_turnover and
// ledger_daily all hold raw INPUTS), and `totalCommission` reaches exactly one place: a stat tile
// on /dashboard/waarheid, alive for as long as that screen is open.
//
// For an owner who has the time to open that screen, it is a number. For one who does not — and
// the owner of this product says plainly that he does not, and that most shopkeepers do not —
// it is work the app did that nobody will ever learn about.
//
// ── WHAT THIS IS CAREFUL NOT TO CLAIM ────────────────────────────────────────────────────────
//
// **It is not money in the owner's pocket. It is a COST that was invisible.** Booking it makes
// the profit go DOWN, and that is the point: the profit was overstated by exactly this much.
// MARKTPOSITIE_2026.md §5 says the same thing about how to sell it — _"lead with 'your profit is
// overstated', not with 'you are leaving btw on the table'"_ — and a module that told the owner
// "we found you € 340" would be inventing the one framing that study warns against.
//
// **It does not compute a tax saving.** A lower profit means less income tax, but by how much
// depends on the owner's bracket, ondernemersaftrek and MKB-vrijstelling. This app does not
// invent a number it cannot guarantee — the same rule that keeps a rente percentage out of the
// WIK letter (incasso.ts).
//
// **It refuses when the check could not run.** Leg B exists only where there is a terminal
// settlement to compare against, and only where the acquirer settles NET. No EFT settlement means
// no finding — which is not the same as a finding of zero, and must never render as one.

import type { RangeResult } from "./result-range-assemble";
import { round2 } from "./invoice-totals";

/**
 * Why there is no figure — codes, never sentences. The wording lives with the screen.
 *
 * These are not error states. Three of the four are the ordinary condition of a business that
 * takes no card payments at all, which is most of the owners this app serves.
 */
export type FoundAbsence =
  | "no_card_takings" // no EFT settlement AND no stating bank line: there was nothing to look at
  | "nothing_found" // the legs ran and agreed — the honest answer is "nothing was hidden"
  | "not_booked_under_kas"; // measured, but a cash-basis window books it via the acquirer's own invoice

/** How much confidence the figure deserves — stated, never folded into the amount. */
export interface FoundCaveats {
  /** [LEDGER-READ] The PIN-ledger cross-check did not run, so Leg A is weaker than it looks. */
  pinLedgerMissing: boolean;
  /** Days whose payout is suspect and therefore booked NO commission — the figure is too LOW. */
  suspectDays: number;
  /** Days where a witness was missing entirely. Same direction: too low, never too high. */
  incompleteDays: number;
  /** Leg A breaks — the till and the terminal disagree. Not about commission, but not silent. */
  grossMismatchDays: number;
}

/**
 * [COM-IN-DE-REGEL] The commission the bank line stated outright, and whether it is in the books.
 *
 * This is a finding of a different KIND from Leg B and is kept separate for that reason. Leg B
 * DERIVES a commission by comparing three witnesses; this one is quoted by the bank and proves
 * itself against the amount received. It is currently reported and not booked — see the note on
 * `reconciliation.statedCommission` — so `inTheBooks` is what stops a screen from implying it is.
 */
export interface StatedFinding {
  /** The commission the statement names, in euros. */
  total: number;
  /** The gross it was taken from, so a rate can be shown rather than asserted. */
  gross: number;
  /** How many payout lines proved their own arithmetic. */
  lines: number;
  /** Lines that looked like ours and did not add up — never in the total, never hidden. */
  unverified: number;
  /**
   * Is this amount actually in the books, or only on the statement?
   *
   * TRUE when the engine folded it into kosten (the window held no EFT settlement, so Leg B had
   * nothing it could double-count against). FALSE when it is evidence the owner can act on but the
   * figures do not yet contain — the honest sentence then being "this is on your statement and not
   * in your books", which is more use than a silently larger kosten total.
   */
  inTheBooks: boolean;
}

export interface FoundMoney {
  /**
   * The cost that was invisible and is now booked, in euros. Null when there is none to state.
   *
   * Never 0 — an absence is an absence. A "€ 0,00 gevonden" is indistinguishable on a screen from
   * "we looked and your books are clean", and those are different facts.
   */
  amount: number | null;
  absence: FoundAbsence | null;
  /** What was measured, even when none of it was booked (the kas case). */
  measured: number;
  /** How many terminal settlements the finding rests on. */
  settlements: number;
  caveats: FoundCaveats;
  /**
   * [COM-IN-DE-REGEL] What the bank statement said out loud, or null when it said nothing.
   *
   * Measured on a real ING shop: 22 payout lines in a quarter, € 54,02 on € 2.922,21 gross, every
   * line proving BRUTO − COM against the amount received. The other 384 payouts that quarter were
   * debit and settled GROSS, so they state nothing and hide nothing.
   */
  stated: StatedFinding | null;
  /**
   * TRUE when every caveat is clear: the ledger was read, no day was suspect, incomplete or
   * mismatched. Only then is `amount` the whole story rather than a floor.
   */
  complete: boolean;
}

/**
 * What this window's reconciliation found.
 *
 * Takes the RangeResult the truth engine already produces — no second computation, so this can
 * never disagree with the screen it appears on.
 */
export function foundMoney(range: RangeResult): FoundMoney {
  const r = range.reconciliation;
  const caveats: FoundCaveats = {
    pinLedgerMissing: !r.pinLedgerAvailable,
    suspectDays: r.commissionIssueDays,
    incompleteDays: r.incompleteDays,
    grossMismatchDays: r.grossMismatchDays,
  };
  const complete =
    !caveats.pinLedgerMissing &&
    caveats.suspectDays === 0 &&
    caveats.incompleteDays === 0 &&
    caveats.grossMismatchDays === 0;
  const measured = round2(r.totalCommission);
  const sc = r.statedCommission;
  // Null rather than an all-zero object: "the statement named nothing" and "the statement named
  // € 0,00" are the same on screen only if we let them be.
  const stated: StatedFinding | null =
    sc && (sc.lines > 0 || sc.unverified > 0)
      ? {
          total: round2(sc.total), gross: round2(sc.gross), lines: sc.lines,
          unverified: sc.unverified, inTheBooks: r.statedCommissionBooked === true,
        }
      : null;
  const base = { measured, settlements: r.eftSettlements, caveats, complete, stated };

  // No terminal settlement means Leg B never ran. That is not a finding of zero: the gross side of
  // the comparison is simply absent, and a shop on a GROSS settlement contract has no Leg B to
  // find either (MARKTPOSITIE §5 — the market is card-heavy shops ON NET settlement).
  //
  // But "Leg B could not run" is no longer the same as "there is nothing to report". A bank line
  // that states its own commission is a finding without any terminal settlement at all, which is
  // the ordinary case for an ING shop — and was this module's blind spot: it answered
  // "no_card_takings" for a shop with € 54,02 of commission printed on its own statement.
  if (r.eftSettlements === 0) {
    return stated && stated.total > 0
      ? { amount: null, absence: null, ...base }
      : { amount: null, absence: "no_card_takings", ...base };
  }

  // [KASSTELSEL] Measured, deliberately not booked — the cost is deductible when the acquirer's
  // own invoice is paid. Reporting it as booked would claim a cost the result does not contain.
  if (range.scheme === "kas" && measured > 0) {
    return { amount: null, absence: "not_booked_under_kas", ...base };
  }

  const booked = round2(r.commissionBooked);
  if (booked <= 0) return { amount: null, absence: "nothing_found", ...base };

  return { amount: booked, absence: null, ...base };
}
