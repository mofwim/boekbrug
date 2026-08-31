// [URENCRITERIUM] Pure node test — run: npx tsx --test src/lib/urencriterium.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessUrencriterium, URENCRITERIUM_HOURS, PROJECTION_MIN_DAYS, HARD_WEEK_HOURS,
} from "./urencriterium";

test("[URENCRITERIUM] a failed read is never a missed criterion", () => {
  // The accountant reads this to decide the zelfstandigenaftrek. "We could not look" and "you did
  // not make it" are opposite answers, and only one of them is true after a hiccup.
  const s = assessUrencriterium({ hoursSoFar: null, today: "2026-08-28", year: 2026 });
  assert.equal(s.level, "unknown");
  assert.equal(s.hours, null);
  assert.equal(s.warn, false, "a read failure must not raise an alarm about the owner's hours");
});

test("[URENCRITERIUM] met is met, and the screen stops asking", () => {
  const s = assessUrencriterium({ hoursSoFar: 1225, today: "2026-08-28", year: 2026 });
  assert.equal(s.level, "met");
  assert.equal(s.remaining, 0);
  assert.equal(s.warn, false, "a criterion already met must not keep warning");

  // Exactly at the threshold counts. An off-by-one here denies a deduction that was earned.
  assert.equal(assessUrencriterium({ hoursSoFar: URENCRITERIUM_HOURS, today: "2026-12-31", year: 2026 }).level, "met");
  assert.equal(assessUrencriterium({ hoursSoFar: URENCRITERIUM_HOURS - 0.01, today: "2026-06-01", year: 2026 }).level !== "met", true);
});

test("[URENCRITERIUM] January does not forecast the year from ten days", () => {
  // 20 hours in the first ten days extrapolates to about 730 — or to 1.400 if two of those days
  // were busy. A warning built on that swings daily, and the owner learns to ignore it before the
  // real one arrives in September.
  const s = assessUrencriterium({ hoursSoFar: 20, today: "2026-01-10", year: 2026 });
  assert.equal(s.level, "too_early");
  assert.equal(s.projected, null, "it forecast the year from ten days");
  assert.equal(s.warn, false);
  // It still answers the question the owner CAN act on.
  assert.ok(s.neededPerWeek !== null && s.neededPerWeek > 0, "…but it still says what the rest of the year asks");

  // The boundary itself: the day before projects nothing, the day after projects.
  const before = assessUrencriterium({ hoursSoFar: 100, today: "2026-02-13", year: 2026 }); // day 44
  const after = assessUrencriterium({ hoursSoFar: 100, today: "2026-02-14", year: 2026 });  // day 45
  assert.equal(before.projected, null);
  assert.ok(after.projected !== null, `day ${PROJECTION_MIN_DAYS} must be the first that forecasts`);
});

test("[URENCRITERIUM] the same hours read differently depending on how much year is left", () => {
  // 700 hours is a good year at the end of June and a lost one at the end of November. The whole
  // point of assessing this DURING the year is that the same number changes meaning.
  const june = assessUrencriterium({ hoursSoFar: 700, today: "2026-06-30", year: 2026 });
  assert.equal(june.level, "on_track", `700h by 30 June projected ${june.projected}`);
  assert.equal(june.warn, false);

  const november = assessUrencriterium({ hoursSoFar: 700, today: "2026-11-30", year: 2026 });
  assert.notEqual(november.level, "on_track");
  assert.equal(november.warn, true, "a year that is running out must interrupt");
  assert.ok(november.neededPerWeek !== null && november.neededPerWeek > 0);
});

test("[URENCRITERIUM] behind and seriously behind are different sentences", () => {
  // The split is a full working week. Below it, registering more carefully still gets there;
  // above it, the year has got away and saying "you can still do this" would be a kindness that
  // costs the owner the chance to plan around losing the deduction.
  const behind = assessUrencriterium({ hoursSoFar: 900, today: "2026-09-30", year: 2026 });
  assert.equal(behind.level, "behind", `needed ${behind.neededPerWeek}/week`);
  assert.ok(behind.neededPerWeek !== null && behind.neededPerWeek <= HARD_WEEK_HOURS);

  const critical = assessUrencriterium({ hoursSoFar: 500, today: "2026-11-15", year: 2026 });
  assert.equal(critical.level, "critical", `needed ${critical.neededPerWeek}/week`);
  assert.ok(critical.neededPerWeek !== null && critical.neededPerWeek > HARD_WEEK_HOURS);
});

test("[URENCRITERIUM] a target that no longer fits in the remaining days says so", () => {
  // Three days left and 200 hours to go is not "seriously behind", it is arithmetically over.
  // Naming it differently is the difference between a plan and a false hope.
  const s = assessUrencriterium({ hoursSoFar: 1025, today: "2026-12-29", year: 2026 });
  assert.equal(s.level, "unreachable");
  assert.equal(s.warn, true);
});

