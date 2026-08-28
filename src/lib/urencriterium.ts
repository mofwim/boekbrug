// src/lib/urencriterium.ts
// [URENCRITERIUM] How the year is going against the 1.225-hour criterion, while it can still be
// changed. Pure — no I/O, no clock of its own.
// Run: npx tsx --test src/lib/urencriterium.test.ts
//
// ── WHY THIS EXISTS ──
//
// The app already judged the urencriterium, in exactly one place: the YEAR overview (ib-jaar.ts),
// which an owner opens when the year is over. The sentence there is honest — "nog 385 uur onder
// het urencriterium; werkte je meer, registreer het" — and it arrives in the one month where
// nothing can be done about it. Registering hours you actually worked is legitimate and useful in
// October. On 31 December it is a post-mortem.
//
// What it costs to find out too late is not small: the zelfstandigenaftrek, and for a starter the
// startersaftrek on top of it. That is the largest single deduction a zzp'er has, and it turns on
// one number this app already holds.
//
// ── THE THREE RULES THAT DECIDE THE COPY ──
//
// 1. THERE IS NO PRO-RATA. Someone who registers their business in September still needs 1.225
//    hours in that calendar year. This is the most commonly assumed-otherwise rule in the whole
//    criterion, and assuming otherwise costs the entire deduction. Nothing here divides the
//    threshold by anything.
//
// 2. INDIRECT HOURS COUNT. Administration, acquisition, travel, quoting, training, and the
//    bookkeeping itself are hours spent on the business. This app's hour registration exists to
//    turn hours into an INVOICE, so what an owner naturally writes down is the billable half —
//    and then under-counts themselves against a criterion that asks for both halves. The screen
//    has to say this out loud; the arithmetic here cannot.
//
// 3. ONLY REGISTERED HOURS COUNT. Every number below is about the registration, never about the
//    work. That distinction is the difference between a fact and an accusation.
//
// ── WHAT IT REFUSES TO DO ──
//
// It does not project from too little year. In the first weeks a handful of days extrapolates to
// anything at all — 20 hours in the first ten days "projects" to 730 for the year — and a warning
// built on that is noise the owner learns to ignore, which is worse than silence because it also
// costs the real warning its credibility later.
//
// It also computes no deduction amount. What the zelfstandigenaftrek is worth depends on the
// owner's profit, their other income and the year's rates. A wrong euro figure about a deduction
// is exactly the kind of confident wrong number ib-jaar.ts refuses to print, for the same reason.

import { round2 } from "./invoice-totals";

/** The urencriterium for zelfstandigenaftrek — 1.225 uur, a stable statutory number. */
export const URENCRITERIUM_HOURS = 1225;

/**
 * Days of the year that must have passed before a projection is made at all.
 *
 * Mid-February. Not a tuning knob: below this the divisor is small enough that one busy week
 * swings the projection by hundreds of hours, and the screen would alternate between "on track"
 * and "you will not make it" from one day to the next.
 */
export const PROJECTION_MIN_DAYS = 45;

/**
 * The weekly pace above which "behind" becomes "seriously behind".
 *
 * A full working week. Above this, catching up is not a matter of registering more carefully —
 * it is a matter of the year having got away, and the sentence should say so plainly rather than
 * keep sounding encouraging.
 */
export const HARD_WEEK_HOURS = 40;

export type UrencriteriumLevel =
  /** The hours could not be read. Never "not met" over a failed read. */
  | "unknown"
  /** 1.225 registered. Nothing further to do, and the screen should stop asking. */
  | "met"
  /** Too little of the year has passed to say anything about where it lands. */
  | "too_early"
  | "on_track"
  | "behind"
  | "critical"
  /** Not enough days left in the year to reach it, even at 24 hours a day. */
  | "unreachable"
  /** A year that is over: the answer is a fact, not a forecast. */
  | "closed_met"
  | "closed_missed";

export interface UrencriteriumInput {
  /** Σ time_entries.hours registered in `year`, or null when the read failed. */
  hoursSoFar: number | null;
  /** Today in the OWNER's calendar (Europe/Amsterdam), as YYYY-MM-DD. */
  today: string;
  /** The calendar year being assessed. */
  year: number;
}

