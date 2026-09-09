// npx tsx --test src/lib/aanbetaling.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { depositLines, settlementLines, discountLines, parseDepositPercent } from "./aanbetaling";
import { computeInvoiceTotals, round2 } from "./invoice-totals";
import { applyDiscount, lineNetEx, type DiscountLine } from "./invoice-discount";

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

// ─── [AANBETALING-KORTING] deposit + final invoice = the offerte, with a document discount ────
//
// Measured before discountLines existed: the final invoice carried the offerte's 10% as a HEADER
// discount next to the settlement lines, so the deposit — computed from the discounted amount —
// was discounted again. EUR 47,39 too much on this offerte; pct × deposit in general.
const gemengd = {
  invoiceNumber: "O-2026-0007",
  discount: { type: "percent" as const, value: 10 },
  lines: [{ quantity: 1, unit_price: 1000, btw_rate: 21 }, { quantity: 1, unit_price: 500, btw_rate: 9 }],
};
/** What the server stores per line: the rounded net, so totals read it instead of q × p. */
const stored = (ls: DiscountLine[]) => ls.map((l) => ({ ...l, line_total: lineNetEx(l) }));

test("[AANBETALING-KORTING] the discount travels as one credit line per rate, worth exactly the allowance", () => {
  const korting = discountLines(gemengd);
  assert.deepEqual(korting.map((l) => [l.btw_rate, l.quantity, l.unit_price]), [[21, -1, 100], [9, -1, 50]]);
  assert.equal(korting[0].description, "Korting (10%) op offerte O-2026-0007 (21% btw)");
  assert.deepEqual(discountLines({ ...gemengd, discount: null }), [], "no discount, no lines");
});

test("[AANBETALING-KORTING] deposit + final invoice = the offerte, to the cent, in every rate", () => {
  const agreed = applyDiscount(stored(gemengd.lines), gemengd.discount);
  const deposit = depositLines(gemengd, 30);
  const settle = settlementLines([{ invoiceNumber: "F-1", lines: deposit }]);
  const a = computeInvoiceTotals(stored(deposit));
  const b = computeInvoiceTotals(stored([...gemengd.lines, ...discountLines(gemengd), ...settle]));
  assert.deepEqual(a, { total_ex_btw: 405, btw_amount: 68.85, total_inc_btw: 473.85 });
  assert.deepEqual(b, { total_ex_btw: 945, btw_amount: 160.65, total_inc_btw: 1105.65 });
  assert.equal(round2(a.total_ex_btw + b.total_ex_btw), agreed.total_ex_btw);
  assert.equal(round2(a.btw_amount + b.btw_amount), agreed.btw_amount);
  assert.equal(round2(a.total_inc_btw + b.total_inc_btw), agreed.total_inc_btw);
  // The shape this replaces: the header discount over lines that already hold the settlement.
  const oud = applyDiscount(stored([...gemengd.lines, ...settle]), gemengd.discount);
  assert.equal(round2(a.total_inc_btw + oud.total_inc_btw - agreed.total_inc_btw), 47.39, "the measured over-charge");
});

test("[AANBETALING-KORTING] a line discount stays on its line; only the document discount becomes lines", () => {
  const korting = discountLines(offerte);
  assert.deepEqual(korting.map((l) => [l.btw_rate, l.unit_price]), [[21, 100], [9, 8]]);
  const deposit = depositLines(offerte, 30);
  const settle = settlementLines([{ invoiceNumber: "F-2", lines: deposit }]);
  const agreed = applyDiscount(stored(offerte.lines), offerte.discount);
  const a = computeInvoiceTotals(stored(deposit));
  const b = computeInvoiceTotals(stored([...offerte.lines, ...korting, ...settle]));
  assert.equal(round2(a.total_ex_btw + b.total_ex_btw), agreed.total_ex_btw);
  assert.equal(round2(a.btw_amount + b.btw_amount), agreed.btw_amount);
  assert.equal(round2(a.total_inc_btw + b.total_inc_btw), agreed.total_inc_btw);
});

test("[AANBETALING-KORTING] an exempt and a taxed 0% group split the rate's allowance, and the cents add up", () => {
  const src = {
    invoiceNumber: null,
    discount: { type: "amount" as const, value: 10.01 },
    lines: [
      { quantity: 1, unit_price: 100, btw_rate: 0, vat_treatment: "exempt" },
      { quantity: 1, unit_price: 50, btw_rate: 0 },
    ],
  };
  const korting = discountLines(src);
  assert.deepEqual(korting.map((l) => [l.vat_treatment, l.unit_price]), [["exempt", 6.67], [null, 3.34]]);
  assert.equal(round2(korting.reduce((s, l) => s + l.unit_price, 0)), 10.01);
  // And the deposit reads the SAME split: 50% of (100 − 6,67) and of (50 − 3,34).
  assert.deepEqual(depositLines(src, 50).map((l) => l.unit_price), [46.67, 23.33]);
});

// ─── [VERLEGD-VERKOOP] A deposit on a verlegde offerte is itself verlegd ──────────────────
test("[VERLEGD-VERKOOP] the treatment travels with the money: deposit, discount and settlement lines keep the flag", () => {
  const src = {
    invoiceNumber: "O-2026-0009",
    discount: { type: "percent" as const, value: 10 },
    lines: [
      { quantity: 40, unit_price: 25, btw_rate: 0, vat_treatment: "reverse_charge" },
      { quantity: 1, unit_price: 200, btw_rate: 21 },
    ],
  };
  const dep = depositLines(src, 30);
  assert.deepEqual(dep.map((l) => [l.btw_rate, l.vat_treatment, l.unit_price, l.description]), [
    [0, "reverse_charge", 270, "Aanbetaling 30% op offerte O-2026-0009 (btw verlegd)"],
    [21, null, 54, "Aanbetaling 30% op offerte O-2026-0009 (21% btw)"],
  ]);
  assert.deepEqual(discountLines(src).map((l) => [l.vat_treatment, l.unit_price]), [["reverse_charge", 100], [null, 20]]);
  assert.deepEqual(settlementLines([{ invoiceNumber: "F-9", lines: dep }]).map((l) => [l.vat_treatment, l.unit_price]),
    [["reverse_charge", 270], [null, 54]]);
  // A verlegd 0% and a plain 0% are two groups, never one.
  const twee = depositLines({ invoiceNumber: null, discount: null, lines: [
    { quantity: 1, unit_price: 100, btw_rate: 0, vat_treatment: "reverse_charge" },
    { quantity: 1, unit_price: 100, btw_rate: 0 },
  ] }, 50);
  assert.deepEqual(twee.map((l) => [l.vat_treatment, l.unit_price]), [["reverse_charge", 50], [null, 50]]);
});
