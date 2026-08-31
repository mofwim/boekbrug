// [MOLLIE-C7-RACE] Pure node test — run: npx tsx --test src/lib/mollie-placeholder.test.ts
//
// One decision, and the whole chain behind it is in placeholderVerdict's own comment: a placeholder
// row is what the create route puts down right BEFORE it calls Mollie, so during that network round
// it is in use, not stranded. Deleting it there let a concurrent request hand out a checkout URL for
// a row that no longer existed — the customer pays, the webhook answers `ok: true` on an unknown
// row, Mollie stops retrying, and the money is in the bank with nothing in the books.

import { test } from "node:test";
import assert from "node:assert/strict";

import { placeholderVerdict, PLACEHOLDER_GRACE_MS } from "./mollie";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

test("a placeholder created a moment ago is in flight, not stranded", () => {
  assert.equal(placeholderVerdict(agoMs(0), NOW), "in_flight");
  assert.equal(placeholderVerdict(agoMs(1_500), NOW), "in_flight", "1,5s is a Mollie round-trip, not a strand");
  assert.equal(placeholderVerdict(agoMs(PLACEHOLDER_GRACE_MS - 1), NOW), "in_flight");
});

test("a placeholder older than the grace window is stranded", () => {
  assert.equal(placeholderVerdict(agoMs(PLACEHOLDER_GRACE_MS + 1), NOW), "stranded");
  assert.equal(placeholderVerdict(agoMs(60 * 60 * 1000), NOW), "stranded", "an hour old is what [MOLLIE-C7] was for");
});

test("exactly at the boundary it is still in flight", () => {
  // The boundary belongs to the safe side. One is a customer told to try again in half a minute;
  // the other is a paid invoice that nobody books.
  assert.equal(placeholderVerdict(agoMs(PLACEHOLDER_GRACE_MS), NOW), "in_flight");
});

test("a row we cannot date is in flight — not knowing its age is no reason to delete it", () => {
  for (const bad of [null, undefined, "", "gisteren", 12345, {}, NaN]) {
    assert.equal(placeholderVerdict(bad, NOW), "in_flight", `${String(bad)} must not read as stranded`);
  }
});

test("a timestamp in the future is not stranded either", () => {
  // Clock skew between the database (created_at defaults to now() there) and the server would
  // otherwise produce a negative age. Negative is not "old".
  assert.equal(placeholderVerdict(new Date(NOW.getTime() + 30_000).toISOString(), NOW), "in_flight");
});

test("a Date instance reads the same as its ISO string", () => {
  const d = new Date(NOW.getTime() - 10_000);
  assert.equal(placeholderVerdict(d, NOW), placeholderVerdict(d.toISOString(), NOW));
});

test("the grace window is generously longer than any Mollie call", () => {
  // createMolliePaymentLink has no timeout of its own, so what bounds it is the platform's request
  // timeout. A window shorter than that would delete a row a customer is still attached to.
  assert.ok(PLACEHOLDER_GRACE_MS >= 60_000, "under a minute is inside the range a hosted request can take");
});
