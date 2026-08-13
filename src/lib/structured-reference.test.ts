// [GESTRUCTUREERD] Pure node test — run: npx tsx --test src/lib/structured-reference.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidRfReference,
  isValidBelgianReference,
  structuredReferences,
  structuredReferenceMatches,
} from "./structured-reference";

// ─── The checksums ──────────────────────────────────────────────────────────────────────────────

test("[GESTRUCTUREERD] an ISO 11649 reference is recognised however it is printed", () => {
  // Banks print it in groups of four; an invoice stores it however the supplier typed it.
  for (const form of ["RF18539007547034", "RF18 5390 0754 7034", "rf18539007547034", "RF18-5390-0754-7034"]) {
    assert.equal(isValidRfReference(form), true, form);
  }
  // A short one is just as valid — the standard allows 1..21 characters after the check digits.
  assert.equal(isValidRfReference("RF712348231"), true);
});

test("[GESTRUCTUREERD] one wrong character and it is not a reference at all", () => {
  // That is the whole point of a check digit, and the reason matching on one is safe.
  assert.equal(isValidRfReference("RF19539007547034"), false, "check digits changed");
  assert.equal(isValidRfReference("RF18539007547035"), false, "last digit changed");
  assert.equal(isValidRfReference("RF1853900754703"), false, "one character short");
  assert.equal(isValidRfReference("2026-0044"), false, "an ordinary invoice number");
  assert.equal(isValidRfReference(""), false);
  assert.equal(isValidRfReference(null), false);
});

test("[GESTRUCTUREERD] a Belgian gestructureerde mededeling, in each of its three forms", () => {
  for (const form of ["+++090/9337/55493+++", "090/9337/55493", "090933755493", "***090/9337/55493***"]) {
    assert.equal(isValidBelgianReference(form), true, form);
  }
  assert.equal(isValidBelgianReference("+++090/9337/55494+++"), false, "check digits wrong");
  assert.equal(isValidBelgianReference("12345678901"), false, "eleven digits is not the format");
});

test("[GESTRUCTUREERD] the 0 → 97 rule, which exists so a check can never read as an empty field", () => {
  // 970000000000 mod 97 is 0, so the check digits are written 97 rather than 00.
  assert.equal(970000000000 % 97, 0);
  assert.equal(isValidBelgianReference("000000000097"), true, "remainder 0 is written as 97");
  assert.equal(isValidBelgianReference("000000000000"), false, "…and never as 00");
});

// ─── Reading them out of a real statement line ──────────────────────────────────────────────────

test("[GESTRUCTUREERD] the reference is found with words on both sides of it", () => {
  // The shape that failed: a greedy pattern swallows "TNV" as one more group of four, the
  // candidate is too long, the checksum fails, and the reference the bank printed is not seen.
  const found = structuredReferences("SEPA Overboeking RF18 5390 0754 7034 TNV Groothandel");
  assert.deepEqual(found, [{ kind: "rf", value: "RF18539007547034" }]);
});

test("[GESTRUCTUREERD] junk that merely looks like one is not reported", () => {
  assert.deepEqual(structuredReferences("Order RF99 1234 5678 9012 verzonden"), [], "checksum fails");
  assert.deepEqual(structuredReferences("SURF18539007547034"), [], "not at a word boundary");
  assert.deepEqual(structuredReferences(""), []);
  assert.deepEqual(structuredReferences(null), []);
});

test("[GESTRUCTUREERD] a twelve-digit window inside a longer number is not a mededeling", () => {
  // One digit run in ninety-seven passes the Belgian checksum by luck, so a customer number that
  // happens to contain a valid window must not be read as a payment reference.
  assert.deepEqual(structuredReferences("Klantnummer 9090933755493"), [], "flanked by a digit");
  assert.deepEqual(structuredReferences("Mededeling +++090/9337/55493+++"), [
    { kind: "be", value: "090933755493" },
  ]);
});

test("[GESTRUCTUREERD] several references in one line, each in its own form", () => {
  const found = structuredReferences("RF18539007547034 en +++090/9337/55493+++");
  assert.equal(found.length, 2);
  assert.ok(found.some((f) => f.kind === "rf" && f.value === "RF18539007547034"));
  assert.ok(found.some((f) => f.kind === "be" && f.value === "090933755493"));
});

// ─── Matching a payment to the invoice that asked for it ────────────────────────────────────────

test("[GESTRUCTUREERD] the grouped reference matches the invoice that stores it unspaced", () => {
  // This is the case that was missing, in the place it was missing.
  assert.equal(structuredReferenceMatches("Betaling RF18 5390 0754 7034", "RF18539007547034"), true);
  assert.equal(structuredReferenceMatches("Betaling RF18539007547034", "RF18 5390 0754 7034"), true);
  assert.equal(structuredReferenceMatches("Mededeling +++090/9337/55493+++", "090933755493"), true);
});

test("[GESTRUCTUREERD] a different valid reference is a different invoice", () => {
  // Both are real references; they are not the same one, and no resemblance rule can change that.
  assert.equal(structuredReferenceMatches("Betaling RF18 5390 0754 7034", "RF712348231"), false);
  assert.equal(structuredReferenceMatches("Mededeling +++090/9337/55493+++", "000000000097"), false);
});

test("[GESTRUCTUREERD] an ordinary invoice number is left entirely to the ordinary rules", () => {
  // This module must widen nothing on its own: with no structured reference on either side it has
  // no opinion, and referenceMatches' own scan decides as it always did.
  assert.equal(structuredReferenceMatches("Factuur 2026-0044", "2026-0044"), false);
  assert.equal(structuredReferenceMatches("RF18 5390 0754 7034", "2026-0044"), false);
  assert.equal(structuredReferenceMatches("Factuur 2026-0044", "RF18539007547034"), false);
});
