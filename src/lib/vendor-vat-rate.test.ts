// Run: npx tsx --test src/lib/vendor-vat-rate.test.ts
//
// Every fixture below is a production shape, counted on the owner's own rows before this module
// was written. The Enka Horeca case is the one that decides the design: it must REFUSE.
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveVendorRate, proposeSplit, snapToLegalRate,
  MIN_INVOICES_FOR_RATE, RATE_SNAP_TOLERANCE,
} from "./vendor-vat-rate";

/** An invoice at a given rate whose own arithmetic holds, the way a real one does. */
const at = (ex: number, ratePct: number) => {
  const btw = Math.round(ex * ratePct) / 100;
  return { totalExBtw: ex, btwAmount: btw, totalIncBtw: Math.round((ex + btw) * 100) / 100 };
};

test("[TARIEF-GEHEUGEN] a supplier who always charges one rate is recognised", () => {
  // ATAPACK Cash & Carry: 12 invoices, every one 21,00 %.
  const rate = deriveVendorRate(Array.from({ length: 12 }, (_, i) => at(100 + i, 21)));
  assert.deepEqual(rate, { rate: 21, basedOn: 12 });

  // Sumer Food: 12 invoices, every one 9,00 %.
  assert.equal(deriveVendorRate(Array.from({ length: 12 }, (_, i) => at(50 + i, 9)))?.rate, 9);
});

test("[TARIEF-GEHEUGEN] cent rounding is not a different rate", () => {
  // W.KETELS & ZN: 23 invoices at 9,00 % and two that compute to 8,99 and 9,01. Those two are the
  // same 9 % invoice with the cents falling differently; a rule that called them a second rate
  // would refuse the supplier with the strongest history in the whole administration.
  const rijen = [
    ...Array.from({ length: 23 }, (_, i) => at(80 + i, 9)),
    { totalExBtw: 111.23, btwAmount: 10.0, totalIncBtw: 121.23 },  // 8,99 %
    { totalExBtw: 99.85, btwAmount: 9.0, totalIncBtw: 108.85 },    // 9,01 %
  ];
  assert.equal(deriveVendorRate(rijen)?.rate, 9);
  assert.equal(deriveVendorRate(rijen)?.basedOn, 25);
});

test("[TARIEF-GEHEUGEN] a supplier whose invoices BLEND rates is refused — the whole point", () => {
  // Enka Horeca: 9,00 ten times, then 9,45 · 10,07 · 11,10 · 11,89. Those four carry both 9 % and
  // 21 % lines, so the invoice average is not a rate at all. This is the largest block by value
  // (13 held invoices, EUR 18.698) and it is exactly the one that must get no proposal: a single
  // rate here would put a wrong number in a btw-aangifte.
  const enka = [
    ...Array.from({ length: 10 }, (_, i) => at(200 + i, 9)),
    { totalExBtw: 100, btwAmount: 9.45, totalIncBtw: 109.45 },
    { totalExBtw: 100, btwAmount: 10.07, totalIncBtw: 110.07 },
    { totalExBtw: 100, btwAmount: 11.1, totalIncBtw: 111.1 },
    { totalExBtw: 100, btwAmount: 11.89, totalIncBtw: 111.89 },
  ];
  assert.equal(deriveVendorRate(enka), null,
    "a blended supplier must produce no proposal — ten agreeing invoices do not outvote one blend");
});

test("[TARIEF-GEHEUGEN] two legal rates are also no rate — the majority does not win", () => {
  // 9 % ten times and 21 % twice is not "9 %". Picking the majority would be wrong once every six
  // invoices, silently, in the aangifte.
  const gemengd = [...Array.from({ length: 10 }, () => at(100, 9)), at(100, 21), at(100, 21)];
  assert.equal(deriveVendorRate(gemengd), null);
});

test("[TARIEF-GEHEUGEN] too little history is no history", () => {
  const drie = Array.from({ length: MIN_INVOICES_FOR_RATE - 1 }, () => at(100, 9));
  assert.equal(deriveVendorRate(drie), null, "below the floor there is nothing to lean on");
  assert.equal(deriveVendorRate([...drie, at(100, 9)])?.basedOn, MIN_INVOICES_FOR_RATE);
});

test("[TARIEF-GEHEUGEN] an invoice that does not add up may not testify about a rate", () => {
  // Otherwise the defect this module exists to answer becomes its own evidence: the held invoices
  // all have ex = 0 and btw = 0, and counting them would teach the supplier a rate of nothing.
  const kapot = [
    ...Array.from({ length: 4 }, () => at(100, 9)),
    { totalExBtw: 100, btwAmount: 21, totalIncBtw: 109 }, // 21 % claimed, total says 9 %
    { totalExBtw: 0, btwAmount: 0, totalIncBtw: 1560.42 }, // the held shape itself
  ];
  assert.equal(deriveVendorRate(kapot)?.rate, 9, "the contradictory rows are skipped, not obeyed");
  assert.equal(deriveVendorRate(kapot)?.basedOn, 4);
});

test("[TARIEF-GEHEUGEN] the snap is tight enough to reject the smallest real blend", () => {
  assert.equal(snapToLegalRate(9), 9);
  assert.equal(snapToLegalRate(8.99), 9);
  assert.equal(snapToLegalRate(21.01), 21);
  assert.equal(snapToLegalRate(0), 0);
  // Enka's lowest blend. If this ever snapped to 9 the refusal above would quietly stop working.
  assert.equal(snapToLegalRate(9.45), null);
  assert.equal(snapToLegalRate(11.1), null);
  assert.ok(RATE_SNAP_TOLERANCE < 0.45, "the tolerance must stay under the smallest observed blend");
});

test("[TARIEF-GEHEUGEN] a proposed split ADDS UP, to the cent, always", () => {
  // The one thing a proposal may never do is fail the check it exists to clear. Rounding both
  // halves independently puts it a cent out and safecore flags it as sum_mismatch — the app would
  // then be offering the owner a suggestion it refuses to accept.
  for (const incl of [1560.42, 1336.14, 117.17, 0.01, 8980.05, 3819.82, 1086.92, 99.99, 1234.56]) {
    for (const rate of [0, 9, 21]) {
      const s = proposeSplit(incl, rate)!;
      assert.ok(s, `no split for ${incl} at ${rate}%`);
      assert.equal(Math.round((s.totalExBtw + s.btwAmount) * 100) / 100, incl,
        `${incl} at ${rate}% does not add back up — the proposal would fail safecore`);
      assert.ok(s.btwAmount >= 0, "a purchase invoice's BTW is never negative here");
    }
  }
});

test("[TARIEF-GEHEUGEN] a creditnota's negative total splits the same way and still adds up", () => {
  const s = proposeSplit(-1560.42, 9)!;
  assert.equal(Math.round((s.totalExBtw + s.btwAmount) * 100) / 100, -1560.42);
});

test("[TARIEF-GEHEUGEN] nothing is proposed for a rate the law does not have", () => {
  assert.equal(proposeSplit(100, 6), null);
  assert.equal(proposeSplit(100, 19), null);
  assert.equal(proposeSplit(0, 9), null);
  assert.equal(proposeSplit(Number.NaN, 9), null);
});
