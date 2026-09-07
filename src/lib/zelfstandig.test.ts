// [ZIEL] Run: npx tsx --test src/lib/zelfstandig.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { selfShare, SELF_ACTIONS, HAND_ACTIONS } from "./zelfstandig";

test("[ZIEL] the share is self over everything booked, and a share of nothing is null — never 0%, never 100%", () => {
  assert.deepEqual(selfShare({ self: 42, hand: 5, waiting: 3 }), { share: 42 / 47, self: 42, total: 47, waiting: 3 });
  assert.equal(selfShare({ self: 0, hand: 0, waiting: 2 }).share, null);
  assert.equal(selfShare({ self: 0, hand: 4, waiting: 0 }).share, 0);
  assert.equal(selfShare({ self: 4, hand: 0, waiting: 0 }).share, 1);
  assert.equal(selfShare({ self: -1, hand: 2.9, waiting: -3 }).waiting, 0, "garbage in is clamped, not believed");
});

test("[ZIEL] the two action lists never overlap, and neither counts a reversal as work done", () => {
  for (const a of SELF_ACTIONS) assert.ok(!(HAND_ACTIONS as readonly string[]).includes(a), a);
  for (const a of [...SELF_ACTIONS, ...HAND_ACTIONS]) assert.doesNotMatch(a, /unlink|restored|deleted|dismissed/, a);
});
