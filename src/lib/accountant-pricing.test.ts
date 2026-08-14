// src/lib/accountant-pricing.test.ts
// [KANTOOR-STAFFEL] The band table is money, so the boundaries are tested at the boundary.
//
// The interesting bugs in a banded price are all off-by-one: an office with exactly 10 clients
// paying, an office with 11 not paying, or the top band never being reached. None of those show
// up when you test the middle of a band, which is what a "does it work" test does.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNTANT_BANDS,
  ACCOUNTANT_PRICING_ACTIVE,
  bandFor,
  inclBtw,
  monthlyChargeExclBtw,
  pricingTableMarkdown,
} from "./accountant-pricing";

test("the free boundary is inclusive, and the first paid band starts one client later", () => {
  assert.equal(bandFor(10).monthlyExclBtw, 0, "10 linked clients is still free — §5.8 says 'tot en met 10'");
  assert.equal(bandFor(11).monthlyExclBtw, 49, "11 is the first client that costs anything");
  // The boundary that the Terms name out loud. If this moves, /voorwaarden is wrong the same day.
  assert.equal(bandFor(1).monthlyExclBtw, 0);
});

test("every band boundary charges the band it is the ceiling of, not the next one", () => {
  assert.equal(bandFor(25).monthlyExclBtw, 49);
  assert.equal(bandFor(26).monthlyExclBtw, 89);
  assert.equal(bandFor(50).monthlyExclBtw, 89);
  assert.equal(bandFor(51).monthlyExclBtw, 149);
});

test("the top band is open-ended", () => {
  // An office with 400 clients is not this product's customer, but it must not fall through the
  // table into an exception or a zero charge.
  assert.equal(bandFor(400).monthlyExclBtw, 149);
  assert.equal(ACCOUNTANT_BANDS.at(-1)?.upTo, null, "the last band must stay open-ended");
});

test("a client count of zero or below falls in the free band instead of throwing", () => {
  // A count this low is a caller bug. Charging is the wrong way to report one, and so is a crash
  // on a page an office is reading.
  assert.equal(bandFor(0).monthlyExclBtw, 0);
  assert.equal(bandFor(-3).monthlyExclBtw, 0);
});

test("nothing is charged while the pricing is not active", () => {
  // The master switch is the whole safety of shipping a prepared price. Billing code must call
  // monthlyChargeExclBtw, never read the band table directly — this is the test that says so.
  assert.equal(ACCOUNTANT_PRICING_ACTIVE, false, "activating requires the 30-day notice of §5.8.1 first");
  for (const clients of [0, 10, 11, 25, 26, 50, 51, 400]) {
    assert.equal(monthlyChargeExclBtw(clients), 0, `an inactive price must charge nobody (${clients} clients)`);
  }
});

test("btw is added at 21% and rounded to whole cents", () => {
  assert.equal(inclBtw(49), 59.29);
  assert.equal(inclBtw(89), 107.69);
  assert.equal(inclBtw(149), 180.29);
  assert.equal(inclBtw(0), 0, "a free band stays free with btw on it");
});

test("the rendered table covers every band, with both amounts", () => {
  const md = pricingTableMarkdown();
  // Every band must appear. A band defined but not rendered is a price nobody was told about.
  for (const band of ACCOUNTANT_BANDS) {
    if (band.monthlyExclBtw === 0) continue;
    const excl = band.monthlyExclBtw.toFixed(2).replace(".", ",");
    const incl = inclBtw(band.monthlyExclBtw).toFixed(2).replace(".", ",");
    assert.ok(md.includes(`€ ${excl}`), `band € ${excl} must be in the table`);
    assert.ok(md.includes(`€ ${incl}`), `the incl-btw amount € ${incl} must be shown next to it`);
  }
  // The reader of this table reclaims the btw, so the excl amount is the one they compare with a
  // competitor. Showing only the incl amount makes BoekBrug look more expensive than it is.
  assert.ok(md.includes("excl. btw"), "the table must state which of the two amounts is which");
});

test("the bands are ordered, so bandFor cannot return a later band by accident", () => {
  // bandFor walks the array and takes the first match. An unsorted table silently mis-prices.
  let previous = 0;
  for (const band of ACCOUNTANT_BANDS) {
    if (band.upTo === null) break;
    assert.ok(band.upTo > previous, `band ceilings must increase (${band.upTo} after ${previous})`);
    previous = band.upTo;
  }
});
