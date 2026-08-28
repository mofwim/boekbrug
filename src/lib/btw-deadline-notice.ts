// src/lib/btw-deadline-notice.ts
// [DEADLINE] When the BTW-aangifte is due, and how much time is left to do something about it.
// Pure. No I/O, no React. Run: npx tsx --test src/lib/btw-deadline-notice.test.ts
//
// ── WHY THIS EXISTS ──
// The app already knew the deadline — btwDeadline() in btw-reservation.ts has computed it
// correctly, Q4-rollover and all, since the reservation panel was built. Exactly one screen ever
// used it: that panel, which renders only on /dashboard/vandaag. And Vandaag is not in the phone's
// bottom bar, its top-bar link is hidden below 640px, and the home only links to it when something
// is already overdue. So on the device these owners actually hold, the one place the deadline was
// ever stated was a screen they had no standing way to reach.
//
// What is left is a single notification on the 5th of the month after the quarter — roughly 26 days
// out. Dismiss that one and nothing in the product mentions the deadline again, ever. The first
// thing the owner hears is "de datum is voorbij", by which time the boete and the belastingrente
// are already running.
//
// ── WHY THE COPY IS BUILT HERE AND NOT IN THE SCREENS ──
// Three surfaces need the same sentence (the aangifte screen, klaar, and the escalating
// notification), and they must not each round the days differently. The one that matters is
// TODAY: with the deadline on the 31st, "nog 0 dagen" and "vandaag" are the same fact and only one
// of them makes a person act.
//
// ── LANGUAGE ──
// This module returns a STATE and a day count, never a sentence. The words live in the catalogue,
// per screen, so the aangifte can say it in the owner's language. See AGENTS.md: a component (and
// a module like this one) holds no language of its own.

import { btwDeadline, type QuarterNo } from './btw-reservation'

/** How the deadline relates to today. */
export type DeadlineState =
  /** More than a week out — mentioned, not shouted. */
  | 'ruim'
  /** Seven days or fewer, and not yet today. This is where a nudge earns its place. */
  | 'bijna'
  /** The deadline IS today. */
  | 'vandaag'
  /** The deadline has passed and nothing was filed. */
  | 'voorbij'

export interface DeadlineNotice {
  /** ISO date the aangifte is due. */
  deadline: string
  /** Whole days from today to the deadline. Negative once it has passed. */
  days: number
  state: DeadlineState
}

/** Days between two ISO dates, counted on the calendar and never on the clock. */
function daysBetween(fromIso: string, toIso: string): number {
  // UTC midnights on both sides: a local-time subtraction crosses a DST boundary twice a year and
  // comes back 23 or 25 hours, which rounds to a day out — on a date that carries a fine.
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)))
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

/**
 * The deadline for one quarter, seen from one day.
 *
 * `today` is an ISO date in the owner's timezone — the callers pass amsterdamToday(), because a
 * deadline is a Dutch calendar date and the device clock is not.
 */
export function deadlineNotice(year: number, quarter: QuarterNo, today: string): DeadlineNotice {
  const deadline = btwDeadline(year, quarter)
  const days = daysBetween(today, deadline)
  const state: DeadlineState =
    days < 0 ? 'voorbij' : days === 0 ? 'vandaag' : days <= 7 ? 'bijna' : 'ruim'
  return { deadline, days, state }
}

/**
 * Should the escalating reminder go out for this quarter today?
 *
 * Deliberately narrow: only in the last week, and only while it has not been filed. The cron that
 * asks this runs on a fixed date, so this is a guard rather than the schedule — but it is the
 * guard that keeps a manual re-run from nagging someone three months early.
 */
export function deadlineNudgeDue(notice: DeadlineNotice, filed: boolean): boolean {
  if (filed) return false
  return notice.state === 'bijna' || notice.state === 'vandaag'
}
