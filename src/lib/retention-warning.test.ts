// [WAARSCHUWING] Pure node test — run: npx tsx --test src/lib/retention-warning.test.ts
//
// The mirror image of retention-purge.test.ts. There, almost every test is a REFUSAL, because a
// wrong purge is unrecoverable. Here the dangerous direction is the opposite one: a warning that
// is NOT sent leaves someone's bookkeeping to be deleted with no notice — and since decidePurge()
// now requires the warning, a warning that is never sent also silently freezes the purge forever.
// So this file tests both edges: who must be warned, and who must never be.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideWarning,
  warningSatisfied,
  partitionWarningCandidates,
  WARNING_NOTICE_DAYS,
  WARNING_LEAD_DAYS,
  type WarnableRow,
} from "./retention-warning";

const NOW = new Date("2034-08-01T00:00:00.000Z");
const USER = "11111111-2222-3333-4444-555555555555";
const DAY = 86_400_000;

/** Days from NOW, as an ISO string. */
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

function row(over: Partial<WarnableRow> = {}): WarnableRow {
  return {
    id: "req-1",
    user_id: USER,
    deleted_at: "2027-06-01T00:00:00.000Z",
    // Expires in 40 days — inside the 60-day lead window, so this row is due a letter.
    data_eligible_for_deletion_at: at(40),
    purged_at: null,
    purge_warning_sent_at: null,
    ...over,
  };
}

test("a row inside the lead window gets its letter, with the days left in it", () => {
  const v = decideWarning(row(), NOW);
  assert.equal(v.warn, true);
  if (v.warn) assert.equal(v.daysLeft, 40, "the mail has to say how long they still have");
});

test("the lead is 60 days, not 30 — a missed cron run must cost nothing", () => {
  // Warning exactly at 30 would turn every skipped night into a delayed deletion, and someone
  // would eventually 'fix' that by shortening the notice period.
  assert.ok(WARNING_LEAD_DAYS > WARNING_NOTICE_DAYS);
  assert.equal(decideWarning(row({ data_eligible_for_deletion_at: at(WARNING_LEAD_DAYS) }), NOW).warn, true);
  const teVroeg = decideWarning(row({ data_eligible_for_deletion_at: at(WARNING_LEAD_DAYS + 5) }), NOW);
  assert.equal(teVroeg.warn, false);
  if (!teVroeg.warn) assert.equal(teVroeg.reason, "too_early");
});

test("a row whose retention ALREADY expired is warned, not skipped", () => {
  // The group this whole mechanism exists for: accounts whose seven years passed before any of
  // this was written. Skipping them would leave them permanently un-warned and therefore —
  // since decidePurge() now requires a warning — permanently un-purgeable.
  const v = decideWarning(row({ data_eligible_for_deletion_at: at(-500) }), NOW);
  assert.equal(v.warn, true);
  if (v.warn) assert.equal(v.daysLeft, 0, "never a negative number of days in a letter");
});

test("nobody is warned twice", () => {
  // One notice is a notice. A second is a dunning letter about someone's own bookkeeping.
  const v = decideWarning(row({ purge_warning_sent_at: at(-10) }), NOW);
  assert.equal(v.warn, false);
  if (!v.warn) assert.equal(v.reason, "already_warned");
});

test("an account that is still live is never warned", () => {
  // A deletion_requests row is created at EXPORT time, before the user confirms. Mailing "we are
  // about to delete your bookkeeping" to someone still using the app is the worst false positive
  // this file can produce.
  const v = decideWarning(row({ deleted_at: null }), NOW);
  assert.equal(v.warn, false);
  if (!v.warn) assert.equal(v.reason, "not_deactivated");
});

test("a paid Bewaarkluis is never warned", () => {
  // Nothing is going to be deleted, so there is nothing to give notice of — and "we are about to
  // delete what you bought" is the most alarming mail this product could send.
  const v = decideWarning(row({ kluis_keep_through_year: 2040 }), NOW);
  assert.equal(v.warn, false);
  if (!v.warn) assert.equal(v.reason, "bewaarkluis_actief");
});

test("orphans, purged rows and undated rows are skipped with a reason", () => {
  const gevallen: Array<[Partial<WarnableRow>, string]> = [
    [{ user_id: null }, "no_user_id"],
    [{ purged_at: at(-1) }, "already_purged"],
    [{ data_eligible_for_deletion_at: null }, "no_eligible_date"],
    [{ data_eligible_for_deletion_at: "morgen" }, "unparseable_date"],
  ];
  for (const [over, reden] of gevallen) {
    const v = decideWarning(row(over), NOW);
    assert.equal(v.warn, false, `${reden} must not be warned`);
    if (!v.warn) assert.equal(v.reason, reden);
  }
});

test("warningSatisfied fails closed on every doubtful input", () => {
  // This is the function that unlocks an irreversible deletion. There must be no input that
  // accidentally produces true.
  assert.equal(warningSatisfied(row({ purge_warning_sent_at: null }), NOW), false, "never sent");
  const zonderKolom = row();
  delete (zonderKolom as { purge_warning_sent_at?: string | null }).purge_warning_sent_at;
  assert.equal(warningSatisfied(zonderKolom, NOW), false, "column missing entirely");
  assert.equal(warningSatisfied(row({ purge_warning_sent_at: "ooit" }), NOW), false, "unreadable");
  assert.equal(warningSatisfied(row({ purge_warning_sent_at: at(+5) }), NOW), false, "stamped in the future");
  assert.equal(warningSatisfied(row({ purge_warning_sent_at: at(-29) }), NOW), false, "29 days is not 30");
});

test("exactly 30 days satisfies it — 'minstens 30 dagen' is a floor", () => {
  assert.equal(warningSatisfied(row({ purge_warning_sent_at: at(-WARNING_NOTICE_DAYS) }), NOW), true);
  assert.equal(warningSatisfied(row({ purge_warning_sent_at: at(-400) }), NOW), true);
});

test("a page splits into letters and skips, each skip with its reason", () => {
  const { warn, skip } = partitionWarningCandidates(
    [
      row({ id: "due" }),
      row({ id: "live", deleted_at: null }),
      row({ id: "done", purge_warning_sent_at: at(-40) }),
      row({ id: "far", data_eligible_for_deletion_at: at(400) }),
      row({ id: "kluis", kluis_keep_through_year: 2050 }),
    ],
    NOW,
  );
  assert.deepEqual(warn.map((w) => w.row.id), ["due"]);
  assert.equal(skip.length, 4);
  assert.ok(skip.every((s) => typeof s.reason === "string" && s.reason.length > 0));
});

test("an empty page writes to nobody", () => {
  assert.equal(partitionWarningCandidates([], NOW).warn.length, 0);
});
