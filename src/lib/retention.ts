// src/lib/retention.ts
// [BOEK-032] Data retention math — Dutch Bewaarplicht (7-year keep).
//
// Scope (confirmed by Tech Lead, v1.2 simplified):
//   - eligible = baseDate + 7 years, where baseDate is the deactivation moment
//     (deletion_requests.created_at). Pure, framework-free, node-testable.
//   - Uses UTC methods so results are deterministic regardless of server TZ.
//
// ⚠️ Legal note — and the correction that had to be made here.
//   Art. 52 AWR counts the seven years from the END of the FISCAL YEAR a record
//   belongs to, not from a single account-level date. Records of boekjaar 2026
//   must therefore be kept through 31 December 2033.
//
//   This module used to add seven years TO THE DAY and call that "intentionally
//   conservative: it keeps data at least as long as required, never less." The
//   opposite was true. An account deactivated on 15 January 2026 became eligible
//   on 15 January 2033 — while its own 2026 records were still under the
//   bewaarplicht for another eleven and a half months. Every January closure was
//   short by most of a year, and the shortfall shrinks only as the closure date
//   approaches December.
//
//   So the window now rounds UP to the end of the fiscal year: eligible from
//   1 January of (year(baseDate) + 7 + 1), i.e. the first instant after
//   31 December of year+7. That is the account-level approximation actually
//   being conservative — it can only ever keep data LONGER than the day-exact
//   sum, never shorter. The per-record flag (brief §3.7) stays deferred.

export const RETENTION_YEARS = 7;

/** Coerce a string | number | Date into a Date without mutating the input. */
function toDate(value: string | number | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/**
 * The instant from which an account's data becomes eligible for deletion: the
 * first moment AFTER 31 December of (fiscal year of `baseDate` + RETENTION_YEARS).
 * `baseDate` is the deactivation moment (deletion_requests.created_at).
 * Returns a new Date; never mutates the input.
 *
 * Deliberately a year boundary, not baseDate + 7 years — see the legal note at
 * the top of this file for the eleven-and-a-half months that cost.
 */
export function computeEligibleForDeletion(
  baseDate: string | number | Date,
): Date {
  const d = toDate(baseDate);
  // 1 Jan of year+8 at 00:00:00.000Z == the instant 31 Dec of year+7 ends. Built
  // from the year alone, so the month/day/time of the closure cannot leak in.
  return new Date(Date.UTC(d.getUTCFullYear() + RETENTION_YEARS + 1, 0, 1, 0, 0, 0, 0));
}

/**
 * ISO string to store in deletion_requests.data_eligible_for_deletion_at.
 */
export function eligibleForDeletionISO(
  baseDate: string | number | Date,
): string {
  return computeEligibleForDeletion(baseDate).toISOString();
}

/**
 * Whether an account's data has passed its retention window.
 *
 * [A1] This used to have NO CALLER: the timer was stamped at deactivation and
 * nothing ever read it, so GDPR erasure never executed. It is now consumed by
 * `decidePurge` in retention-purge.ts, which uses it as the SECOND of two
 * independent checks — the stored eligible-date and this recomputation must
 * BOTH say "expired" before anything is erased, so a corrupted stored date can
 * only ever delay a purge, never bring one forward.
 *
 * Still a suggestion, not an executor: the purge job additionally requires a
 * deliberate human switch (RETENTION_PURGE_ENABLED) before it deletes anything.
 * The deferred per-record AI flag (brief §3.7) will build on this.
 */
export function isEligibleForDeletion(
  baseDate: string | number | Date,
  now: string | number | Date = new Date(),
): boolean {
  return toDate(now).getTime() >= computeEligibleForDeletion(baseDate).getTime();
}