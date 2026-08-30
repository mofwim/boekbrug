// [COM-IN-DE-REGEL] Run: npx tsx --test src/lib/card-panel.test.ts
//
// The case that matters is the fourth one: a real shop, its commission booked into kosten, and
// both of these answering false. Every other test here exists to stop the fix from being a blanket
// "always show", which would undo [NO-ZERO-LEAD].

import { test } from "node:test";
import assert from "node:assert/strict";
import { cardPanelVisible, cardStatsVisible, type CardPanelFacts } from "./card-panel";

const none: CardPanelFacts = {
  eftSettlements: 0, totalCommission: 0, grossMismatchDays: 0,
  incompleteDays: 0, commissionIssueDays: 0, statedCommission: null,
};

test("a window with no card activity keeps both closed", () => {
  assert.equal(cardPanelVisible(none), false);
  assert.equal(cardStatsVisible(none), false, "[NO-ZERO-LEAD] no '€ 0,00' as a first impression");
});

test("a terminal settlement opens both, as it always did", () => {
  const rec = { ...none, eftSettlements: 12, totalCommission: 88.5 };
  assert.equal(cardPanelVisible(rec), true);
  assert.equal(cardStatsVisible(rec), true);
});

test("a bank-stated commission opens both — the case that was missing", () => {
  // Kiwi Food Market, Q2 2026: zero terminal settlements, zero triangle commission, € 54,02 booked
  // into kosten from its own bank lines. Every old condition was false, so the panel explaining
  // that cost did not exist on the screen.
  const rec = { ...none, statedCommission: { total: 54.02, unverified: 0 } };
  assert.equal(cardPanelVisible(rec), true, "the cost is in the figures, so it must be explainable");
  assert.equal(cardStatsVisible(rec), true);
});

test("unreadable settlement lines open the panel but print no figures", () => {
  // Nothing proved itself, so there is no number — but three lines the app could not read is
  // exactly what the owner needs telling, and silence would be the wrong answer.
  const rec = { ...none, statedCommission: { total: 0, unverified: 3 } };
  assert.equal(cardPanelVisible(rec), true);
  assert.equal(cardStatsVisible(rec), false, "an unreadable line is not a measurement");
});

test("an incomplete or mismatched day opens the panel without figures", () => {
  assert.equal(cardPanelVisible({ ...none, incompleteDays: 2 }), true);
  assert.equal(cardStatsVisible({ ...none, incompleteDays: 2 }), false);
  assert.equal(cardPanelVisible({ ...none, grossMismatchDays: 1 }), true);
  assert.equal(cardPanelVisible({ ...none, commissionIssueDays: 1 }), true);
});

test("a response from before this feature still decides correctly", () => {
  const legacy = { eftSettlements: 4, totalCommission: 10, grossMismatchDays: 0, incompleteDays: 0, commissionIssueDays: 0 };
  assert.equal(cardPanelVisible(legacy), true, "an absent statedCommission is not a crash");
  assert.equal(cardStatsVisible(legacy), true);
  assert.equal(cardPanelVisible({ ...legacy, eftSettlements: 0, totalCommission: 0 }), false);
});
