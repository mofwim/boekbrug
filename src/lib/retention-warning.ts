// src/lib/retention-warning.ts
// [WAARSCHUWING] Nobody's bookkeeping is erased without 30 days' notice. Pure, no I/O.
// Run: npx tsx --test src/lib/retention-warning.test.ts
//
// WHY THIS EXISTS
//
// The terms promise it, in §5.7.5, in so many words:
//
//   "Wij verwijderen daarna niets zonder je minstens 30 dagen vooraf per e-mail te waarschuwen,
//    en in die periode kun je alles alsnog kosteloos exporteren."
//
// Nothing implemented it. retention-purge.ts returned `{ purge: true }` the instant the seven
// years were up, and no mail had ever been sent. That is a promise with no mechanism — the worst
// kind, because it reads as done and is discovered by the one person it was written for.
//
// THE DESIGN CHOICE THAT MATTERS
//
// The obvious implementation is "the cron sends a warning first". That is not enough, and it is
// worth saying why: a cron that fails, is disabled, or is added later than the purge produces
// exactly the promised-but-not-delivered outcome, silently. So the notice is not a step BEFORE
// the purge, it is a PRECONDITION OF it — decidePurge() now refuses a row that cannot prove a
// warning went out at least 30 days ago. If the warning machinery breaks, nothing is deleted.
// The failure mode is "we kept it too long", which §5.7.5 costs nothing, instead of "we deleted
// it without telling you", which is the one thing the clause exists to prevent.
//
// FIRST DELETION IS NOT DUE BEFORE 2033. That is precisely why this is written now: by then
// nobody will remember the sentence, and the code will be the only thing that still knows.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md).

import type { DeletionRequestRow } from "./retention-purge";

/**
 * The contractual notice period, in days. §5.7.5 says "minstens 30 dagen vooraf".
 *
 * "Minstens" is why the comparison below is >=, and why a warning sent 29 days ago is not enough
 * to unlock a purge: the client is owed a full thirty.
 */
export const WARNING_NOTICE_DAYS = 30;

/**
 * How far ahead the warning goes out.
 *
 * Sixty, not thirty. The cron is not guaranteed to run on the exact day the window opens — a
 * missed night, a deploy, a month where it was disabled. Warning from 60 days out means an
 * ordinary hiccup costs nothing: the purge simply waits until a warning is 30 days old. Warning
 * exactly at 30 would turn every missed run into a delayed deletion, and someone would eventually
 * "fix" that by shortening the notice.
 */
export const WARNING_LEAD_DAYS = 60;

const DAY_MS = 86_400_000;

export type WarningVerdict =
  | { warn: true; /** Days until the retention period expires — goes in the e-mail. */ daysLeft: number }
  | { warn: false; reason: WarningRefusal };

export type WarningRefusal =
  | "no_user_id" // orphan row — there is nobody to write to
  | "not_deactivated" // still an active account; warning them would be alarming and wrong
  | "no_eligible_date" // the timer was never stamped, so there is no date to warn about
  | "unparseable_date"
  | "already_warned" // one notice is a notice; a second is a dunning letter
  | "already_purged"
  | "too_early" // more than WARNING_LEAD_DAYS away
  | "bewaarkluis_actief"; // paid-for storage is not about to be erased, so there is nothing to warn about

/**
 * Should this row get its 30-day notice now?
 *
 * `now` is injected so a single cron run judges every row against one instant, and so the test is
 * exact — same rule as decidePurge().
 *
 * Note what this does NOT refuse: a row whose retention has ALREADY expired. Those are the rows
 * that matter most — a legacy account whose seven years passed before this file existed must
 * still get its letter, and it gets `daysLeft: 0`. Refusing them would leave exactly the group
 * the whole mechanism was built for permanently un-warnable and therefore permanently un-purgeable.
 */
export function decideWarning(row: WarnableRow, now: Date): WarningVerdict {
  if (!row.user_id) return { warn: false, reason: "no_user_id" };
  if (row.purged_at) return { warn: false, reason: "already_purged" };
  if (!row.deleted_at) return { warn: false, reason: "not_deactivated" };
  if (row.purge_warning_sent_at) return { warn: false, reason: "already_warned" };
  if (!row.data_eligible_for_deletion_at) return { warn: false, reason: "no_eligible_date" };

  const eligibleMs = Date.parse(row.data_eligible_for_deletion_at);
  if (Number.isNaN(eligibleMs)) return { warn: false, reason: "unparseable_date" };

  // [KLUIS] A paid vault is not going to be erased, so there is nothing to give notice of. Warning
  // anyway would be the most alarming possible mail to send someone who paid us to keep their
  // records: "we are about to delete what you bought".
  const kluis = row.kluis_keep_through_year;
  if (typeof kluis === "number" && Number.isFinite(kluis) && now.getUTCFullYear() <= kluis) {
    return { warn: false, reason: "bewaarkluis_actief" };
  }

  const daysLeft = Math.ceil((eligibleMs - now.getTime()) / DAY_MS);
  if (daysLeft > WARNING_LEAD_DAYS) return { warn: false, reason: "too_early" };

  return { warn: true, daysLeft: Math.max(0, daysLeft) };
}

/** A deletion_requests row plus the column this module adds. */
export type WarnableRow = DeletionRequestRow & {
  /** When the 30-day notice went out, or null. Never cleared once set. */
  purge_warning_sent_at?: string | null;
};

/**
 * Has this row been warned long enough ago to be purged?
 *
 * This is the function decidePurge() consults, and everything about it fails CLOSED:
 * missing column, missing value, unreadable date, a date in the future — every one of them
 * answers false. There is no input to this function that produces "yes, delete it" by accident.
 */
export function warningSatisfied(row: WarnableRow, now: Date): boolean {
  const sent = row.purge_warning_sent_at;
  if (!sent) return false;
  const sentMs = Date.parse(sent);
  if (!Number.isFinite(sentMs)) return false;
  // A warning stamped in the future is a clock problem or a hand-edit. Either way it is not proof
  // that anyone was told anything.
  if (sentMs > now.getTime()) return false;
  const days = (now.getTime() - sentMs) / DAY_MS;
  return days >= WARNING_NOTICE_DAYS;
}

/**
 * Split a page of rows into the ones to warn and the ones to skip, with the reason — same shape
 * as partitionPurgeCandidates, so a dry run can explain itself line by line.
 */
export function partitionWarningCandidates(
  rows: WarnableRow[],
  now: Date,
): {
  warn: Array<{ row: WarnableRow; daysLeft: number }>;
  skip: Array<{ row: WarnableRow; reason: WarningRefusal }>;
} {
  const warn: Array<{ row: WarnableRow; daysLeft: number }> = [];
  const skip: Array<{ row: WarnableRow; reason: WarningRefusal }> = [];
  for (const row of rows) {
    const verdict = decideWarning(row, now);
    if (verdict.warn) warn.push({ row, daysLeft: verdict.daysLeft });
    else skip.push({ row, reason: verdict.reason });
  }
  return { warn, skip };
}
