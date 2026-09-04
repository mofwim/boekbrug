// Run: npx tsx --test src/lib/untaxed-amount.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { taxableBase, impliedRate, untaxedThatWouldExplain } from "./untaxed-amount";

test("[NUL-POST] the rate is computed over the TAXED base, not the whole excl amount", () => {
  // Aardappelgroothandel Altena, the clearest case in production: the implied rate over the full
  // base is 6,50%, which is not a Dutch rate. Take the statiegeld out and it is 9% exactly.
  const ex = 138.46, btw = 9.0; // 9,00 / 138,46 = 6,50%
  assert.equal(Math.round(impliedRate(ex, btw, 0)! * 100) / 100, 6.5);
  const nul = ex - btw / 0.09; // the untaxed part
  assert.equal(Math.round(impliedRate(ex, btw, nul)! * 100) / 100, 9);
});

test("[NUL-POST] excl + btw = totaal keeps holding — the post sits INSIDE the base", () => {
  // The decision the whole design rests on. A 0%-line is part of the amount excluding BTW, so no
  // sum anywhere else in the app changes. Storing it beside the base would have broken every
  // existing total on the day it shipped.
  const ex = 611.61, btw = 55.04, incl = 666.65, nul = 100;
  assert.equal(Math.round((ex + btw) * 100) / 100, incl, "the invoice total is unaffected");
  assert.equal(taxableBase(ex, nul), 511.61, "only the base the RATE is measured over shrinks");
});

test("[NUL-POST] an untaxed part larger than the base cannot produce a nonsense rate", () => {
  // A typo in the field must not make the app state something absurd with confidence.
  assert.equal(taxableBase(100, 250), 0);
  assert.equal(impliedRate(100, 9, 250), null, "no base to divide by is null, never a rate of 0");
});

test("[NUL-POST] a creditnota keeps its sign", () => {
  // Everything on a creditnota is negative in this app. Clamping with Math.max would flip the base
  // positive and invert the rate.
  assert.ok(taxableBase(-611.61, 100) < 0, "a credit base stays negative");
  assert.equal(Math.round(impliedRate(-1090, -90, 90)! * 100) / 100, 9);
});

test("[NUL-POST] the app OFFERS the amount that would explain a sub-legal rate", () => {
  // Elegance Brands: 8,38%. Below 9, so an untaxed post explains it and the app can say how much.
  const ex = 1000, btw = 83.8;
  const v = untaxedThatWouldExplain(ex, btw)!;
  assert.equal(v.rate, 9);
  assert.equal(v.untaxed, 68.89); // 1000 - 83,80/0,09
  // …and applying it lands exactly on the legal rate.
  assert.equal(Math.round(impliedRate(ex, btw, v.untaxed)! * 100) / 100, 9);
});

test("[NUL-POST] a MIXED-rate invoice is offered nothing — that is a different animal", () => {
  // Enka Horeca lands at 10,63% because it puts 9% and 21% lines on one invoice. Suggesting
  // statiegeld there would be a wrong answer in a confident voice, and _btw_rows already models it.
  for (const rate of [10.63, 11.1, 11.89, 15, 20]) {
    assert.equal(untaxedThatWouldExplain(1000, rate * 10), null,
      `${rate}% sits between two legal rates — a blend, not an untaxed post`);
  }
});

test("[NUL-POST] a legal rate is offered nothing, cent-rounding included", () => {
  for (const btw of [90, 89.9, 90.1, 210, 209.8, 0]) {
    assert.equal(untaxedThatWouldExplain(1000, btw), null,
      `${btw} over 1000 is already a legal rate — an offer here is noise on a correct invoice`);
  }
});

test("[NUL-POST] nothing is offered when it would explain nothing, or everything", () => {
  assert.equal(untaxedThatWouldExplain(0, 9), null);
  assert.equal(untaxedThatWouldExplain(1000, 0), null);
  assert.equal(untaxedThatWouldExplain(-1000, -84), null, "credit notes are not guessed at");
  // A hypothesis that swallows the whole invoice is not an explanation.
  assert.equal(untaxedThatWouldExplain(1000, 0.01), null);
});
