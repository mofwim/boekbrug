// [MIN-REGEL] Pure node test — run: npx tsx --test src/lib/read-line.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { readQuantity, signInQuantity, readLineAmounts } from "./read-line";

test("[MIN-REGEL] a negative quantity is a credit line, not an unreadable one", () => {
  // The defect, in one assertion. `quantity > 0 ? quantity : 1` answered 1 here, and the line that
  // gave EUR 71,85 back became EUR 23,95 owed.
  assert.equal(readQuantity(-3), -3);
  assert.deepEqual(readLineAmounts({ quantity: -3, unit_price: 23.95, amount: -71.85 }), {
    quantity: -3,
    unit_price: 23.95,
  });
});

test("[MIN-REGEL] an unusable quantity is still one of the thing", () => {
  // The half of the old guard that was right, and has to stay: a scan that gives only a line total
  // describes one of it.
  for (const junk of [undefined, null, 0, NaN, Infinity, "3", {}, []]) {
    assert.equal(readQuantity(junk), 1, `${JSON.stringify(junk)} is not a quantity`);
  }
  assert.equal(readQuantity(undefined, 2), 2, "the fallback is the caller's");
});

test("[MIN-REGEL] the minus moves out of the price and into the quantity", () => {
  // A model transcribing "-71,85" against a quantity of 3 sometimes writes the price negative.
  // That form cannot be issued — BR-27 — so it is normalised before it becomes a line.
  assert.deepEqual(signInQuantity(3, -23.95), { quantity: -3, unit_price: 23.95 });
  assert.deepEqual(readLineAmounts({ quantity: 3, unit_price: -23.95 }), { quantity: -3, unit_price: 23.95 });
  // Both negative means the line is a delivery again: -3 x -23,95 is money owed.
  assert.deepEqual(signInQuantity(-3, -23.95), { quantity: 3, unit_price: 23.95 });
});

test("[MIN-REGEL] an ordinary line is returned untouched", () => {
  // The narrow half: this must be invisible to every reading that was already right.
  assert.deepEqual(signInQuantity(2, 75), { quantity: 2, unit_price: 75 });
  assert.deepEqual(readLineAmounts({ quantity: 2, unit_price: 75 }), { quantity: 2, unit_price: 75 });
  // A price of exactly zero is a free item, and zero has no sign to move.
  assert.deepEqual(signInQuantity(1, 0), { quantity: 1, unit_price: 0 });
});

test("[MIN-REGEL] a line total instead of a price still reproduces the paper", () => {
  // The scan gives `amount` and no unit price. The arithmetic must come out at what was printed,
  // sign included.
  assert.deepEqual(readLineAmounts({ amount: 123.85 }), { quantity: 1, unit_price: 123.85 });
  assert.deepEqual(readLineAmounts({ quantity: 150, amount: 123.85 }), {
    quantity: 150,
    unit_price: 123.85 / 150,
  });
  // A credit line given only as a total: the minus ends up in the quantity, not the price.
  assert.deepEqual(readLineAmounts({ amount: -71.85 }), { quantity: -1, unit_price: 71.85 });
  // …and one given as a negative quantity AND a negative total reproduces the positive price.
  assert.deepEqual(readLineAmounts({ quantity: -3, amount: -71.85 }), { quantity: -3, unit_price: 23.95 });
});

test("[MIN-REGEL] a reading with no price at all is refused, not invented", () => {
  assert.equal(readLineAmounts({}), null, "a row with a description and no figures");
  assert.equal(readLineAmounts({ quantity: 3 }), null);
  assert.equal(readLineAmounts({ unit_price: 0 }), null, "a price of zero and no total says nothing");
  assert.equal(readLineAmounts({ amount: NaN }), null);
  assert.equal(readLineAmounts({ unit_price: "23,95" }), null, "a string is not a number here");
});

test("[MIN-REGEL] the price wins over the total when both are there", () => {
  // They can disagree — a scan reads two numbers off a row independently. The unit price is the
  // one the app can check (quantity × price against the line), so it is the one that is kept.
  assert.deepEqual(readLineAmounts({ quantity: 2, unit_price: 75, amount: 9999 }), {
    quantity: 2,
    unit_price: 75,
  });
});
