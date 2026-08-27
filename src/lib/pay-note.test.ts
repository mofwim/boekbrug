// [BETAALNOTITIE] Pure node test — run: npx tsx --test src/lib/pay-note.test.ts
//
// The reported case: paying Enka Horeca B.V. in instalments, the owner wants the payment to say
// which instalment it is. The reference must survive that untouched.

import { test } from "node:test";
import assert from "node:assert/strict";

import { planPayNote, NOTE_SEPARATOR } from "./pay-note";
import { EPC_REMITTANCE_MAX } from "./epc-qr";

test("[BETAALNOTITIE] the note is appended, and the reference comes through untouched", () => {
  const p = planPayNote("26710525", "termijn 1 van 2");
  assert.equal(p.allowed, true);
  assert.equal(p.error, undefined);
  assert.equal(p.remittance, `26710525${NOTE_SEPARATOR}termijn 1 van 2`);
  assert.ok(p.remittance.startsWith("26710525"), "the supplier's reference must come first");
});

test("[BETAALNOTITIE] no note means the remittance is exactly what it was before", () => {
  // The whole feature must be invisible to someone who does not use it.
  for (const typed of ["", "   ", null, undefined]) {
    const p = planPayNote("26710525 / 20260012", typed);
    assert.equal(p.remittance, "26710525 / 20260012", `"${typed}" changed the remittance`);
    assert.equal(p.allowed, true);
  }
});

test("[BETAALNOTITIE] a structured reference takes no passengers", () => {
  // structured-reference.ts: such a payment "is matched on that reference and on nothing else,
  // because the reference carries its own checksum". Words beside it are how it stops matching.
  const rf = planPayNote("RF18539007547034", "termijn 1 van 2");
  assert.equal(rf.allowed, false, "an ISO 11649 reference accepted a note");
  assert.match(rf.blocked!, /gestructureerd/);
  assert.equal(rf.remittance, "RF18539007547034", "…and the reference is passed through unchanged");

  // The Belgian form, which a zzp'er with Belgian suppliers sees constantly.
  const be = planPayNote("+++090/9337/55493+++", "eerste deel");
  assert.equal(be.allowed, false, "a Belgian structured reference accepted a note");

  // …and an ordinary number that merely LOOKS like one is not blocked: a failed checksum means it
  // is not a structured reference at all, which is the whole point of checking rather than guessing.
  assert.equal(planPayNote("RF99123456789", "eerste deel").allowed, true);
});

test("[BETAALNOTITIE] the limit is measured on the FINAL string, and refuses out loud", () => {
  const ref = "26710525";
  const budget = EPC_REMITTANCE_MAX - ref.length - NOTE_SEPARATOR.length;

  // Exactly fitting is fine, and the result is exactly at the spec limit.
  const fits = planPayNote(ref, "x".repeat(budget));
  assert.equal(fits.error, undefined);
  assert.equal(fits.remittance.length, EPC_REMITTANCE_MAX);

  // One over is refused — never trimmed. A silent .slice() is the bug this replaces.
  const over = planPayNote(ref, "x".repeat(budget + 1));
  assert.ok(over.error, "one character too many was accepted");
  assert.match(over.error!, /1 teken te lang/);
  assert.equal(over.remittance, ref, "a refused note must not leave a half-written remittance");

  // Ten over says ten, so the owner knows how much to cut.
  assert.match(planPayNote(ref, "x".repeat(budget + 10)).error!, /10 tekens te lang/);
});

test("[BETAALNOTITIE] a reference that already fills the field offers no note at all", () => {
  const p = planPayNote("x".repeat(EPC_REMITTANCE_MAX), "iets");
  assert.equal(p.allowed, false);
  assert.match(p.blocked!, /geen ruimte/);
  assert.equal(p.budget, 0);
});

test("[BETAALNOTITIE] sanitising happens BEFORE counting, so the counter cannot lie", () => {
  // The EPC payload is newline-delimited: buildEpcQrPayload strips CR/LF. Counting first and
  // stripping later would measure a string that is not the one that gets sent.
  const p = planPayNote("26710525", "  termijn 1\r\nvan 2  ");
  assert.equal(p.note, "termijn 1 van 2", "the note is not the sanitised value");
  assert.equal(p.remittance, `26710525${NOTE_SEPARATOR}termijn 1 van 2`);
  assert.doesNotMatch(p.remittance, /[\r\n]/, "a line break would shift every line of the QR");

  // And the budget is measured against the sanitised REFERENCE too.
  const q = planPayNote("  26710525  ", "x".repeat(EPC_REMITTANCE_MAX - 8 - NOTE_SEPARATOR.length));
  assert.equal(q.error, undefined, "padding around the reference ate the note's budget");
});
