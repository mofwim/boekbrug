// [CREDIT-SIGN] Pure node test — run: npx tsx --test src/lib/creditnota-lines.test.ts
//
// The mirror sat inline in /api/invoice/creditnota as an object literal inside a .map(), so every
// rule it applies was uncheckable without a database — including the two whose failure is silent
// (the exemption flag landing in the wrong aangifte rubriek, and the unit turning "-2 uur" into
// "-2 stuks" on the document the customer books from).

import test from "node:test";
import assert from "node:assert/strict";

import { creditLineFor, creditLinesFor, CREDIT_PREFIX } from "./creditnota-lines";

const CN = "cn-1";

test("[CREDIT-SIGN] the quantity and the line total flip, and the price does not", () => {
  const out = creditLineFor({ description: "Advies", quantity: 2, unit_price: 75, btw_rate: 21, line_total: 150 }, CN);
  assert.equal(out.quantity, -2);
  assert.equal(out.line_total, -150);
  // [MIN-REGEL] "-2 uur at EUR 75" is what happened. A negative unit price is also the one form an
  // e-factuur may not carry (EN 16931 BR-27), so flipping it here would break the export too.
  assert.equal(out.unit_price, 75);
  assert.equal(out.btw_rate, 21);
  assert.equal(out.invoice_id, CN);
});

test("[CREDIT-SIGN] a credit line inside the invoice mirrors back to a delivery", () => {
  // [MIN-REGEL] The ATAPACK case, credited in full. The invoice had a return on it (-3 x 23,95);
  // taking the whole invoice back un-returns that too, or the creditnota would not cancel it.
  const out = creditLineFor({ description: "Retour", quantity: -3, unit_price: 23.95, btw_rate: 21, line_total: -71.85 }, CN);
  assert.equal(out.quantity, 3, "the mirror of a credit line is a positive one");
  assert.equal(out.line_total, 71.85);
  assert.equal(out.unit_price, 23.95, "and the price is still the price");
});

test("[CREDIT-SIGN] the unit travels, so a corrected hour is not a corrected piece", () => {
  const out = creditLineFor({ description: "Werk", quantity: 2, unit_price: 75, btw_rate: 21, line_total: 150, unit: "uur" }, CN);
  assert.equal(out.unit, "uur");
});

test("[CREDIT-SIGN] a column this installation does not have stays absent", () => {
  // Writing `unit: null` on a database without that column fails the whole INSERT with 42703 — and
  // the creditnota's number is already consumed, so it would exist with no lines at all.
  const out = creditLineFor({ description: "Werk", quantity: 1, unit_price: 10, btw_rate: 21, line_total: 10 }, CN);
  assert.equal("unit" in out, false, "no unit on the source row ⇒ no unit in the copy");
  assert.equal("vat_treatment" in out, false);
  // Present-but-null is a column that EXISTS and is empty, and that must be copied as such.
  const withNull = creditLineFor({ description: "W", quantity: 1, unit_price: 10, btw_rate: 21, line_total: 10, unit: null }, CN);
  assert.equal("unit" in withNull, true);
  assert.equal(withNull.unit, null);
});

test("[CREDIT-SIGN] only the literal 'exempt' is an exemption", () => {
  // Without the flag a copied exempt line is booked as TAXED turnover at 0%: the original stays
  // +EUR 1.000 exempt and the credit lands as -EUR 1.000 in the 0%/verlegd rubriek. Two rubrieken
  // wrong in opposite directions, while 5a/5b still reconcile — so no screen shows it.
  const exempt = creditLineFor({ description: "Fysio", quantity: 1, unit_price: 900, btw_rate: 0, line_total: 900, vat_treatment: "exempt" }, CN);
  assert.equal(exempt.vat_treatment, "exempt");
  for (const junk of ["Exempt", "vrijgesteld", "", "verlegd", null]) {
    const out = creditLineFor({ description: "X", quantity: 1, unit_price: 1, btw_rate: 0, line_total: 1, vat_treatment: junk }, CN);
    assert.equal(out.vat_treatment, null, `${JSON.stringify(junk)} must never become an exemption`);
  }
});

test("[CREDIT-SIGN] the description says what the document is, and the reason when there is one", () => {
  assert.equal(
    creditLineFor({ description: "Advies", quantity: 1, unit_price: 1, btw_rate: 21, line_total: 1 }, CN).description,
    `${CREDIT_PREFIX}Advies`,
  );
  assert.equal(
    creditLineFor({ description: "Advies", quantity: 1, unit_price: 1, btw_rate: 21, line_total: 1 }, CN, "verkeerd tarief").description,
    `${CREDIT_PREFIX}Advies — verkeerd tarief`,
  );
  // A reason of only spaces used to print a dash with nothing after it on the customer's document.
  assert.equal(
    creditLineFor({ description: "Advies", quantity: 1, unit_price: 1, btw_rate: 21, line_total: 1 }, CN, "   ").description,
    `${CREDIT_PREFIX}Advies`,
  );
  // And a line with no description printed the word "null" on a legal document.
  assert.equal(
    creditLineFor({ description: null, quantity: 1, unit_price: 1, btw_rate: 21, line_total: 1 }, CN).description,
    CREDIT_PREFIX,
  );
});

