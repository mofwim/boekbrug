// src/lib/overdue.ts
// [OVER-DATUM] "Is deze factuur over datum, en hoeveel dagen?" — one pure answer, so every
// surface that shows it shows the same number.
//
// The honesty rule this module exists to protect: a due date is only ever a FACT here, never a
// guess. `deriveDueDate` (safecore.ts) stores invoices.due_date from the printed "Vervaldatum",
// or from invoice_date + a printed payment term, and stores NULL when the invoice states neither
// ("honesty over a fabricated default"). So a missing due date means we genuinely do not know
// when this bill was due — and this function returns null rather than inventing the customary
// 30 days. Calling an invoice "5 dagen te laat" on an assumed term would be us making up a
// deadline the supplier never set.
//
// Dates are compared as plain ISO days (YYYY-MM-DD), never as instants: an invoice is due ON a
// date, not at a moment, so timezones and DST must not be able to shift the verdict by a day.
//
// Pure + testable: run `npx tsx src/lib/overdue.test.ts`.

/**
 * Whole days a bill is past its due date.
 *
 * @param dueDate  invoices.due_date — ISO 'YYYY-MM-DD' (a timestamp is tolerated; only the date
 *                 part is read). Null/empty/unparseable → null (unknown, never assumed).
 * @param todayIso today as 'YYYY-MM-DD' — passed in, never read from the clock, so the caller
 *                 controls the day boundary and the function stays pure/testable.
 * @returns days late (≥ 1), or null when there is no due date, the date is unusable, or the bill
 *          is not yet past due. Due TODAY is not late.
 */
export function overdueDays(
  dueDate: string | null | undefined,
  todayIso: string,
): number | null {
  const due = isoDay(dueDate);
  const today = isoDay(todayIso);
  if (!due || !today) return null;
  // String compare is exact for zero-padded ISO days and needs no Date at all.
  if (due >= today) return null;

  const dueMs = Date.parse(`${due}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) return null;
  // Both are UTC midnights, so the difference is a whole number of days — no DST drift.
  const days = Math.round((todayMs - dueMs) / 86_400_000);
  return days > 0 ? days : null;
}

/**
 * Whole days still left before a bill is due.
 *
 * The mirror image of `overdueDays`, under the exact same honesty rule: no stated due date means we
 * genuinely do not know when this bill must be paid, so this returns null rather than counting down
 * to a deadline the supplier never set. The two functions partition the timeline and never both
 * answer — `overdueDays` owns every day PAST the date, this one owns the date itself and everything
 * before it. So a row can show "nog 5 dagen" or "3 dagen te laat", never both, and never neither
 * while a due date exists.
 *
 * @param dueDate  invoices.due_date — ISO 'YYYY-MM-DD' (a timestamp is tolerated; only the date
 *                 part is read). Null/empty/unparseable → null (unknown, never assumed).
 * @param todayIso today as 'YYYY-MM-DD' — passed in, never read from the clock, so the caller
 *                 controls the day boundary and the function stays pure/testable.
 * @returns days remaining (0 = due TODAY), or null when there is no usable due date or the bill is
 *          already past due.
 */
export function daysUntilDue(
  dueDate: string | null | undefined,
  todayIso: string,
): number | null {
  const due = isoDay(dueDate);
  const today = isoDay(todayIso);
  if (!due || !today) return null;
  // Past due is overdueDays' half of the timeline — never answer for it here.
  if (due < today) return null;

  const dueMs = Date.parse(`${due}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) return null;
  // Both are UTC midnights, so the difference is a whole number of days — no DST drift.
  return Math.round((dueMs - todayMs) / 86_400_000);
}

/** The 'YYYY-MM-DD' part of a date string, but only if it really is a well-formed ISO day. */
function isoDay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const head = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  // Reject impossible days ('2026-13-40') — Date.parse would silently roll them over.
  const t = Date.parse(`${head}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === head ? head : null;
}