test("[URENCRITERIUM] a closed year is a fact, not a forecast", () => {
  const missed = assessUrencriterium({ hoursSoFar: 900, today: "2026-08-28", year: 2025 });
  assert.equal(missed.level, "closed_missed");
  assert.equal(missed.projected, null, "a year that is over does not get a projection");
  assert.equal(missed.warn, false, "nothing can be done about it, so it must not shout");

  const made = assessUrencriterium({ hoursSoFar: 1300, today: "2026-08-28", year: 2025 });
  assert.equal(made.level, "closed_met");

  // 31 December, still short: the year is decided even though it is technically today.
  const lastDay = assessUrencriterium({ hoursSoFar: 900, today: "2026-12-31", year: 2026 });
  assert.equal(lastDay.level, "closed_missed");
  assert.equal(lastDay.daysLeft, 0);
});

test("[URENCRITERIUM] the threshold is never divided for a starter", () => {
  // THE most commonly assumed-otherwise rule in the criterion: someone who starts in September
  // still needs 1.225 hours that calendar year. A pro-rata would report a starter as on track and
  // cost them the whole deduction.
  const september = assessUrencriterium({ hoursSoFar: 300, today: "2026-09-30", year: 2026 });
  assert.equal(september.threshold, 1225, "the threshold was scaled to the part of the year worked");
  assert.equal(september.remaining, 925);
});

test("[URENCRITERIUM] a date it cannot read is not-knowing, not zero", () => {
  for (const bad of ["", "28-08-2026", "2026-13-01", "2026-02-30", "gisteren"]) {
    const s = assessUrencriterium({ hoursSoFar: 500, today: bad, year: 2026 });
    assert.equal(s.level, "unknown", `${JSON.stringify(bad)} was accepted as a date`);
    assert.equal(s.warn, false);
  }
});

test("[URENCRITERIUM] a leap year has its extra day", () => {
  // 2028 is a leap year. Counting 365 days would put 31 December one day early and quietly shift
  // every pace in the last week of the year.
  const s = assessUrencriterium({ hoursSoFar: 0, today: "2028-01-01", year: 2028 });
  assert.equal(s.daysLeft, 365, "29 February was not counted");
  const ordinary = assessUrencriterium({ hoursSoFar: 0, today: "2026-01-01", year: 2026 });
  assert.equal(ordinary.daysLeft, 364);
});

// ─── [NIET-BIJGEHOUDEN] Een leeg urenregister is geen mislukt jaar ──────────────────────────────
//
// Rule 3 in this module's header — only REGISTERED hours count — is a statement about the
// registration, not about the work, and that is "the difference between a fact and an accusation".
// The verdict crossed that line: an owner with no entries got the full warning, in red, about the
// largest deduction a zzp'er has.
//
// Measured when this was written: every single owner in the production database had zero time
// entries. Not an edge case — the answer everybody got. And a warning everybody gets over nothing
// is precisely the noise this module's own header says costs the real warning its credibility.

test("[NIET-BIJGEHOUDEN] an owner who has never registered an hour gets no verdict", () => {
  const r = assessUrencriterium({ hoursSoFar: 0, today: "2026-08-31", year: 2026, everRegistered: false });
  assert.equal(r.level, "not_tracked");
  assert.equal(r.warn, false, "there is nothing to warn about");
  assert.equal(r.projected, null, "and nothing to project from");
  assert.equal(r.neededPerWeek, null, "a pace over an empty register is a number about nothing");
});

test("[NIET-BIJGEHOUDEN] it wins over every other verdict, including a closed year", () => {
  // "closed_missed" over an empty register is the same accusation with the tense changed — and it
  // is the one an accountant would read in January about the year just gone.
  const closed = assessUrencriterium({ hoursSoFar: 0, today: "2027-02-01", year: 2026, everRegistered: false });
  assert.equal(closed.level, "not_tracked");
  const early = assessUrencriterium({ hoursSoFar: 0, today: "2026-01-05", year: 2026, everRegistered: false });
  assert.equal(early.level, "not_tracked");
});

test("[NIET-BIJGEHOUDEN] someone who DOES use the feature still gets the real warning", () => {
  // Last year's hours, none yet this year: an empty January is a genuine signal for him. This is
  // why the probe asks about ALL years and not this one.
  const r = assessUrencriterium({ hoursSoFar: 0, today: "2026-08-31", year: 2026, everRegistered: true });
  assert.notEqual(r.level, "not_tracked");
  assert.equal(r.warn, true);
});

test("[NIET-BIJGEHOUDEN] a failed probe changes nothing", () => {
  // The safe direction here is the opposite of most in this repo, and deliberately so: a broken
  // probe must not silence a warning that may be entirely genuine.
  const withNull = assessUrencriterium({ hoursSoFar: 400, today: "2026-08-31", year: 2026, everRegistered: null });
  const without = assessUrencriterium({ hoursSoFar: 400, today: "2026-08-31", year: 2026 });
  assert.deepEqual(withNull, without);
  assert.notEqual(withNull.level, "not_tracked");
});

test("[NIET-BIJGEHOUDEN] hours on the clock outrank the flag", () => {
  // everRegistered false with hours > 0 is a contradiction the caller cannot produce (the hours
  // come from the same table), but if it ever arrives the hours are the harder fact — and the
  // verdict must not claim 1.225 are still to go while 1.300 are registered.
  const r = assessUrencriterium({ hoursSoFar: 1300, today: "2026-08-31", year: 2026, everRegistered: false });
  assert.equal(r.level, "met", "registered hours are evidence of registration");
});
