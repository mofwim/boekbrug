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

test("computeEligibleForDeletion adds exactly 7 years", () => {
  const eligible = computeEligibleForDeletion("2026-06-06T10:00:00.000Z");
  assert.equal(eligible.toISOString(), "2033-06-06T10:00:00.000Z");
});

test("computeEligibleForDeletion accepts a Date and does not mutate it", () => {
  const base = new Date("2026-06-06T10:00:00.000Z");
  const before = base.getTime();
  const eligible = computeEligibleForDeletion(base);
  assert.equal(eligible.toISOString(), "2033-06-06T10:00:00.000Z");
  assert.equal(base.getTime(), before); // input untouched
});

test("leap day Feb 29 normalizes forward in non-leap target year", () => {
  // 2024-02-29 + 7y → 2031 (non-leap) → JS rolls to 2031-03-01
  const eligible = computeEligibleForDeletion("2024-02-29T00:00:00.000Z");
  assert.equal(eligible.toISOString(), "2031-03-01T00:00:00.000Z");
});

test("eligibleForDeletionISO returns the ISO string", () => {
  assert.equal(
    eligibleForDeletionISO("2026-06-06T10:00:00.000Z"),
    "2033-06-06T10:00:00.000Z",
  );
});

test("isEligibleForDeletion: before the window → false", () => {
  assert.equal(
    isEligibleForDeletion("2026-06-06T00:00:00.000Z", "2030-06-06T00:00:00.000Z"),
    false,
  );
});

test("isEligibleForDeletion: exactly 7 years and beyond → true", () => {
  assert.equal(
    isEligibleForDeletion("2026-06-06T00:00:00.000Z", "2033-06-06T00:00:00.000Z"),
    true,
  );
  assert.equal(
    isEligibleForDeletion("2026-06-06T00:00:00.000Z", "2034-01-01T00:00:00.000Z"),
    true,
  );
});