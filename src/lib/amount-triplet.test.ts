// [AMOUNT-TRIPLET] Pure node test — run: npx tsx --test src/lib/amount-triplet.test.ts
//
// The property that matters: AFTER EVERY EDIT, ex + btw = incl. That invariant is why the total
// used to be non-editable; now that it IS editable, the guarantee has to be proven here rather
// than hoped for in the screen.
//
// And beyond that: the four invoices that stalled must be fillable using the numbers PRINTED on
// the paper, without the owner computing anything.
import { test } from "node:test";
import assert from "node:assert/strict";

import { setExcl, setBtw, setIncl, tripletHolds, type AmountTriplet } from "./amount-triplet";

const empty: AmountTriplet = { ex: 0, btw: 0, incl: 0 };
const round2 = (n: number) => Math.round(n * 100) / 100;

test("the identity survives every edit", () => {
  let t = empty;
  for (const step of [
    () => (t = setExcl(t, 100)),
    () => (t = setBtw(t, 21)),
    () => (t = setIncl(t, 1078.46)),
    () => (t = setBtw(t, 88.73)),
    () => (t = setExcl(t, -123)),
    () => (t = setIncl(t, -109.58)),
  ]) {
    step();
    assert.ok(tripletHolds(t), JSON.stringify(t));
  }
});

test("[A · crates] total and btw off the paper → the ex amount follows", () => {
  // The invoice prints total 1078.46 and total btw 88.73. The figure the reader tripped over
  // (ex. BTW 989.73) no longer has to be worked out by hand.
  let t: AmountTriplet = { ex: 985.87, btw: 88.73, incl: 1074.6 }; // what was stored, wrongly
  t = setIncl(t, 1078.46);
  assert.equal(round2(t.ex), 989.73);
  assert.equal(t.btw, 88.73, "btw stays — it was not touched");
  assert.ok(tripletHolds(t));
});

test("[C · two rates] here btw is the field you touch instead", () => {
  // Paper: ex. BTW 3413.92 was already right; btw had to become 233.20 + 172.70 = 405.90.
  let t: AmountTriplet = { ex: 3413.92, btw: 995.9, incl: 4409.82 };
  t = setBtw(t, 405.9);
  assert.equal(round2(t.incl), 3819.82, "the total lands on what the paper says");
  assert.equal(t.ex, 3413.92);
});

test("[D · returned crates] a net-negative invoice is simply fillable", () => {
  // Paper: Totaal te voldoen −109.58, btw low rate 13.42, Totaal excl. BTW −123.00.
  let t: AmountTriplet = { ex: 26, btw: 13.42, incl: 39.42 }; // what was stored, wrongly
  t = setBtw(t, 13.42);
  t = setIncl(t, -109.58);
  assert.equal(round2(t.ex), -123, "exactly the figure under 'Totaal excl. BTW'");
  assert.ok(tripletHolds(t));
});

test("btw stays put unless you type it yourself", () => {
  // That is the whole deal: of the three, btw is the number you least want to see jump — it goes
  // straight into the return as deductible input tax.
  let t: AmountTriplet = { ex: 100, btw: 21, incl: 121 };
  t = setExcl(t, 200);
  assert.equal(t.btw, 21);
  t = setIncl(t, 500);
  assert.equal(t.btw, 21);
  assert.equal(t.ex, 479);
});

test("a half-typed field pushes no NaN into the arithmetic", () => {
  let t: AmountTriplet = { ex: 100, btw: 21, incl: 121 };
  t = setIncl(t, Number.NaN);
  assert.equal(t.incl, 0);
  assert.equal(t.ex, -21, "0 − 21: the identity still holds, even on nonsense");
  assert.ok(tripletHolds(t));
  assert.ok(tripletHolds(setExcl(empty, null)));
  assert.ok(tripletHolds(setBtw(empty, undefined)));
});

test("zero stays zero — an empty invoice does not quietly become something", () => {
  assert.deepEqual(setIncl(empty, 0), { ex: 0, btw: 0, incl: 0 });
});
