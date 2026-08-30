// [AI-MONEY-GUARDS] The two pure sign/amount guards in ai.ts, under test.
// Run: npx tsx --test src/lib/ai-money-guards.test.ts
//
// ai.ts is 3,000+ lines and has no test file. Almost all of it needs a model to exercise. These
// two functions do not — they are pure arithmetic — and they are the two that decide, from a
// document a machine read, WHAT AMOUNT ENDS UP IN THE BOOKS.
//
//   shouldTreatAsCreditNote   decides whether a negative total survives. Its own comment names
//                             the failure: dropping it "turns a real -1.123,14 credit into an
//                             empty €0 record".
//   fixExInclConfusion        recovers the net base when a supplier mislabels the gross as
//                             "Subtotaal" — and REFUSES to when the implied BTW rate is not a
//                             Dutch one, because the refusal is what stops a reverse-charge memo
//                             from being reconciled into a deductible €210 that does not exist.
//
// The second one is the sharper edge. ai.ts says it out loud: such a fabrication would "make
// SAFECORE's sum check pass" — a claim on the aangifte the Belastingdienst disallows, with a
// naheffing on top. A guard whose whole value is what it REFUSES needs a test that tries.

import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldTreatAsCreditNote, fixExInclConfusion } from "./ai";

// ── shouldTreatAsCreditNote ─────────────────────────────────────────────────

test("[CREDIT-BACKSTOP] a tagged creditnota is one, whatever the amounts say", () => {
  assert.equal(shouldTreatAsCreditNote(true, 100, 80), true);
  assert.equal(shouldTreatAsCreditNote(true, undefined, undefined), true);
});

test("[CREDIT-BACKSTOP] a negative printed total is a credit even when nothing tagged it", () => {
  // The documented real case: an "expondo Factuurcorrectie — Full return" that never writes the
  // word Creditnota. Without this the -1.123,14 is dropped to undefined and booked as €0.
  assert.equal(shouldTreatAsCreditNote(undefined, -1123.14, -928.21), true);
  assert.equal(shouldTreatAsCreditNote(false, -1123.14, undefined), true);
  assert.equal(shouldTreatAsCreditNote(undefined, undefined, -50), true, "a negative ex alone");
});

test("[HUNT-F2] a POSITIVE total is never a creditnota, even with a negative base", () => {
  // The asymmetry is deliberate and it is a money decision. A negative ex under a positive total
  // is an extraction slip — a korting line read into the base — not a credit. Flipping the whole
  // document's sign on that would turn a purchase into a refund.
  assert.equal(shouldTreatAsCreditNote(undefined, 121, -100), false);
  assert.equal(shouldTreatAsCreditNote(false, 0.01, -999), false);
});

test("[CREDIT-BACKSTOP] a normal purchase invoice never trips the backstop", () => {
  assert.equal(shouldTreatAsCreditNote(undefined, 121, 100), false);
  assert.equal(shouldTreatAsCreditNote(false, 121, 100), false);
});

test("[CREDIT-BACKSTOP] nothing readable means no credit is invented", () => {
  // Only real, finite numbers may flip the sign of a booking. A string, a NaN or an Infinity is
  // an unread field, and an unread field is not evidence of a refund.
  for (const bad of [undefined, null, "-100", "", NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(
      shouldTreatAsCreditNote(undefined, bad, bad),
      false,
      `${JSON.stringify(bad)} was accepted as evidence of a credit`,
    );
  }
});

test("[CREDIT-BACKSTOP] a zero total is not a credit", () => {
  assert.equal(shouldTreatAsCreditNote(undefined, 0, 0), false);
  assert.equal(shouldTreatAsCreditNote(undefined, 0, undefined), false);
});

// ── fixExInclConfusion ──────────────────────────────────────────────────────

test("[EX-INCL-FIX] the gross mislabelled as Subtotaal is recovered at 21% and at 9%", () => {
  assert.equal(fixExInclConfusion(121, 21, 121), 100, "21% not recovered");
  assert.equal(fixExInclConfusion(109, 9, 109), 100, "9% not recovered");
});

test("[EX-INCL-FIX] it is sign-safe on a creditnota", () => {
  // All three negative: the recovered base must stay negative, or a refund becomes a purchase.
  assert.equal(fixExInclConfusion(-121, -21, -121), -100);
});

test("[HUNT-F1] a reverse-charge memo is REFUSED, not reconciled", () => {
  // ex=1000, btw=210, incl=1000 is "BTW verlegd" captured into btw_amount. Recomputing would give
  // ex=790 and an implied rate of 27% — not a Dutch rate. Accepting it would fabricate €210 of
  // deductible BTW AND satisfy SAFECORE's sum check, so nothing downstream would object.
  //
  // The refusal leaves ex untouched so the document is held for a human instead.
  assert.equal(fixExInclConfusion(1000, 210, 1000), 1000, "a fabricated deductible BTW got through");
});

test("[HUNT-F1] anything above the Dutch top rate is refused", () => {
  // The band is 0–21. A 25% or 50% implied rate is not a rate this country has, so it is evidence
  // the btw field holds something that is not BTW.
  assert.equal(fixExInclConfusion(400, 100, 400), 400, "an implied 33% was accepted");
  assert.equal(fixExInclConfusion(200, 100, 200), 200, "an implied 100% was accepted");
});

test("[EX-INCL-FIX] it only fires on the exact contradiction it was written for", () => {
  // "It fires ONLY on that exact contradiction (ex ≈ incl with |btw| > 0), so it can never mask a
  // genuine mismatch." A genuine mismatch must reach SAFECORE untouched.
  assert.equal(fixExInclConfusion(100, 21, 121), 100, "a correct invoice was rewritten");
  assert.equal(fixExInclConfusion(121, 0, 121), 121, "fired with no BTW to explain the gap");
  assert.equal(fixExInclConfusion(121, 0.01, 121), 121, "fired on a rounding-sized BTW");
  assert.equal(fixExInclConfusion(90, 21, 121), 90, "fired on a genuine ex/incl mismatch");
});

test("[EX-INCL-FIX] a missing field leaves the base exactly as it was", () => {
  assert.equal(fixExInclConfusion(undefined, 21, 121), undefined);
  assert.equal(fixExInclConfusion(121, undefined, 121), 121);
  assert.equal(fixExInclConfusion(121, 21, undefined), 121);
});
