// [DAG-UIT-DE-BANK] Run: npx tsx --test src/lib/day-card-takings.test.ts
//
// Every fixture is a real ING description from Kiwi Food Market's statement. The figure this
// produces is offered to an owner as their day's card takings, so the tests are about the two
// ways it could be wrong: counting a net payout as takings, and claiming a day it knows nothing
// about.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cardTakingsForDay } from "./day-card-takings";

// Debit — settles GROSS, keyed by a real takings date, no BRUTO in the text.
const maes = { date: "2026-05-04", amount: 928.02, description: "AFREK. BETAALAUTOMAAT MAES REFNR. F9Q3BH DAT. 20260503/6123 AANT. 60 MREFNR. KFM" };
const vpay = { date: "2026-05-04", amount: 318.87, description: "AFREK. BETAALAUTOMAAT VPAY REFNR. F9Q3BH DAT. 20260503/6123 AANT. 19 MREFNR. KFM" };
// Credit — settles NET and states its own gross. DAT. is a WEEK number, so it keys on booking date.
const mast = { date: "2026-05-04", amount: 206.78, description: "AFREK. BETAALAUTOMAAT MAST REFNR. F9Q3BH DAT. 202618 AANT. 12 BRUTO 21055 /COM D377" };

test("a debit payout counts at what was credited — it settles gross", () => {
  const d = cardTakingsForDay([maes, vpay], "2026-05-03");
  assert.ok(d);
  assert.equal(d.total, 1246.89, "928,02 + 318,87");
  assert.equal(d.lines, 2);
  assert.equal(d.grossStated, 0);
  assert.equal(d.allGrossKnown, false, "nothing proved its gross, so the certainty is not claimed");
});

test("a payout that names a WEEK is placed on no day at all", () => {
  // The bug this replaces: falling back to the booking date pinned a week of credit-card takings
  // onto whichever single day the payout happened to post. Against seven real days of till data
  // that overstated 4 May by € 250,99 while leaving four neighbouring days € 44–122 short.
  const d = cardTakingsForDay([maes, vpay, mast], "2026-05-04");
  assert.equal(d, null, "4 May has no DAT-dated payout of its own here — and mast is not it");
  const earned = cardTakingsForDay([maes, vpay, mast], "2026-05-03");
  assert.ok(earned);
  assert.equal(earned.total, 1246.89, "only the two lines the bank actually dated");
  assert.equal(earned.complete, false, "…and the week-numbered line makes this a floor");
  assert.equal(earned.unplaced, 210.55, "which is stated, at its BRUTO, not hidden");
});

test("a payout that DOES name a day counts at its BRUTO when it states one", () => {
  // 206,78 was paid out; 210,55 was taken. The till counted 210,55.
  const dated = { ...mast, description: mast.description.replace("DAT. 202618", "DAT. 20260504") };
  const d = cardTakingsForDay([dated], "2026-05-04");
  assert.ok(d);
  assert.equal(d.total, 210.55, "not 206,78 — the commission was deducted from the payout");
  assert.equal(d.grossStated, 1);
  assert.equal(d.allGrossKnown, true);
  assert.equal(d.complete, true);
});

test("a day the bank says nothing about is null, never zero", () => {
  // "no card payout for this day" and "the shop took € 0,00 on card" are different facts, and
  // only the owner knows the second one.
  assert.equal(cardTakingsForDay([maes, mast], "2026-01-01"), null);
  assert.equal(cardTakingsForDay([], "2026-05-04"), null);
});

test("a refund on the day lowers the takings rather than being dropped", () => {
  const refund = { date: "2026-05-04", amount: -25.5, description: "AFREK. BETAALAUTOMAAT MAES REFNR. X DAT. 20260503/6199 AANT. 1 MREFNR. KFM" };
  const d = cardTakingsForDay([maes, refund], "2026-05-03");
  assert.equal(d?.total, 902.52, "928,02 − 25,50");
});

test("cents are summed as cents — a busy day does not drift", () => {
  const line = { ...maes, amount: 0.29 };
  const d = cardTakingsForDay(Array.from({ length: 300 }, () => line), "2026-05-03");
  assert.equal(d?.total, 87, "300 × € 0,29 exactly");
});