export interface UrencriteriumStatus {
  level: UrencriteriumLevel;
  year: number;
  /** Registered hours, or null when they could not be read. */
  hours: number | null;
  threshold: number;
  /** Still to register. 0 once the criterion is met. */
  remaining: number;
  /** Whole days after today, up to and including 31 December. */
  daysLeft: number;
  /** Hours per week needed over the days that are left; null when that no longer means anything. */
  neededPerWeek: number | null;
  /** Where the pace so far lands on 31 December; null while it is too early to say. */
  projected: number | null;
  /**
   * Whether this should interrupt rather than sit quietly in the corner.
   *
   * False for every state the owner can do nothing useful with: a criterion already met, a year
   * already closed, a read that failed, and a January in which the projection would be invented.
   */
  warn: boolean;
}

/** Days since the epoch for a YYYY-MM-DD string. UTC throughout: this counts days, never clocks. */
function dayIndex(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // Date.UTC normalises 31 February into March, which would silently accept a nonsense date.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.floor(ms / 86_400_000);
}

// [CENT] Two definitions of one fact is how they come to disagree — the same argument this module
// makes about the 1.225 itself. Hours are numeric(6,2), so the canonical two-decimal rounding is
// exactly the right one; there is no second shape of it here.
// round1 is a different fact (a weekly pace, shown to one decimal) and has no canonical home.
const round1 = (n: number) => Math.round(n * 10) / 10;

export function assessUrencriterium(input: UrencriteriumInput): UrencriteriumStatus {
  const { hoursSoFar, today, year } = input;
  const threshold = URENCRITERIUM_HOURS;

  const base = {
    year, threshold, hours: null as number | null, remaining: threshold,
    daysLeft: 0, neededPerWeek: null as number | null, projected: null as number | null, warn: false,
  };

  // [NO-SILENT-EMPTY] A read that failed is not a criterion that was missed. The accountant reads
  // this to decide the zelfstandigenaftrek, so "we could not look" has to stay its own answer.
  if (hoursSoFar === null || !Number.isFinite(hoursSoFar)) {
    return { ...base, level: "unknown" };
  }

  const hours = round2(Math.max(0, hoursSoFar));
  const remaining = round2(Math.max(0, threshold - hours));

  const todayIdx = dayIndex(today);
  const firstDay = dayIndex(`${year}-01-01`);
  const lastDay = dayIndex(`${year}-12-31`);
  // An unreadable date is the same kind of not-knowing as an unreadable hours total.
  if (todayIdx === null || firstDay === null || lastDay === null) {
    return { ...base, hours, remaining, level: "unknown" };
  }

  const daysLeft = Math.max(0, lastDay - todayIdx);
  const met = hours >= threshold;

  // A year that has not started yet says nothing at all — there is no pace to have.
  if (todayIdx < firstDay) {
    return { ...base, hours, remaining, daysLeft: lastDay - firstDay + 1, level: "too_early" };
  }

  // A year that is over is a fact. `met` still governs, so a late registration that pushes an old
  // year over the line is reflected the moment it is entered.
  if (todayIdx > lastDay) {
    return { ...base, hours, remaining, level: met ? "closed_met" : "closed_missed" };
  }

  if (met) {
    return { ...base, hours, remaining: 0, daysLeft, level: "met" };
  }

  const daysElapsed = todayIdx - firstDay + 1;
  // Hours per week over what is left. On 31 December there are no days left, so there is no pace
  // that reaches it — the year is decided, and it reads as one that closed short.
  if (daysLeft <= 0) {
    return { ...base, hours, remaining, daysLeft: 0, level: "closed_missed", warn: false };
  }
  const neededPerWeek = round1((remaining / daysLeft) * 7);

  // Too early to forecast: show the progress and what the rest of the year asks, but do not
  // pretend to know where it lands. See PROJECTION_MIN_DAYS.
  if (daysElapsed < PROJECTION_MIN_DAYS) {
    return { ...base, hours, remaining, daysLeft, neededPerWeek, level: "too_early" };
  }

  const projected = round2(hours + (hours / daysElapsed) * daysLeft);

  // Ordered from the hardest fact to the softest judgement.
  let level: UrencriteriumLevel;
  if (remaining > daysLeft * 24) level = "unreachable";
  else if (projected >= threshold) level = "on_track";
  else if (neededPerWeek > HARD_WEEK_HOURS) level = "critical";
  else level = "behind";

  return {
    ...base, hours, remaining, daysLeft, neededPerWeek, projected, level,
    warn: level !== "on_track",
  };
}
