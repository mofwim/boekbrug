// src/lib/btw-reservation.ts
// [BTW-RESERVERING] How much of the balance in the account is already the Belastingdienst's.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
//
// A zzp'er invoices € 1.210 and € 1.210 lands in their account. € 210 of it was never theirs;
// it is BTW they collected on the state's behalf and will hand over at the end of the quarter.
// The bank does not know that. The banking app shows € 1.210 and so does every screen in this
// one — and three months later the aangifte asks for money that has already been spent on stock,
// rent and a laptop.
//
// That is not an edge case. It is the single most common way a healthy Dutch one-person business
// gets into trouble, and it is entirely predictable: this app already knows the exact amount, a
// quarter in advance, on the day the invoice is sent. It just never said it out loud.
//
// Every bookkeeping product aimed at this user surfaces it under some name. What follows is that
// figure, computed from what this app already reconciles — no new bookkeeping, no new table.
//
// ── WHAT MAKES THIS ONE HONEST ───────────────────────────────────────────────────────────
//
// The number is only worth having if the owner can lean on it, so every rule below leans the
// SAFE way and says so out loud when it does:
//
//   · An expected refund is never money you can spend. A quarter that ends in a teruggaaf is
//     reported separately and NEVER added to what is free — the Belastingdienst has not paid it,
//     and may settle it against something else entirely.
//   · A refund in one quarter does not net off what is owed in another, for the same reason.
//   · When the balance cannot be read, there is no "free" figure at all. Not zero — absent.
//     A € 0,00 where a real balance belongs is the reassuring lie this codebase refuses elsewhere
//     ([NO-SILENT-EMPTY]), and it would be worst here, on the number meant to prevent a shortfall.
//   · Purchase invoices still sitting in the verify queue carry voorbelasting that is NOT yet
//     deducted, so the reserved amount is knowingly too HIGH. Too high is the survivable
//     direction; it is still stated, because a figure nobody can reproduce is not trusted twice.
//
// Pure and deterministic — no I/O, no clock of its own. Run: npx tsx --test src/lib/btw-reservation.test.ts

import { dayNumberFromIso } from "./invoice-reminders";
import { round2 } from "./invoice-totals";

export type QuarterNo = 1 | 2 | 3 | 4;

/**
 * What the answer does NOT know, as codes rather than sentences.
 *
 * [TAAL] The wording lives with the screen (btw-reservation-copy.ts), never here: this module is
 * imported by a route and by a component, and a Dutch sentence baked in at this depth is a
 * sentence no translation can reach. Codes travel; prose does not.
 */
export type ReservationNote =
  /** No usable bank balance → there is no "free to spend" figure at all, only what is owed. */
  | "balance-unknown"
  /** At least one account declared no balance, so the total is too LOW and `free` with it. */
  | "balance-incomplete"
  /** The newest statement is old enough that the balance describes a past day, not today. */
  | "balance-stale"
  /** The current quarter has not ended, so its figure still moves in both directions. */
  | "quarter-running"
  /** Purchase invoices are still unverified → their voorbelasting is missing → reserved too much. */
  | "purchases-unverified"
  /** A quarter ends in a refund; it is reported apart and never counted as available. */
  | "refund-separate"
  /** A quarter's deadline has passed and it was never filed. That is a late aangifte, not a sum. */
  | "return-overdue";

export type ReservationState =
  /** The balance is unknown; what is owed may still be known. */
  | "unknown"
  /** The balance covers everything reserved. */
  | "covered"
  /** It does not. This is the sentence the whole module exists to be able to say. */
  | "short";

/** One quarter's BTW position, as the caller has established it. */
export interface QuarterPosition {
  /** "2026-Q1" — the same key shape quarter.ts uses, so links between surfaces line up. */
  key: string;
  year: number;
  quarter: QuarterNo;
  /**
   * Rubriek 5g in whole euros: POSITIVE is te betalen, NEGATIVE is te ontvangen.
   *
   * The sign convention is the aangifte's own (5g = 5a − 5b), deliberately not re-stated here as
   * a magnitude. A magnitude would make a refund indistinguishable from a debt at exactly the
   * moment the difference is the whole point.
   */
  balance: number;
  /** Filed with the Belastingdienst (a btw_filings row exists). */
  filed: boolean;
  /** Purchase invoices dated in this quarter still in the verify queue — their BTW is not deducted. */
  unverifiedPurchases?: number;
}