test("[CREDIT-SIGN] a missing amount becomes 0, never NaN", () => {
  // -(undefined) is NaN, and a NaN line_total reaches the header, the PDF and the aangifte without
  // anything refusing it on the way.
  const out = creditLineFor({ description: "Leeg" }, CN);
  assert.equal(out.quantity, 0);
  assert.equal(out.line_total, 0);
  assert.equal(Number.isNaN(out.quantity), false);
  assert.equal(Number.isNaN(out.line_total), false);
  // And not NEGATIVE zero, which is what -(0) gives. assert.equal uses Object.is, so this is the
  // assertion above and not a second one — but the reason is worth naming: Intl formats -0 as
  // "€ -0,00", so the line would print a minus in front of nothing on the customer's document.
  assert.equal(Object.is(out.line_total, -0), false, "-0 reaches the PDF as € -0,00");
  assert.equal(Object.is(out.quantity, -0), false);
  // A real amount still flips, or the guard above would have eaten the feature.
  assert.equal(creditLineFor({ description: "X", quantity: 2, line_total: 150 }, CN).line_total, -150);
});

test("[CREDIT-SIGN] the whole set keeps its order and its identity", () => {
  const out = creditLinesFor(
    [
      { description: "Een", quantity: 1, unit_price: 10, btw_rate: 21, line_total: 10 },
      { description: "Twee", quantity: 2, unit_price: 20, btw_rate: 9, line_total: 40 },
    ],
    CN,
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((l) => l.description), [`${CREDIT_PREFIX}Een`, `${CREDIT_PREFIX}Twee`]);
  assert.deepEqual(out.map((l) => l.line_total), [-10, -40]);
  assert.ok(out.every((l) => l.invoice_id === CN));
});

// ─── [REGEL-KORTING] The discount has to come along ───────────────────────────

test("[REGEL-KORTING] the line's own discount travels unflipped", () => {
  // A percentage is not a total: the mirror of "20% off" is "20% off", not "-20% off".
  const [out] = creditLinesFor(
    [{ description: "Aanbieding", quantity: 10, unit_price: 12.5, btw_rate: 21, line_total: 100,
       discount_type: "percent", discount_value: 20 }],
    CN,
  );
  assert.equal(out.quantity, -10);
  assert.equal(out.line_total, -100, "the NET amount is what flips");
  assert.equal(out.unit_price, 12.5, "the price is a price — BR-27");
  assert.equal(out.discount_type, "percent");
  assert.equal(out.discount_value, 20);
});

test("[REGEL-KORTING] without the discount the credit note's e-factuur would not add up", () => {
  // This is why the columns are carried rather than dropped as decoration. line_total is NET and
  // it HAS been flipped, so a credit line without them says -10 x EUR 12,50 = EUR -100. The
  // receiving access point redoes exactly that multiplication (PEPPOL-EN16931-R120), gets -125,
  // and refuses the file — while the PDF looks perfect.
  const [out] = creditLinesFor(
    [{ description: "Aanbieding", quantity: 10, unit_price: 12.5, btw_rate: 21, line_total: 100,
       discount_type: "percent", discount_value: 20 }],
    CN,
  );
  const bruto = Number(out.quantity) * Number(out.unit_price);
  assert.notEqual(bruto, out.line_total, "gross and net differ — something must explain the gap");
  assert.ok(out.discount_type, "…and that something is on the line");
});

test("[REGEL-KORTING] a source row without the columns produces a copy without them", () => {
  // Same rule as `unit` and the exemption flag: a column the database does not have must not
  // appear in the INSERT, or the creditnota loses its lines after its number is already spent.
  const [out] = creditLinesFor([{ description: "Werk", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100 }], CN);
  assert.ok(!("discount_type" in out), "absent from the source is absent from the copy");
  assert.ok(!("discount_value" in out));
});

test("[REGEL-KORTING] a value without a type is not a discount", () => {
  const [out] = creditLinesFor(
    [{ description: "Werk", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100,
       discount_type: null, discount_value: 20 }],
    CN,
  );
  assert.equal(out.discount_type, null);
  assert.equal(out.discount_value, null, "a stray value must not become a discount on the copy");
});
