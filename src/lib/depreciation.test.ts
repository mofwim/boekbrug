// src/lib/depreciation.test.ts — run: npx tsx --test src/lib/depreciation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  yearlyDepreciation, depreciationInRange, bookValueAt, activeInRange, assetThreshold,
  withinOrdinaryRate, ASSET_THRESHOLD_EUR, MIN_USEFUL_LIFE_YEARS,
} from "./depreciation";

// The Belastingdienst's own example, verbatim: € 30.000, ten years, restwaarde € 5.000.
const MACHINE = { cost: 30000, residualValue: 5000, usefulLifeYears: 10, inUseFrom: "2026-10-01" };

test("[BEDRIJFSMIDDEL] the Belastingdienst example: € 2.500 a year, € 625 for a 1 October start", () => {
  assert.equal(yearlyDepreciation(MACHINE), 2500);
  assert.equal(depreciationInRange(MACHINE, "2026-01-01", "2026-12-31"), 625);
  assert.equal(depreciationInRange(MACHINE, "2027-01-01", "2027-12-31"), 2500);
  assert.equal(bookValueAt(MACHINE, "2026-12-31"), 29375);
});

test("[BEDRIJFSMIDDEL] the month of ingebruikname is a whole month, whatever the day", () => {
  const late = { ...MACHINE, inUseFrom: "2026-10-31" };
  assert.equal(depreciationInRange(late, "2026-01-01", "2026-12-31"), 625, "31 October still counts October");
  const dec = { ...MACHINE, inUseFrom: "2026-12-15" };
  assert.equal(depreciationInRange(dec, "2026-01-01", "2026-12-31"), round(2500 / 12));
});

test("[BEDRIJFSMIDDEL] twelve months, four quarters and one year re-sum to the cent, and the last year lands exactly on the restwaarde", () => {
  let quarters = 0, months = 0;
  for (let q = 0; q < 4; q++) quarters += depreciationInRange(MACHINE, `2027-${pad(q * 3 + 1)}-01`, `2027-${pad(q * 3 + 3)}-28`);
  for (let m = 1; m <= 12; m++) months += depreciationInRange(MACHINE, `2027-${pad(m)}-01`, `2027-${pad(m)}-28`);
  assert.equal(round(quarters), 2500);
  assert.equal(round(months), 2500);
  // 120 months in total: Oct 2026 … Sep 2036. The final year carries whatever the rounding left.
  let total = 0;
  for (let y = 2026; y <= 2036; y++) total += depreciationInRange(MACHINE, `${y}-01-01`, `${y}-12-31`);
  assert.equal(round(total), 25000, "everything above the restwaarde is written off, no more, no less");
  assert.equal(bookValueAt(MACHINE, "2036-09-30"), 5000);
  assert.equal(bookValueAt(MACHINE, "2040-12-31"), 5000, "and it never goes below the restwaarde");
  assert.equal(depreciationInRange(MACHINE, "2037-01-01", "2037-12-31"), 0, "nothing left to depreciate");
});

test("[BEDRIJFSMIDDEL] before the first month there is nothing; an asset bought before BoekBrug depreciates from its own date", () => {
  assert.equal(depreciationInRange(MACHINE, "2025-01-01", "2025-12-31"), 0);
  assert.equal(bookValueAt(MACHINE, "2026-09-30"), 30000);
  const old = { cost: 6000, residualValue: 0, usefulLifeYears: 5, inUseFrom: "2023-03-01" };
  assert.equal(depreciationInRange(old, "2026-01-01", "2026-12-31"), 1200);
  assert.equal(bookValueAt(old, "2025-12-31"), 6000 - 1200 * 2 - 1000, "34 months gone by the end of 2025");
});

test("[BEDRIJFSMIDDEL] a disposed asset stops in its disposal month", () => {
  const sold = { ...MACHINE, disposedOn: "2028-03-10" };
  assert.equal(depreciationInRange(sold, "2028-01-01", "2028-12-31"), 625, "January to March");
  assert.equal(depreciationInRange(sold, "2029-01-01", "2029-12-31"), 0);
  assert.equal(bookValueAt(sold, "2030-12-31"), 30000 - 625 - 2500 - 625);
  assert.equal(activeInRange(sold, "2029-01-01", "2029-12-31"), false);
  assert.equal(activeInRange(sold, "2028-01-01", "2028-12-31"), true);
  assert.equal(activeInRange(MACHINE, "2025-01-01", "2025-12-31"), false, "not yet bought");
});

test("[BEDRIJFSMIDDEL] the € 450 line is ex btw when the btw is deductible and incl btw when it is not", () => {
  assert.equal(ASSET_THRESHOLD_EUR, 450);
  // € 400 ex + 21% = € 484 incl: an asset for the vrijgestelde ondernemer, a one-year cost for everyone else.
  assert.equal(assetThreshold({ totalExBtw: 400, totalIncBtw: 484, btwDeductible: true }).isAboveThreshold, false);
  assert.equal(assetThreshold({ totalExBtw: 400, totalIncBtw: 484, btwDeductible: false }).isAboveThreshold, true);
  assert.equal(assetThreshold({ totalExBtw: 450, totalIncBtw: 544.5, btwDeductible: true }).isAboveThreshold, true, "exactly € 450 is not 'less than € 450'");
});

test("[BEDRIJFSMIDDEL] the 20% rule: five years is the shortest ordinary life", () => {
  assert.equal(MIN_USEFUL_LIFE_YEARS, 5);
  assert.equal(withinOrdinaryRate(5), true);
  assert.equal(withinOrdinaryRate(4), false);
  assert.equal(withinOrdinaryRate(50), true);
  assert.equal(withinOrdinaryRate(51), false);
  assert.equal(withinOrdinaryRate(5.5), false);
});

test("[BEDRIJFSMIDDEL] impossible inputs are refused, never silently computed", () => {
  assert.throws(() => yearlyDepreciation({ cost: 1000, residualValue: 1200, usefulLifeYears: 5 }), /exceed/);
  assert.throws(() => yearlyDepreciation({ cost: 1000, residualValue: 0, usefulLifeYears: 0 }), /whole number/);
  assert.throws(() => yearlyDepreciation({ cost: -1, residualValue: 0, usefulLifeYears: 5 }), /non-negative/);
  assert.throws(() => depreciationInRange({ ...MACHINE, inUseFrom: "oktober" }, "2026-01-01", "2026-12-31"), /not a date/);
});

// [NEGATIEVE CONTROLE] The rule is not vacuous: change one input and the answer moves the way the
// formula says.
test("[BEDRIJFSMIDDEL] negative control — a shorter life or a lower restwaarde raises the yearly amount", () => {
  assert.equal(yearlyDepreciation({ ...MACHINE, usefulLifeYears: 5 }), 5000);
  assert.equal(yearlyDepreciation({ ...MACHINE, residualValue: 0 }), 3000);
  assert.notEqual(depreciationInRange({ ...MACHINE, inUseFrom: "2026-07-01" }, "2026-01-01", "2026-12-31"), 625);
});

function pad(n: number): string { return String(n).padStart(2, "0"); }
function round(n: number): number { return Math.round(n * 100) / 100; }
