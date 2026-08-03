// [BELOFTE-EN] The English promise may never outrun the Dutch one.
// Run: npx tsx --test src/lib/belofte-en.test.ts
//
// belofte-en.ts is a TRANSLATION of belofte.ts, not a second opinion. Two files that must move
// together is the cheapest arrangement for two pages — but "must move together" is a rule, and
// an unenforced rule is a wish. These are the parts where drift would cost something real.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BELOFTE_STAPPEN, BELOFTE_GERUST } from "./belofte";
import {
  PROMISE_STEPS,
  PROMISE_REASSURE,
  PROMISE_HEAD,
  PROMISE_HEAD_2,
  PROMISE_EXPLAIN,
  PROMISE_OTHER_LANGUAGES,
} from "./belofte-en";

test("the same number of steps — a step added in one language must land in both", () => {
  // The steps are "the only task you have left". Three in Dutch and two in English would mean
  // the English reader is told they have less to do than they actually have.
  assert.equal(PROMISE_STEPS.length, BELOFTE_STAPPEN.length);
});

test("the reassurance carries the same THREE contractual commitments", () => {
  // BELOFTE_GERUST is not a slogan: free (§5.2), no expiring trial (why trial_ends_at does not
  // exist), never auto-charged (§5.2, commitment 1). The English must promise those three —
  // no softer, and above all no wider.
  assert.equal(BELOFTE_GERUST.split("·").length, 3, "the Dutch line still has three parts");
  assert.equal(PROMISE_REASSURE.split("·").length, 3, "so must the English");
  assert.match(PROMISE_REASSURE, /[Ff]ree/);
  assert.match(PROMISE_REASSURE, /trial/);
  assert.match(PROMISE_REASSURE, /automatically/);
});

test("no promise of a feature the Dutch page does not make", () => {
  // The failure mode of a translated marketing page: it reads better, so it says more. These are
  // the words that would signal a claim the product does not back — "guarantee", a tax return we
  // do not file, an accountant we are not.
  const all = [PROMISE_HEAD, PROMISE_HEAD_2, PROMISE_EXPLAIN, PROMISE_REASSURE,
               ...PROMISE_STEPS.map((s) => `${s.head} ${s.text}`)].join(" ").toLowerCase();
  for (const forbidden of ["guarantee", "we file", "tax advice", "accountant for you", "automatically correct"]) {
    assert.ok(!all.includes(forbidden), `the English promises "${forbidden}", the Dutch does not`);
  }
});

test("readers of neither language are pointed at the browser, not at a half-made page", () => {
  // We do not publish machine-translated Arabic or Turkish and present it as ours. Saying "use
  // your browser" is honest: the reader knows whose translation they are reading.
  assert.match(PROMISE_OTHER_LANGUAGES, /browser/i);
});
