// npx tsx --test src/lib/payable-buckets.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { payableBuckets } from "./payable-buckets";

const today = "2026-09-08";

test("overdue, this week (today + 6) and later are split on the due date", () => {
  const b = payableBuckets([
    { dueDate: "2026-09-07", open: 100 },   // yesterday → verlopen
    { dueDate: "2026-09-08", open: 10 },    // today → deze week
    { dueDate: "2026-09-14", open: 20 },    // today + 6 → deze week
    { dueDate: "2026-09-15", open: 30 },    // today + 7 → later
  ], today);
  assert.deepEqual(b.verlopen, { count: 1, sum: 100 });
  assert.deepEqual(b.dezeWeek, { count: 2, sum: 30 });
  assert.deepEqual(b.later, { count: 1, sum: 30 });
  assert.equal(b.total, 4);
});

test("a creditnota (negative open) and a settled row are not debts and go nowhere", () => {
  const b = payableBuckets([
    { dueDate: "2026-09-01", open: -50 },
    { dueDate: "2026-09-01", open: 0 },
  ], today);
  assert.equal(b.total, 0);
  assert.equal(b.verlopen.count, 0);
});

test("a debt without a due date is counted, apart — never silently dropped", () => {
  const b = payableBuckets([{ dueDate: null, open: 12.345 }], today);
  assert.deepEqual(b.zonderDatum, { count: 1, sum: 12.35 });
});

test("sums are rounded after adding, not per row", () => {
  const b = payableBuckets([{ dueDate: "2026-01-01", open: 0.005 }, { dueDate: "2026-01-01", open: 0.005 }], today);
  assert.equal(b.verlopen.sum, 0.01);
});
