// [PRIJS-KOLOM] Pure node test — run: npx tsx --test src/lib/unit-price-display.test.ts
//
// The property under test is one sentence: whatever price the column shows, quantity times that
// price must be the line total the column also shows. Every case below is a way of breaking it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { unitPriceDecimals, formatUnitPriceNL } from "./unit-price-display";

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
const roundTo = (n: number, d: number) => Math.round(n * 10 ** d + 1e-9) / 10 ** d;

/** The invariant itself: the printed price, multiplied out, is the printed total. */
function reconciles(unitPrice: number, quantity: number, lineTotal: number): boolean {
  const d = unitPriceDecimals(unitPrice, quantity, lineTotal);
  return round2(quantity * roundTo(unitPrice, d)) === round2(lineTotal);
}

test("[PRIJS-KOLOM] an ordinary invoice keeps two decimals and is unchanged", () => {
  // The overwhelming majority of lines. Nothing about them may move.
  assert.equal(unitPriceDecimals(75, 2, 150), 2);
  assert.equal(unitPriceDecimals(33.33, 3, 99.99), 2);
  assert.equal(unitPriceDecimals(0, 1, 0), 2);
  assert.equal(formatUnitPriceNL(75, 2, 150), "€ 75,00");
  assert.equal(formatUnitPriceNL(1250.5, 1, 1250.5), "€ 1.250,50");
});

test("[PRIJS-KOLOM] the four measured lines all multiply out", () => {
  // These are the ones that produced EUR 1,14 of visible nonsense on one document.
  const kiwi: [string, number, number, number][] = [
    ["Worstjes", 0.9 / 1.09, 150, 123.85],
    ["Kip spies", 1.9 / 1.09, 100, 174.31],
    ["Broodjes", 1.75 / 1.09, 38, 61.01],
    ["Sauzen", 1.75 / 1.09, 2, 3.21],
  ];
  for (const [name, price, qty, total] of kiwi) {
    assert.ok(reconciles(price, qty, total), `${name}: the column still does not add up`);
  }
  // And the one from the screenshot, spelled out: not 0,83. Five decimals, because at four
  // 0,8257 x 150 = 123,855 which rounds to 123,86 — a cent the other way.
  assert.equal(formatUnitPriceNL(0.9 / 1.09, 150, 123.85), "€ 0,82569");
});

test("[PRIJS-KOLOM] precision follows the quantity, because the error is multiplied by it", () => {
  // Same price, different quantities. A fixed decimal count is wrong in both directions: noisy on
  // two units and still false on a hundred and fifty.
  const p = 0.9 / 1.09;
  // Even TWO units need a third decimal here, and that surprised me when this test first ran:
  // 0,83 x 2 = 1,66 against a line of 1,65. It is the same cent the "Sauzen" row showed on the
  // reported document. The rule is not "big quantities are the problem" — it is that any price
  // sitting near the middle of a cent fails as soon as it is multiplied at all.
  const few = unitPriceDecimals(p, 2, round2(2 * p));
  const many = unitPriceDecimals(p, 150, 123.85);
  assert.ok(few >= 2 && many >= few, `precision must not shrink as the quantity grows: ${few} then ${many}`);
  assert.ok(many > 2, "a hundred and fifty units certainly need more than two");
  for (const q of [1, 2, 3, 7, 12, 38, 100, 150, 999]) {
    assert.ok(reconciles(p, q, round2(q * p)), `quantity ${q} does not reconcile`);
  }
});

test("[PRIJS-KOLOM] the fewest decimals that work, never more", () => {
  // Precision is not free: five decimals on a price that needs two is noise on a customer's
  // invoice, and noise is how a column stops being read.
  const p = 0.9 / 1.09;
  const d = unitPriceDecimals(p, 150, 123.85);
  assert.ok(
    round2(150 * roundTo(p, d - 1)) !== 123.85,
    `${d} decimals were used where ${d - 1} would also have worked`,
  );
});

test("[PRIJS-KOLOM] a fractional quantity works too", () => {
  // 1,5 uur x EUR 33,33 = 49,995, stored as 50,00. The price is round; the QUANTITY is not.
  assert.ok(reconciles(33.33, 1.5, 50));
  assert.equal(unitPriceDecimals(33.33, 1.5, 50), 2, "a round price stays round");
});

test("[PRIJS-KOLOM] a creditnota's negative line reconciles the same way", () => {
  // The credit note copies its lines and negates them. A rounding rule that only holds in one
  // direction is how a refund ends up a cent from the charge.
  const p = 0.9 / 1.09;
  assert.equal(unitPriceDecimals(-p, -150, 123.85), unitPriceDecimals(p, 150, 123.85));
  assert.ok(reconciles(p, -150, -123.85), "negative quantity");
  assert.ok(reconciles(-p, 150, -123.85), "negative price");
});

test("[PRIJS-KOLOM] a missing line total falls back to the product, and cannot disagree with it", () => {
  // Some legacy rows have no line_total. The column is then quantity x price by definition.
  assert.equal(unitPriceDecimals(0.9 / 1.09, 150, null), unitPriceDecimals(0.9 / 1.09, 150, 123.85));
  assert.equal(unitPriceDecimals(75, 2, undefined), 2);
});

test("[PRIJS-KOLOM] rubbish in does not produce NaN on a customer's invoice", () => {
  // These reach a PDF. A blank or a "NaN" in the price column is worse than a rounded number.
  assert.equal(unitPriceDecimals(NaN, 5, 10), 2);
  assert.equal(unitPriceDecimals(10, NaN, 10), 2);
  assert.equal(unitPriceDecimals(null, null, null), 2);
  assert.equal(formatUnitPriceNL(null, 1, 0), "€ 0,00");
  assert.doesNotMatch(formatUnitPriceNL(NaN, NaN, NaN), /NaN/);
});

test("[PRIJS-KOLOM] an absurd quantity gives the closest available answer, not an unreadable one", () => {
  // Beyond six decimals a price column stops being a price column. The residual there is under a
  // cent, and the line total remains what it always was — this only ever changes the DISPLAY.
  const d = unitPriceDecimals(1 / 3, 1_000_000, 333333.33);
  assert.ok(d <= 6, `capped, got ${d}`);
  assert.doesNotMatch(formatUnitPriceNL(1 / 3, 1_000_000, 333333.33), /\d{7,}/, "no endless tail");
});

test("[PRIJS-KOLOM] the euro sign is followed by an ordinary space", () => {
  // Intl emits U+00A0. Helvetica in the PDF has no glyph for it and draws a box, right next to the
  // amount — which is the one place on the document nobody should have to squint at.
  const s = formatUnitPriceNL(0.9 / 1.09, 150, 123.85);
  assert.doesNotMatch(s, / /, "no non-breaking space");
  assert.match(s, /^€ /);
});
