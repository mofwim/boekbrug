// [BETAALTERMIJN] Run: npx tsx --test src/lib/payment-term.test.ts
//
// The tests that matter are the ones about NOT saying something: no IBAN, no dates, or dates that
// describe no term all produce null. The defect this replaces was a screen asserting "binnen 30
// dagen" with nothing behind it, so the first rule of the replacement is that it stays quiet when
// it does not know.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePaymentTerm,
  dueDateFromTerm,
  termFromDates,
  paymentTermText,
  MAX_PAYMENT_TERM_DAYS,
  DEFAULT_PAYMENT_TERM,
} from "./payment-term";

test("a term the owner typed becomes a whole number of days", () => {
  assert.equal(parsePaymentTerm("45"), 45);
  assert.equal(parsePaymentTerm(45), 45);
  assert.equal(parsePaymentTerm(" 7 "), 7);
  assert.equal(parsePaymentTerm("14,4"), 14, "a stray comma is Dutch decimal input, not a reason to refuse");
});

test("zero days is a real term and is kept", () => {
  // "Betaling bij ontvangst". Refusing it pushes an owner into typing 1, which is a different
  // promise on a document their customer reads.
  assert.equal(parsePaymentTerm(0), 0);
  assert.equal(parsePaymentTerm("0"), 0);
});

test("anything that is not a usable term is null, never a substituted default", () => {
  // The caller shows the field as unset. Quietly substituting 30 is how the old sentence came to
  // state a number nobody had chosen.
  for (const bad of ["", "   ", "abc", null, undefined, NaN, Infinity, -1, "-5"]) {
    assert.equal(parsePaymentTerm(bad), null, `${String(bad)} must not parse`);
  }
});

test("a typo far beyond any real term is refused", () => {
  // 300 instead of 30 puts the due date most of a year out, and every reminder tier then waits
  // that long before chasing money the owner believes is overdue.
  assert.equal(parsePaymentTerm(MAX_PAYMENT_TERM_DAYS), MAX_PAYMENT_TERM_DAYS);
  assert.equal(parsePaymentTerm(MAX_PAYMENT_TERM_DAYS + 1), null);
  assert.equal(parsePaymentTerm(3000), null);
});

test("the due date is the invoice date plus the term", () => {
  assert.equal(dueDateFromTerm("2026-08-08", 30), "2026-09-07");
  assert.equal(dueDateFromTerm("2026-08-08", 0), "2026-08-08");
  // Across a month and a year boundary, both of which plain date arithmetic gets wrong.
  assert.equal(dueDateFromTerm("2026-01-31", 1), "2026-02-01");
  assert.equal(dueDateFromTerm("2026-12-20", 30), "2027-01-19");
});

test("the term is read BACK out of two dates — the direction that was missing", () => {
  assert.equal(termFromDates("2026-08-08", "2026-09-07"), 30);
  assert.equal(termFromDates("2026-08-08", "2026-08-22"), 14);
  assert.equal(termFromDates("2026-08-08", "2026-08-08"), 0);
});

test("a due date BEFORE the invoice date describes no term", () => {
  // "binnen -3 dagen" is not a sentence anyone should read; that is a data problem, said by saying
  // nothing rather than by printing a negative.
  assert.equal(termFromDates("2026-08-08", "2026-08-05"), null);
});

test("the sentence states the REAL term, not a literal", () => {
  const iban = "NL91ABNA0417164300";
  assert.equal(
    paymentTermText({ invoiceDateIso: "2026-08-08", dueDateIso: "2026-08-22", iban }),
    "Gelieve te betalen binnen 14 dagen op",
    "fourteen days must not be announced as thirty — that was the whole defect",
  );
  assert.equal(
    paymentTermText({ invoiceDateIso: "2026-08-08", dueDateIso: "2026-09-07", iban }),
    "Gelieve te betalen binnen 30 dagen op",
  );
});

test("one day and zero days get their own wording", () => {
  const iban = "NL91ABNA0417164300";
  assert.equal(
    paymentTermText({ invoiceDateIso: "2026-08-08", dueDateIso: "2026-08-09", iban }),
    "Gelieve te betalen binnen 1 dag op",
    "'1 dagen' is wrong Dutch on a document a customer reads",
  );
  assert.equal(
    paymentTermText({ invoiceDateIso: "2026-08-08", dueDateIso: "2026-08-08", iban }),
    "Gelieve direct te betalen op",
  );
});

test("with nothing honest to say, it says nothing", () => {
  const ok = { invoiceDateIso: "2026-08-08", dueDateIso: "2026-08-22", iban: "NL91ABNA0417164300" };
  assert.equal(paymentTermText({ ...ok, iban: "" }), null, "no IBAN, no payment sentence");
  assert.equal(paymentTermText({ ...ok, iban: null }), null);
  assert.equal(paymentTermText({ ...ok, dueDateIso: null }), null);
  assert.equal(paymentTermText({ ...ok, invoiceDateIso: "" }), null);
  assert.equal(paymentTermText({ ...ok, dueDateIso: "2026-08-01" }), null, "an impossible term says nothing");
});

test("the default is still thirty — this file did not change what a new invoice starts at", () => {
  assert.equal(DEFAULT_PAYMENT_TERM, 30);
});