export interface BtwReservationInput {
  /** The bank total, or null when it could not be established. Never 0 for "unknown". */
  balance: number | null;
  /** The day that balance is true for (bankBalanceOf's `asOf`), or null. */
  balanceAsOf: string | null;
  /** True when an account was left out of the total — see BankBalance.partial. */
  balanceIncomplete: boolean;
  quarters: readonly QuarterPosition[];
  /** Today, on the Amsterdam day (amsterdamToday) — passed in so this stays pure. */
  today: string;
}

/** One quarter as it comes out: the input plus the deadline arithmetic. */
export interface DatedQuarter extends QuarterPosition {
  /** ISO date the aangifte AND the payment must be in by. */
  deadline: string;
  /** Days from `today` to that deadline. Negative once it has passed. */
  days: number;
  /** `today` falls inside this quarter — the figure is a running total. */
  running: boolean;
}

export interface BtwReservation {
  state: ReservationState;
  /** What is still owed, as a positive amount. Refunds are not in here — see `refundExpected`. */
  reserved: number;
  /** balance − reserved. Null when the balance is unknown; NEVER 0 as a stand-in. */
  free: number | null;
  /** Expected refunds, positive. Reported, never added to `free`. */
  refundExpected: number;
  /** The nearest deadline that still has money against it — what the screen counts down to. */
  nextDue: DatedQuarter | null;
  /** The quarters that actually count toward `reserved`, nearest deadline first. */
  quarters: DatedQuarter[];
  notes: ReservationNote[];
}

/**
 * A balance older than this describes a past day rather than today, and is said so.
 *
 * Two weeks, because that is roughly the rhythm at which someone who imports statements by hand
 * actually imports them. Shorter and the note fires for everyone always, which trains the owner
 * to ignore it; longer and a genuinely stale figure passes as current.
 */
export const STALE_BALANCE_DAYS = 14;

/**
 * The day a quarter's aangifte and payment must be in by: the last day of the MONTH FOLLOWING
 * the quarter.
 *
 *   Q1 (jan–mrt) → 30 april      Q3 (jul–sep) → 31 oktober
 *   Q2 (apr–jun) → 31 juli       Q4 (okt–dec) → 31 januari of the NEXT year
 *
 * Q4 rolling into the next calendar year is the one that gets written wrong, and it gets written
 * wrong in the direction that matters: a Q4 deadline stated as 31 January of the SAME year is a
 * date eleven months in the past, which would make the app announce a late aangifte to everyone
 * with an ordinary, perfectly timely Q4.
 */
export function btwDeadline(year: number, quarter: QuarterNo): string {
  switch (quarter) {
    case 1: return `${year}-04-30`;
    case 2: return `${year}-07-31`;
    case 3: return `${year}-10-31`;
    case 4: return `${year + 1}-01-31`;
  }
}

/** The year/quarter an ISO date falls in. */
export function quarterOfDate(iso: string): { year: number; quarter: QuarterNo } {
  return {
    year: Number(iso.slice(0, 4)),
    quarter: (Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1) as QuarterNo,
  };
}

/**
 * `n` quarters before this one, crossing years.
 *
 * Counted on a flat quarter index rather than by decrementing and patching the year, because the
 * patching version is where the January bug lives: three quarters before 2026-Q2 is 2025-Q3, and
 * an off-by-one there does not throw — it silently reports a different quarter's tax debt.
 */
export function quartersBefore(year: number, quarter: QuarterNo, n: number): { year: number; quarter: QuarterNo } {
  const index = year * 4 + (quarter - 1) - n;
  return { year: Math.floor(index / 4), quarter: ((index % 4) + 1) as QuarterNo };
}

