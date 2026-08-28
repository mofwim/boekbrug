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

import {
  setExcl, setBtw, setIncl, tripletHolds, splitByRate, amountFieldText, NL_BTW_RATES,
  type AmountTriplet, rateOfTriplet,

} from "./amount-triplet";

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

// ─── [BTW-TARIEF] + [NUL-IS-GEEN-INVOER] ───────────────────────────────────────────────────────

test("[BTW-TARIEF] a total splits by the rate the owner picked, to the cent", () => {
  // The invoice that prompted this: Dutch Sweets Company, € 740,47, no btw read at all.
  const negen = splitByRate(740.47, 9);
  assert.equal(negen.ex, 679.33);
  assert.equal(round2(negen.btw), 61.14);
  assert.equal(negen.incl, 740.47);

  const eenentwintig = splitByRate(740.47, 21);
  assert.equal(eenentwintig.ex, 611.96);
  assert.equal(round2(eenentwintig.btw), 128.51);
});

test("[BTW-TARIEF] the identity survives the split, on every amount", () => {
  // Rounding BOTH halves independently is what loses a cent — btw is the subtraction, so the three
  // numbers add up exactly whatever the total is. [CENT] is about precisely this.
  for (const bedrag of [0.01, 0.05, 9.99, 12.35, 100, 740.47, 1078.46, 99999.99]) {
    for (const tarief of NL_BTW_RATES) {
      const t = splitByRate(bedrag, tarief);
      assert.ok(tripletHolds(t), `${bedrag} @ ${tarief}% does not add up`);
      assert.equal(round2(t.ex + t.btw), round2(bedrag), `${bedrag} @ ${tarief}% lost a cent`);
    }
  }
});

test("[BTW-TARIEF] a creditnota splits negative, and a zero rate invents no btw", () => {
  const credit = splitByRate(-740.47, 9);
  assert.ok(credit.ex < 0 && credit.btw < 0, "a credit note must split into two negative halves");
  assert.equal(round2(credit.ex + credit.btw), -740.47);

  // 0%, and anything unreadable, leaves everything in the base. Never a guessed btw.
  for (const r of [0, -5, NaN]) {
    const t = splitByRate(500, r);
    assert.equal(t.btw, 0, `rate ${r} invented btw`);
    assert.equal(t.ex, 500);
  }
});

test("[NUL-IS-GEEN-INVOER] a zero shows as an empty box, not as the character 0", () => {
  // THE BUG: a held 0 rendered as "0", the caret landed after it, and typing 740,47 into an
  // untouched field produced "0740,47".
  assert.equal(amountFieldText(0, null, "btw"), "");
  assert.equal(amountFieldText(740.47, null, "incl"), "740,47");
  // Dutch decimal comma, and the float tail never reaches the screen.
  assert.equal(amountFieldText(1065.1399999999999, null, "ex"), "1065,14");

  // While this field is being typed in, the draft wins — including a half-typed "0," and an
  // emptied box, which must NOT snap back to "0" under the owner's fingers.
  assert.equal(amountFieldText(0, { field: "btw", text: "0," }, "btw"), "0,");
  assert.equal(amountFieldText(740.47, { field: "incl", text: "" }, "incl"), "");

  // A draft belonging to ANOTHER field never leaks into this one — that is how touching a
  // neighbouring box used to make this one jump back to "0".
  assert.equal(amountFieldText(0, { field: "incl", text: "74" }, "btw"), "");
});

test("[BTW-TARIEF] 0% is a rate the owner can state, not the absence of an answer", () => {
  // Verlegde btw (art. 12 lid 5), an intracommunautaire levering and a vrijgestelde prestatie all
  // print a real 0 on the paper. "No btw yet" and "the btw is nil" look identical in the database
  // and are not identical on a document — so the owner has to be able to SAY zero.
  assert.deepEqual(NL_BTW_RATES.slice(), [0, 9, 21]);
  const t = splitByRate(740.47, 0);
  assert.equal(t.btw, 0);
  assert.equal(t.ex, 740.47, "a 0% invoice puts the whole total in the base");
  assert.equal(t.incl, 740.47);
});

test("[BTW-TARIEF] the button row reads back the rate the invoice is already at", () => {
  // Not used to change anything — it is what the screen shows, so an owner can see which rate the
  // app believes the invoice carries BEFORE they touch a button, and an accidental tap is visible.
  assert.equal(rateOfTriplet(splitByRate(740.47, 9)), 9);
  assert.equal(rateOfTriplet(splitByRate(740.47, 21)), 21);
  assert.equal(rateOfTriplet(splitByRate(740.47, 0)), 0);
  // A real invoice, entered by hand rather than split: 195,28 + 41,01 = 236,29 is 21%.
  assert.equal(rateOfTriplet({ ex: 195.28, btw: 41.01, incl: 236.29 }), 21);

  // A MIXED 9%/21% wholesale invoice belongs to no standard rate and must not be claimed for one.
  // 800 at 9% plus 200 at 21% = 872 + 242 → blended ~11,4%.
  assert.equal(rateOfTriplet({ ex: 1000, btw: 114, incl: 1114 }), null,
    "a blended rate was reported as a standard one");
  // Nothing to read on an empty invoice.
  assert.equal(rateOfTriplet({ ex: 0, btw: 0, incl: 0 }), null);
});

test("[BTW-TARIEF] the readback tolerates a cent, and no more", () => {
  // The tolerance is on the MONEY, not on the percentage: rounding a real invoice produces a
  // fraction of a cent of drift, and comparing rates would call a correct 9% invoice "not 9%"
  // whenever the base rounds unkindly.
  const nine = splitByRate(1234.56, 9);
  assert.equal(rateOfTriplet({ ...nine, btw: round2(nine.btw + 0.01) }), 9, "one cent of drift broke the readback");
  assert.equal(rateOfTriplet({ ...nine, btw: round2(nine.btw + 0.5) }), null, "half a euro was called 9%");
});
