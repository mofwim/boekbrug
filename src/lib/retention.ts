// src/lib/retention.ts
// [BOEK-032] Data retention math — Dutch Bewaarplicht (7-year keep).
//
// Scope (confirmed by Tech Lead, v1.2 simplified):
//   - eligible = baseDate + 7 years, where baseDate is the deactivation moment
//     (deletion_requests.created_at). Pure, framework-free, node-testable.
//   - Uses UTC methods so results are deterministic regardless of server TZ.
//
// ⚠️ Legal note (logged for the future, NOT implemented here):
//   Strict Bewaarplicht counts 7 years from the END of the fiscal year of each
//   record — not from a single account-level date. The per-record AI flag
//   ("mag wettelijk verwijderd worden") is deferred (vision doc / brief §3.7).
//   Until then this account-level approximation is intentionally conservative:
//   it keeps data at least as long as required, never less.

export const RETENTION_YEARS = 7;

/** Coerce a string | number | Date into a Date without mutating the input. */
function toDate(value: string | number | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/**
 * The date on which an account's data becomes eligible for deletion:
 * baseDate + RETENTION_YEARS. `baseDate` is the deactivation moment
 * (deletion_requests.created_at). Returns a new Date; never mutates the input.
 */
export function computeEligibleForDeletion(
  baseDate: string | number | Date,
): Date {
  const d = toDate(baseDate);
  d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS);
  return d;
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