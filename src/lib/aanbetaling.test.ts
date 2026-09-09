// npx tsx --test src/lib/aanbetaling.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { depositLines, settlementLines, parseDepositPercent } from "./aanbetaling";
import { computeInvoiceTotals } from "./invoice-totals";

const offerte = {
  invoiceNumber: "O-2026-0003",
  discount: { type: "percent" as const, value: 10 },
  lines: [
    { quantity: 10, unit_price: 100, btw_rate: 21 },                       // 1000 → 900 after 10%
    { quantity: 2, unit_price: 50, btw_rate: 9, discount_type: "amount", discount_value: 20 }, // 80 → 72
  ],
};

test("a deposit is a share of every rate group's net amount, after line and document discounts", () => {
  const lines = depositLines(offerte, 30);
  assert.deepEqual(lines.map((l) => [l.btw_rate, l.unit_price]), [[21, 270], [9, 21.6]]);
  assert.equal(lines[0].description, "Aanbetaling 30% op offerte O-2026-0003 (21% btw)");
  assert.equal(lines[0].quantity, 1);
});

test("the settlement mirrors the issued deposit as credit lines, and the two cancel per rate", () => {
  const deposit = depositLines(offerte, 30);
  const settle = settlementLines([{ invoiceNumber: "F-2026-0010", lines: deposit }]);
  assert.deepEqual(settle.map((l) => [l.btw_rate, l.quantity, l.unit_price]), [[21, -1, 270], [9, -1, 21.6]]);
  assert.match(settle[0].description, /^Verrekening aanbetaling F-2026-0010/);
  const together = computeInvoiceTotals([...deposit, ...settle]);
  assert.deepEqual(together, { total_ex_btw: 0, btw_amount: 0, total_inc_btw: 0 });
});

test("a settlement reads the stored line_total when the row carries one", () => {
  const settle = settlementLines([{ invoiceNumber: null, lines: [{ line_total: 123.45, btw_rate: 21, quantity: 1, unit_price: 999 }] }]);
  assert.equal(settle[0].unit_price, 123.45);
  assert.equal(settle[0].description, "Verrekening aanbetaling (21% btw)");
});

test("an exempt group keeps its exemption on both documents", () => {
  const dep = depositLines({ invoiceNumber: "O-1", discount: null, lines: [{ quantity: 1, unit_price: 200, btw_rate: 0, vat_treatment: "exempt" }] }, 50);
  assert.deepEqual(dep, [{ description: "Aanbetaling 50% op offerte O-1 (vrijgesteld)", quantity: 1, unit_price: 100, btw_rate: 0, vat_treatment: "exempt" }]);
  assert.equal(settlementLines([{ invoiceNumber: "F-1", lines: dep }])[0].vat_treatment, "exempt");
});

test("the percentage is a whole number from 1 to 99", () => {
  assert.equal(parseDepositPercent("30"), 30);
  assert.equal(parseDepositPercent(" 50% "), 50);
  assert.equal(parseDepositPercent("0"), null);
  assert.equal(parseDepositPercent("100"), null);
  assert.equal(parseDepositPercent("12,5"), null);
  assert.equal(parseDepositPercent(""), null);
});
