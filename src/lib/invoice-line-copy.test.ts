// [REGEL-KOPIE] Pure node test — run: npx tsx --test src/lib/invoice-line-copy.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { copiedLineFor, copiedLinesFor, optionalLineFields } from "./invoice-line-copy";
import { computeDraftTotals } from "./draft-totals";

const NEW_ID = "inv-2";

const FULL = {
  description: "Advies",
  quantity: 1,
  unit_price: 100,
  btw_rate: 21,
  line_total: 90,
  unit: "uur",
  vat_treatment: null,
  discount_type: "percent",
  discount_value: 10,
};

test("[REGEL-KOPIE] the discount travels — the column that was dropped by two copiers", () => {
  const copy = copiedLineFor(FULL, NEW_ID);
  assert.equal(copy.discount_type, "percent");
  assert.equal(copy.discount_value, 10);
  assert.equal(copy.line_total, 90, "…beside the amount it produced");
  assert.equal(copy.unit_price, 100, "…and the price that was agreed, not the discounted one");
});

test("[REGEL-KOPIE] what dropping it cost, in the arithmetic that produced it", () => {
  // The copiers write line_total, so a copy LOOKS right until it is opened and saved: the totals
  // are then recomputed from quantity × unit_price, and with no discount to apply the invoice
  // silently becomes the full price. Measured on the real path, not asserted from memory.
  const original = computeDraftTotals([FULL]);
  assert.deepEqual(original, { total_ex_btw: 90, btw_amount: 18.9, total_inc_btw: 108.9 });

  const copy = copiedLineFor(FULL, NEW_ID);
  const resaved = computeDraftTotals([
    { quantity: copy.quantity as number, unit_price: copy.unit_price as number, btw_rate: copy.btw_rate as number,
      discount_type: copy.discount_type as string, discount_value: copy.discount_value as number },
  ]);
  assert.deepEqual(resaved, original, "a copy re-saved must bill exactly what the original billed");

  // …and this is what it billed while the columns were being dropped.
  const withoutDiscount = computeDraftTotals([{ quantity: 1, unit_price: 100, btw_rate: 21 }]);
  assert.deepEqual(withoutDiscount, { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 });
});

test("[REGEL-KOPIE] the unit and the exemption flag travel too, hardened", () => {
  assert.equal(copiedLineFor(FULL, NEW_ID).unit, "uur", "a copied hour is not a copied piece");
  assert.equal(copiedLineFor({ ...FULL, vat_treatment: "exempt" }, NEW_ID).vat_treatment, "exempt");
  for (const junk of ["Exempt", "vrijgesteld", "", "verlegd"]) {
    assert.equal(
      copiedLineFor({ ...FULL, vat_treatment: junk }, NEW_ID).vat_treatment, null,
      `${JSON.stringify(junk)} must never become an exemption`,
    );
  }
});

test("[REGEL-KOPIE] a column this installation does not have stays out of the INSERT", () => {
  // Sending a column the database lacks fails the WHOLE insert with 42703. On the creditnota path
  // that means a correction whose number is already spent, with no lines on it.
  const bare = { description: "Advies", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100 };
  const copy = copiedLineFor(bare, NEW_ID);
  for (const col of ["unit", "vat_treatment", "discount_type", "discount_value"]) {
    assert.equal(col in copy, false, `${col} must be absent when the source row has no such key`);
  }
  // Present-but-null is a column that EXISTS and is empty; that must be copied as such.
  const withNulls = copiedLineFor({ ...bare, unit: null, vat_treatment: null, discount_type: null }, NEW_ID);
  assert.equal("unit" in withNulls, true);
  assert.equal(withNulls.unit, null);
  assert.equal(withNulls.discount_type, null);
});

test("[REGEL-KOPIE] a value without a type is not a discount", () => {
  const out = optionalLineFields({ discount_type: null, discount_value: 25 });
  assert.equal(out.discount_type, null);
  assert.equal(out.discount_value, null, "a number nothing reads must not be carried as one");
});

test("[REGEL-KOPIE] a copy carries content, never identity", () => {
  const copy = copiedLineFor({ ...FULL, ...({ id: "line-1", invoice_id: "inv-1" } as object) }, NEW_ID);
  assert.equal("id" in copy, false, "the source line's primary key already exists");
  assert.equal(copy.invoice_id, NEW_ID, "and the destination is the caller's, not the source's");
});

test("[REGEL-KOPIE] a whole invoice copies in order, every line onto the new one", () => {
  const out = copiedLinesFor([FULL, { ...FULL, description: "Tweede", line_total: 45, discount_value: 55 }], NEW_ID);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((l) => l.description), ["Advies", "Tweede"]);
  assert.ok(out.every((l) => l.invoice_id === NEW_ID));
  assert.deepEqual(out.map((l) => l.discount_value), [10, 55]);
});