test("the seven measured days: exact where the bank dated everything, never over", () => {
  // Real ING lines and the real till totals for 1–6 May 2026. The property that matters is not
  // that it always matches — it cannot, because a week-numbered credit payout belongs to no day —
  // but that it is NEVER HIGHER than the till. An owner accepting a prefilled figure can be left
  // short of their own takings and will notice; they cannot be handed revenue they did not make.
  const P = (date: string, amount: number, description: string) => ({ date, amount, description });
  const rows = [
    P("2026-05-01", 274.9, "AFREK. BETAALAUTOMAAT DBMC DAT. 20260430/6120 AANT. 27 MREFNR. KFM"),
    P("2026-05-01", 960.39, "AFREK. BETAALAUTOMAAT MAES DAT. 20260430/6120 AANT. 59 MREFNR. KFM"),
    P("2026-05-01", 278.79, "AFREK. BETAALAUTOMAAT VIDB DAT. 20260430/6120 AANT. 21 MREFNR. KFM"),
    P("2026-05-01", 534.76, "AFREK. BETAALAUTOMAAT VPAY DAT. 20260430/6120 AANT. 35 MREFNR. KFM"),
    P("2026-05-04", 318.87, "AFREK. BETAALAUTOMAAT VPAY DAT. 20260503/6123 AANT. 19 MREFNR. KFM"),
    P("2026-05-04", 206.78, "AFREK. BETAALAUTOMAAT MAST DAT. 202618 AANT. 12 BRUTO 21055 /COM D377"),
    P("2026-05-04", 39.75, "AFREK. BETAALAUTOMAAT VISA DAT. 202618 AANT. 2 BRUTO 4044 /COM D69"),
    P("2026-05-04", 100.19, "AFREK. BETAALAUTOMAAT VIDB DAT. 20260503/6123 AANT. 12 MREFNR. KFM"),
    P("2026-05-04", 227.86, "AFREK. BETAALAUTOMAAT DBMC DAT. 20260503/6123 AANT. 29 MREFNR. KFM"),
    P("2026-05-04", 928.02, "AFREK. BETAALAUTOMAAT MAES DAT. 20260503/6123 AANT. 60 MREFNR. KFM"),
    P("2026-05-05", 288.26, "AFREK. BETAALAUTOMAAT DBMC DAT. 20260504/6124 AANT. 28 MREFNR. KFM"),
    P("2026-05-05", 817.49, "AFREK. BETAALAUTOMAAT MAES DAT. 20260504/6124 AANT. 56 MREFNR. KFM"),
    P("2026-05-05", 233.52, "AFREK. BETAALAUTOMAAT VIDB DAT. 20260504/6124 AANT. 23 MREFNR. KFM"),
    P("2026-05-05", 351.04, "AFREK. BETAALAUTOMAAT VPAY DAT. 20260504/6124 AANT. 25 MREFNR. KFM"),
  ];
  const till: Record<string, number> = { "2026-04-30": 2145.76, "2026-05-03": 1574.94, "2026-05-04": 1690.31 };
  for (const [day, kassa] of Object.entries(till)) {
    const d = cardTakingsForDay(rows, day);
    assert.ok(d, `no figure for ${day}`);
    assert.ok(d.total <= kassa + 0.005, `${day}: ${d.total} may never exceed the till's ${kassa}`);
  }
  assert.equal(cardTakingsForDay(rows, "2026-05-03")?.total, 1574.94, "3 May reproduces the till exactly");
  assert.equal(cardTakingsForDay(rows, "2026-05-04")?.total, 1690.31, "and so does 4 May, which the old fallback overstated by € 250,99");
});

test("a mixed day reports how much of it is beyond doubt", () => {
  const d = cardTakingsForDay([{ ...mast, date: "2026-05-03", description: mast.description.replace("DAT. 202618", "DAT. 20260503") }, maes], "2026-05-03");
  assert.ok(d);
  assert.equal(d.total, 1138.57, "210,55 gross + 928,02 credited");
  assert.equal(d.grossStated, 1);
  assert.equal(d.allGrossKnown, false, "one line rests on the gross-settlement contract, and says so");
});
