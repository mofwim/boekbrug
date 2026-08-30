// src/lib/netto-inkomen.test.ts
// [NETTO-TOOL] Pure node test — run: npx tsx --test src/lib/netto-inkomen.test.ts
//
// Until this file existed, not one euro of a public tax table was asserted anywhere. The figures
// sat in an object literal under src/app — outside the test:unit glob, outside tests/render (which
// covers the FILE tools), and outside the Playwright sweep (which only checks the page is not a
// 5xx). A wrong rate, a wrong bracket or a stale tax year would have shipped in a 36px green
// figure that visitors act on, and nothing in the gate chain would have moved.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AK_FULL_AT, P, TAX_YEAR, algemeneHeffingskorting, arbeidskorting, box1, tableIsCurrent,
} from "./netto-inkomen";

test("[NETTO-TOOL] the 2026 table is the published one, figure for figure", () => {
  // Each of these is a Belastingdienst/Rijksoverheid number. They are pinned individually rather
  // than as a snapshot so a diff names WHICH one moved.
  assert.equal(P.zelfstandigenaftrek, 1200);
  assert.equal(P.startersaftrek, 2123);
  assert.equal(P.mkb, 0.127);
  assert.deepEqual(P.brackets.map((b) => b.upto), [38883, 78426, Infinity]);
  assert.deepEqual(P.brackets.map((b) => b.rate), [0.3575, 0.3756, 0.495]);
  assert.equal(P.ahkMax, 3115);
  assert.equal(P.ahkStart, 29736);
  assert.equal(P.ahkRate, 0.06398);
  assert.equal(P.akMax, 5685);
  assert.equal(P.akPhaseStart, 45592);
  assert.equal(P.akPhaseRate, 0.0651);
  assert.equal(P.zvwRate, 0.0485);
  assert.equal(P.zvwMax, 79409);
  assert.equal(TAX_YEAR, 2026);
});

test("[NETTO-TOOL] the table is internally coherent — the AHK dies where the second bracket ends", () => {
  // Not a coincidence and not a coincidence to lose: the Dutch AHK afbouw is designed to reach
  // zero at the top of the second bracket. 29736 + 3115/0.06398 = 78.423, three euros from 78.426.
  // If somebody updates one figure of the set and not the others, this is what notices.
  const zeroAt = P.ahkStart + P.ahkMax / P.ahkRate;
  assert.ok(Math.abs(zeroAt - P.brackets[1].upto) < 10,
    `the AHK reaches zero at ${zeroAt.toFixed(0)}, the second bracket ends at ${P.brackets[1].upto}`);
  assert.equal(algemeneHeffingskorting(P.brackets[1].upto), 0);
  assert.equal(algemeneHeffingskorting(0), P.ahkMax, "flat below the afbouw start");
  assert.equal(algemeneHeffingskorting(P.ahkStart), P.ahkMax, "…up to and including it");
});

test("[NETTO-TOOL] box 1 is marginal, slice by slice", () => {
  // A rate applied to the WHOLE income instead of the slice is the classic tax-table bug, and it
  // overstates the bill by thousands. Each boundary is checked from both sides.
  assert.equal(box1(0), 0);
  assert.ok(Math.abs(box1(38883) - 38883 * 0.3575) < 0.01, "the first bracket, exactly");
  const second = 38883 * 0.3575 + (78426 - 38883) * 0.3756;
  assert.ok(Math.abs(box1(78426) - second) < 0.01, "the second bracket is only its own slice");
  assert.ok(Math.abs(box1(100000) - (second + (100000 - 78426) * 0.495)) < 0.01, "and the top rate");
  // One euro past a boundary costs one euro at the higher rate — never the whole income.
  assert.ok(box1(38884) - box1(38883) < 0.5, "no cliff at the bracket edge");
});

test("[NETTO-TOOL] the arbeidskorting phase-out is the statutory line", () => {
  // The way DOWN is published law and is reproduced exactly.
  assert.equal(arbeidskorting(P.akPhaseStart), P.akMax);
  assert.ok(Math.abs(arbeidskorting(P.akPhaseStart + 1000) - (P.akMax - 1000 * P.akPhaseRate)) < 0.01);
  const dead = P.akPhaseStart + P.akMax / P.akPhaseRate;
  assert.equal(arbeidskorting(dead + 1), 0, "it reaches zero and stops — never negative");
  assert.equal(arbeidskorting(0), 0);
  assert.equal(arbeidskorting(-5), 0);
});

test("[NETTO-TOOL] the build-up is an APPROXIMATION, and the file admits it", () => {
  // This is the one part of the module that is not the law, and the test says so out loud so the
  // next reader cannot mistake AK_FULL_AT for a fiscal parameter — which is exactly what happened
  // while it sat unlabelled among fourteen real ones inside the component.
  //
  // The real curve reaches akMax AT the phase-out start, by construction. This one reaches it
  // €6.592 earlier and then runs flat, so between AK_FULL_AT and akPhaseStart it over-credits, and
  // below roughly €26k of arbeidsinkomen the straight line under-credits against the steep middle
  // segment of the real staircase. Both directions, which is what the old header denied.
  assert.ok(AK_FULL_AT < P.akPhaseStart,
    "the approximation peaks early — that is the shape of the error, and it is documented");
  assert.equal(arbeidskorting(AK_FULL_AT), P.akMax);
  assert.equal(arbeidskorting(AK_FULL_AT + 1), P.akMax, "flat from there to the phase-out");
  // Straight line on the way up: half the income, half the credit.
  assert.ok(Math.abs(arbeidskorting(AK_FULL_AT / 2) - P.akMax / 2) < 0.01);
});

test("[NETTO-TOOL] the tax year is compared to the clock, and the comparison is not >=", () => {
  // From 1 January the green card would otherwise print last year's figures for twelve months with
  // nothing on it saying so — the page's year lives in prose, three scrolls above the amount.
  assert.equal(tableIsCurrent(TAX_YEAR), true, "the year the table is FOR is still current");
  assert.equal(tableIsCurrent(TAX_YEAR - 1), true, "…and a table ahead of the clock is fine too");
  assert.equal(tableIsCurrent(TAX_YEAR + 1), false, "the year after is stale, and must be said");
});

test("[NETTO-TOOL] the published example still computes to the published figure", () => {
  // €50.000 profit, urencriterium, no starter — the tool's own default, and the flagship example
  // in content/blog/nl/netto-inkomen-zzp-2026.mdx and its ar/tr translations. If the table moves,
  // the article and the tool must move together or one of them is lying.
  const winst = 50000;
  const ondernemersaftrek = P.zelfstandigenaftrek;
  const winstNaAftrek = winst - ondernemersaftrek;
  const mkb = winstNaAftrek * P.mkb;
  const belastbaar = winstNaAftrek - mkb;
  const ibNa = Math.max(0, box1(belastbaar) - algemeneHeffingskorting(belastbaar) - arbeidskorting(belastbaar));
  const zvw = Math.min(belastbaar, P.zvwMax) * P.zvwRate;
  const netto = winst - ibNa - zvw;
  assert.ok(Math.abs(netto - 40613) < 1.5, `the published € 40.613 became € ${netto.toFixed(0)}`);
});
