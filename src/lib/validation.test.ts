// src/lib/validation.test.ts
// [BOEK-019] Pure unit tests — no app deps.
// Run:  node --experimental-strip-types src/lib/validation.test.ts
//   or: npx tsx src/lib/validation.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateKvk,
  validateBtw,
  validateAndNormalizeBtw,
  normalizeBtw,
  KVK_ERROR,
  BTW_ERROR,
} from "./validation"

test("KVK — valid: exactly 8 digits", () => {
  assert.deepEqual(validateKvk("12345678"), { valid: true });
  assert.deepEqual(validateKvk("  12345678  "), { valid: true }); // trimmed
});

test("KVK — invalid: wrong length / non-digits", () => {
  assert.equal(validateKvk("1234567").valid, false); // 7 digits
  assert.equal(validateKvk("123456789").valid, false); // 9 digits
  assert.equal(validateKvk("1234567a").valid, false); // letter
  assert.equal(validateKvk("12 345678").valid, false); // inner space
  assert.equal(validateKvk("1234567").error, KVK_ERROR);
});

test("KVK — empty / null is valid (optional field)", () => {
  assert.deepEqual(validateKvk(""), { valid: true });
  assert.deepEqual(validateKvk("   "), { valid: true });
  assert.deepEqual(validateKvk(null), { valid: true });
  assert.deepEqual(validateKvk(undefined), { valid: true });
});

test("BTW — valid: NL + 9 digits + B + 2 digits", () => {
  assert.deepEqual(validateBtw("NL123456789B01"), { valid: true });
  assert.deepEqual(validateBtw("nl123456789b01"), { valid: true }); // case tolerant
  assert.deepEqual(validateBtw(" NL123456789B01 "), { valid: true }); // trimmed
});

test("BTW — invalid: wrong shape", () => {
  assert.equal(validateBtw("123456789B01").valid, false); // missing NL
  assert.equal(validateBtw("NL12345678B01").valid, false); // 8 digits
  assert.equal(validateBtw("NL123456789B1").valid, false); // 1 trailing digit
  assert.equal(validateBtw("NL123456789X01").valid, false); // X not B
  assert.equal(validateBtw("NL123456789B01").error, undefined);
  assert.equal(validateBtw("123456789B01").error, BTW_ERROR);
});

test("BTW — empty / null is valid (optional field)", () => {
  assert.deepEqual(validateBtw(""), { valid: true });
  assert.deepEqual(validateBtw(null), { valid: true });
  assert.deepEqual(validateBtw(undefined), { valid: true });
});

test("normalizeBtw — canonical form for storage", () => {
  assert.equal(normalizeBtw(" nl 123456789 b01 "), "NL123456789B01");
  assert.equal(normalizeBtw(null), "");
});

test("validateAndNormalizeBtw — valid returns canonical normalized value", () => {
  assert.deepEqual(validateAndNormalizeBtw("nl123456789b01"), {
    valid: true,
    normalized: "NL123456789B01",
  });
  assert.deepEqual(validateAndNormalizeBtw(" NL123456789B01 "), {
    valid: true,
    normalized: "NL123456789B01",
  });
});

test("validateAndNormalizeBtw — empty is valid, no normalized (store null)", () => {
  assert.deepEqual(validateAndNormalizeBtw(""), { valid: true });
  assert.deepEqual(validateAndNormalizeBtw(null), { valid: true });
  assert.equal(validateAndNormalizeBtw("   ").normalized, undefined);
});

test("validateAndNormalizeBtw — invalid returns error, no normalized", () => {
  const r = validateAndNormalizeBtw("NL12345678B01"); // 8 digits
  assert.equal(r.valid, false);
  assert.equal(r.error, BTW_ERROR);
  assert.equal(r.normalized, undefined);
});