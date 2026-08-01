// [CREDITNOTA-SIGNAL] Pure node test — run: npx tsx --test src/lib/creditnota-signal.test.ts
//
// Two sides, and the second one matters most:
//   1. the real case is recognised (CR next to RE from the same supplier);
//   2. the signal stays QUIET on everything that merely resembles it. A false signal sends the
//      owner to an invoice they DO have to pay, and flipping that one produces a dunning letter.
//      Silence is the safe side here, which is what most of these tests are about.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  numberPrefix, looksLikeCreditnota, creditnotaSignalText, creditnotaSignConflict,
} from "./creditnota-signal";

/** The real case: this wholesaler sends CR credit notes alongside RE invoices. */
const WHOLESALER = ["CR0300343", "CR0300510", "RE0801378"];

const check = (over: Partial<Parameters<typeof looksLikeCreditnota>[0]> = {}) =>
  looksLikeCreditnota({
    invoiceNumber: "CR0300343",
    totalIncBtw: 51.8,
    invoiceType: "factuur",
    vendorNumbers: WHOLESALER,
    ...over,
  });

test("[CONTRADICTION] a credit note with a POSITIVE amount is not a suspicion but an error", () => {
  // The reader already established the kind; there is nothing to guess. The money points the wrong
  // way: it counts toward "still to pay" and its input tax is added instead of subtracted.
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: 51.8 }), true);
  // The correct state reports nothing.
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: -51.8 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: 0 }), false);
  // And an ordinary invoice falls outside this by definition — it is supposed to be positive.
  assert.equal(creditnotaSignConflict({ invoiceType: "factuur", totalIncBtw: 871.4 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: null, totalIncBtw: 871.4 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: Number.NaN }), false);
});

test("the prefix is the leading letters, and nothing else", () => {
  assert.equal(numberPrefix("CR0300343"), "CR");
  assert.equal(numberPrefix("RE0801378"), "RE");
  assert.equal(numberPrefix("2033161"), "", "a purely numeric number has no prefix");
  assert.equal(numberPrefix("cr-123"), "CR", "lowercase counts just the same");
  assert.equal(numberPrefix("  CN 99 "), "CN");
  assert.equal(numberPrefix(null), "");
  assert.equal(numberPrefix(""), "");
  assert.equal(numberPrefix("F2033161"), "F");
});

test("the real case is recognised", () => {
  const s = check();
  assert.equal(s.suspected, true);
  assert.equal(s.prefix, "CR");
  assert.equal(s.contrastPrefix, "RE");
  // And the explanation names both prefixes, so the owner can check what we saw.
  const text = creditnotaSignalText(s);
  assert.ok(text && text.includes("CR") && text.includes("RE"), text ?? "");
});

test("an already correctly booked credit note gives NO signal", () => {
  // This is the desired end state — no warning belongs on it.
  assert.equal(check({ invoiceType: "creditnota" }).suspected, false);
});

test("an already negative stored amount gives NO signal", () => {
  // The money already points the right way: it comes off the balance. This signal is about money
  // pointing the wrong way, not about labelling.
  assert.equal(check({ totalIncBtw: -51.8 }).suspected, false);
  assert.equal(check({ totalIncBtw: 0 }).suspected, false);
});

test("[QUIET] an unknown prefix stays silent", () => {
  // "F", "INV", "KR" — we do not know what those mean, so we say nothing.
  for (const nr of ["F0300343", "INV0300343", "KR0300343", "2033161"]) {
    assert.equal(check({ invoiceNumber: nr }).suspected, false, nr);
  }
});

test("[QUIET] without a counterpart from the same supplier the signal stays silent", () => {
  // This is the second requirement, and the important one: the evidence comes from the supplier
  // itself, not from our assumption about two letters. If everything is CR, then CR says nothing.
  assert.equal(check({ vendorNumbers: ["CR0300343", "CR0300510", "CR0300777"] }).suspected, false);
  assert.equal(check({ vendorNumbers: ["CR0300343"] }).suspected, false, "only itself is no evidence");
  assert.equal(check({ vendorNumbers: [] }).suspected, false);
  // Numberless documents from the same supplier do not count as a counterpart.
  assert.equal(check({ vendorNumbers: ["CR0300343", null, "", "   "] }).suspected, false);
  // Nor does a purely numeric number — it has no prefix. Otherwise every supplier who once sends a
  // letterless number would suddenly "have" a counterpart.
  assert.equal(check({ vendorNumbers: ["CR0300343", "2033161"] }).suspected, false);
});

test("the other known credit markers work too", () => {
  for (const nr of ["CN0001", "CRN0001", "CRED0001", "CREDIT0001", "CRE0001"]) {
    assert.equal(
      check({ invoiceNumber: nr, vendorNumbers: [nr, "RE0801378"] }).suspected,
      true,
      nr,
    );
  }
});

test("nonsense does not get through", () => {
  assert.equal(check({ invoiceNumber: null }).suspected, false);
  assert.equal(check({ totalIncBtw: null }).suspected, false);
  assert.equal(check({ totalIncBtw: Number.NaN }).suspected, false);
  assert.equal(check({ totalIncBtw: Number.POSITIVE_INFINITY }).suspected, false);
  assert.equal(creditnotaSignalText({ suspected: false, prefix: "", contrastPrefix: null }), null);
});

test("the whole list from the screenshot yields exactly two signals", () => {
  // Three documents from one supplier, all three booked positive as 'factuur'. The two CR numbers
  // should stand out; the RE invoice should be left alone.
  const rows = [
    { invoiceNumber: "CR0300343", totalIncBtw: 51.8 },
    { invoiceNumber: "CR0300510", totalIncBtw: 24.25 },
    { invoiceNumber: "RE0801378", totalIncBtw: 871.4 },
  ];
  const flagged = rows.filter(
    (r) => looksLikeCreditnota({ ...r, invoiceType: "factuur", vendorNumbers: WHOLESALER }).suspected,
  );
  assert.deepEqual(flagged.map((r) => r.invoiceNumber), ["CR0300343", "CR0300510"]);
  // And what is wrongly sitting in "still to pay" is the sum of those two.
  assert.equal(Math.round(flagged.reduce((s, r) => s + r.totalIncBtw, 0) * 100) / 100, 76.05);
});