/** The first and last day of a quarter, ISO. Local to this module's `running` test. */
function quarterSpan(year: number, quarter: QuarterNo): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth - 1];
  // February: the only month whose length is not a constant. A leap-year Q1 that ended on the
  // 28th would put 29 February outside every quarter, and a payment dated there in nobody's books.
  const end = endMonth === 2 && isLeapYear(year) ? 29 : lastDay;
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${year}-${String(endMonth).padStart(2, "0")}-${String(end).padStart(2, "0")}`,
  };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Whole days from `from` to `to`; negative when `to` is already past. */
function daysBetween(from: string, to: string): number {
  const a = dayNumberFromIso(from);
  const b = dayNumberFromIso(to);
  if (a == null || b == null) return 0;
  return b - a;
}

/**
 * Does this quarter's BTW still have to leave the account?
 *
 * This is the load-bearing judgement of the whole module, and it is the one place where being
 * wrong in the comfortable direction would make the feature actively harmful. Four cases:
 *
 *   1. The quarter is still RUNNING. Nobody has paid a quarter that has not ended. → reserve.
 *   2. It has ended and the deadline is still ahead. The owner may already have paid it early,
 *      in which case this reserves money that has gone — over-reserving, the survivable side,
 *      and only for the weeks between filing and the deadline. → reserve.
 *   3. The deadline has passed AND it was filed. Assume it was settled. This is the only
 *      assumption in the module, and it is necessary: without it the reserved amount would grow
 *      by a quarter every quarter, forever, for an owner who has done everything right — a number
 *      that is not merely useless but wrong, and wrong in a way that would train them to dismiss
 *      it. The app cannot see money leaving for the Belastingdienst (a tax debit is a bank line
 *      like any other and is not tied to a period), so "filed and past due" is the closest thing
 *      to evidence that exists here.
 *   4. The deadline has passed and it was NEVER filed. Then the money is unambiguously still
 *      owed — there is not even a declaration yet — and this is exactly the owner who most needs
 *      to be told. → reserve, and raise "return-overdue".
 *
 * Case 4 is why case 3 cannot simply be "past due → drop it". That shortcut would go quiet on
 * precisely the person in trouble.
 */
export function stillOwed(post: DatedQuarter): boolean {
  if (post.running) return true;
  if (post.days >= 0) return true;
  return !post.filed;
}

/** Attach the deadline arithmetic to a quarter. */
export function withDeadline(post: QuarterPosition, today: string): DatedQuarter {
  const deadline = btwDeadline(post.year, post.quarter);
  const span = quarterSpan(post.year, post.quarter);
  return {
    ...post,
    deadline,
    days: daysBetween(today, deadline),
    running: today >= span.start && today <= span.end,
  };
}

/**
 * What of this balance is not yours.
 *
 * Returns a complete answer in every case, including the ones where it knows nothing: `state`
 * 'onbekend' with `free` null is a real answer and the screen must be able to render it. There is
 * no path that returns a confident number out of missing information.
 */
export function computeBtwReservation(input: BtwReservationInput): BtwReservation {
  const { balance, balanceAsOf, balanceIncomplete, today } = input;

  const alle = (input.quarters ?? []).map((p) => withDeadline(p, today));
  const meetellend = alle.filter(stillOwed);

  // Debts and refunds are summed apart and never against each other. Netting them would let a
  // Q2 refund pay for a Q1 debt on this screen while the Belastingdienst collects the one and
  // pays the other on its own schedule — the owner would be told they are covered on the strength
  // of money that has not arrived.
  const schulden = meetellend.filter((p) => p.balance > 0);
  const teruggaven = meetellend.filter((p) => p.balance < 0);

  const reserved = round2(schulden.reduce((s, p) => s + p.balance, 0));
  const refundExpected = round2(teruggaven.reduce((s, p) => s + Math.abs(p.balance), 0));

  const free = balance == null ? null : round2(balance - reserved);

  const state: ReservationState =
    balance == null ? "unknown" : free! < 0 ? "short" : "covered";

  // Nearest deadline first; a running quarter naturally sorts last, which is right — it is the
  // one furthest from being due.
  const quarters = [...schulden].sort((a, b) => a.days - b.days || a.key.localeCompare(b.key));

  const notes: ReservationNote[] = [];
  if (balance == null) notes.push("balance-unknown");
  if (balanceIncomplete) notes.push("balance-incomplete");
  if (
    balance != null &&
    balanceAsOf != null &&
    daysBetween(balanceAsOf, today) > STALE_BALANCE_DAYS
  ) {
    notes.push("balance-stale");
  }
  if (meetellend.some((p) => p.running)) notes.push("quarter-running");
  if (meetellend.some((p) => (p.unverifiedPurchases ?? 0) > 0)) notes.push("purchases-unverified");
  if (refundExpected > 0) notes.push("refund-separate");
  if (meetellend.some((p) => !p.running && p.days < 0 && !p.filed)) notes.push("return-overdue");

  return {
    state,
    reserved,
    free,
    refundExpected,
    nextDue: quarters[0] ?? null,
    quarters,
    notes,
  };
}
