// src/lib/retention.test.ts
// [BOEK-032] Pure unit tests — no app deps.
// Run:  node --experimental-strip-types src/lib/retention.test.ts
//   or: npx tsx src/lib/retention.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  RETENTION_YEARS,
  computeEligibleForDeletion,
  eligibleForDeletionISO,
  isEligibleForDeletion,
} from "./retention";

test("RETENTION_YEARS is 7 (Bewaarplicht)", () => {
  assert.equal(RETENTION_YEARS, 7);
});

// Art. 52 AWR counts from the END of the fiscal year, so the window closes on a
// year boundary — never on the anniversary of the closure date.
test("the window ends at the fiscal year end, not on the day+7", () => {
  const eligible = computeEligibleForDeletion("2026-06-06T10:00:00.000Z");
  assert.equal(eligible.toISOString(), "2034-01-01T00:00:00.000Z");
});

test("THE BUG: a January closure no longer expires eleven months early", () => {
  // Deactivated 15 Jan 2026. Its 2026 records must be kept through 31 Dec 2033.
  // The old rule said 15 Jan 2033 — inside the bewaarplicht by ~11.5 months.
  const eligible = computeEligibleForDeletion("2026-01-15T00:00:00.000Z");
  assert.equal(eligible.toISOString(), "2034-01-01T00:00:00.000Z");
  assert.equal(
    isEligibleForDeletion("2026-01-15T00:00:00.000Z", "2033-01-15T00:00:00.000Z"),
    false,
    "15 Jan 2033 is still inside the seven years for boekjaar 2026",
  );
  assert.equal(
    isEligibleForDeletion("2026-01-15T00:00:00.000Z", "2033-12-31T23:59:59.999Z"),
    false,
    "the last day of the seventh year is still protected",
  );
});

test("every closure in the same fiscal year shares one expiry", () => {
  // The month and day of the closure may not leak into the window at all.
  const jan = computeEligibleForDeletion("2026-01-01T00:00:00.000Z");
  const dec = computeEligibleForDeletion("2026-12-31T23:59:59.999Z");
  assert.equal(jan.toISOString(), dec.toISOString());
  assert.equal(jan.toISOString(), "2034-01-01T00:00:00.000Z");
});

test("computeEligibleForDeletion accepts a Date and does not mutate it", () => {
  const base = new Date("2026-06-06T10:00:00.000Z");
  const before = base.getTime();
  const eligible = computeEligibleForDeletion(base);
  assert.equal(eligible.toISOString(), "2034-01-01T00:00:00.000Z");
  assert.equal(base.getTime(), before); // input untouched
});

test("a leap day needs no special case once the window is a year boundary", () => {
  // The old day-exact rule rolled 2024-02-29 to 2031-03-01. A year boundary has
  // no such edge: 29 February is simply somewhere inside boekjaar 2024.
  const eligible = computeEligibleForDeletion("2024-02-29T00:00:00.000Z");
  assert.equal(eligible.toISOString(), "2032-01-01T00:00:00.000Z");
});

test("eligibleForDeletionISO returns the ISO string", () => {
  assert.equal(
    eligibleForDeletionISO("2026-06-06T10:00:00.000Z"),
    "2034-01-01T00:00:00.000Z",
  );
});

test("isEligibleForDeletion: before the window → false", () => {
  assert.equal(
    isEligibleForDeletion("2026-06-06T00:00:00.000Z", "2030-06-06T00:00:00.000Z"),
    false,
  );
});

test("isEligibleForDeletion: from the first instant of the eighth year → true", () => {
  assert.equal(
    isEligibleForDeletion("2026-06-06T00:00:00.000Z", "2034-01-01T00:00:00.000Z"),
    true,
  );
  assert.equal(
    isEligibleForDeletion("2026-06-06T00:00:00.000Z", "2035-06-06T00:00:00.000Z"),
    true,
  );
});

test("the new window is never EARLIER than the old day-exact one", () => {
  // The whole point of the correction: it can only ever keep data longer.
  for (const iso of [
    "2026-01-01T00:00:00.000Z", "2026-06-06T10:00:00.000Z",
    "2026-12-31T23:59:59.999Z", "2024-02-29T00:00:00.000Z",
  ]) {
    const dayExact = new Date(iso);
    dayExact.setUTCFullYear(dayExact.getUTCFullYear() + RETENTION_YEARS);
    assert.ok(
      computeEligibleForDeletion(iso).getTime() >= dayExact.getTime(),
      `${iso}: the corrected window must not come earlier than day+7`,
    );
  }
});
