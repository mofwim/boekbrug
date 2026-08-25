// src/lib/mollie.test.ts
// [MOLLIE] The pure money deciders. The fail direction under test is REFUSE: a missed payment
// stays visible (the invoice stays open), a wrongly-marked one silences the dunning and
// disappears — the unrecoverable side.
// Run: npx tsx --test src/lib/mollie.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { mollieAmountValue, linkVerdict, linkIsStale } from "./mollie";

test("mollieAmountValue formats to Mollie's exact shape and refuses non-amounts", () => {
  assert.equal(mollieAmountValue(300), "300.00");
  assert.equal(mollieAmountValue(12.345), "12.35");
  assert.equal(mollieAmountValue(0.1 + 0.2), "0.30");
  assert.equal(mollieAmountValue(0), null, "a €0 payment link is a mistake, not a request");
  assert.equal(mollieAmountValue(-25), null, "a creditnota is money back, never a payment link");
  assert.equal(mollieAmountValue(NaN), null);
});

test("linkVerdict marks paid only when id, currency and amount all agree", () => {
  const stored = { linkId: "pl_abc", amountValue: "300.00" };
  assert.deepEqual(
    linkVerdict({ id: "pl_abc", paidAt: "2026-08-25T10:00:00+02:00", amount: { currency: "EUR", value: "300.00" } }, stored),
    { action: "mark_paid", paidAt: "2026-08-25T10:00:00+02:00" },
  );
});

test("linkVerdict answers not_paid for an unpaid link — a doorbell ring is not a payment", () => {
  assert.deepEqual(
    linkVerdict({ id: "pl_abc", paidAt: null, amount: { currency: "EUR", value: "300.00" } }, { linkId: "pl_abc", amountValue: "300.00" }),
    { action: "not_paid" },
  );
});

test("linkVerdict REFUSES on every mismatch, and says why", () => {
  const stored = { linkId: "pl_abc", amountValue: "300.00" };
  const paid = { paidAt: "2026-08-25T10:00:00+02:00" };
  const wrongId = linkVerdict({ id: "pl_other", ...paid, amount: { currency: "EUR", value: "300.00" } }, stored);
  assert.equal(wrongId.action, "refuse", "an answer about another link proves nothing about this invoice");
  const wrongCur = linkVerdict({ id: "pl_abc", ...paid, amount: { currency: "USD", value: "300.00" } }, stored);
  assert.equal(wrongCur.action, "refuse");
  const wrongAmt = linkVerdict({ id: "pl_abc", ...paid, amount: { currency: "EUR", value: "200.00" } }, stored);
  assert.equal(wrongAmt.action, "refuse", "a paid €200 may not settle a €300 ask");
  assert.match((wrongAmt as { reason: string }).reason, /200\.00.*300\.00/, "the refusal names both numbers");
  const noAmt = linkVerdict({ id: "pl_abc", ...paid, amount: null }, stored);
  assert.equal(noAmt.action, "refuse", "no amount on the answer → could not verify → never mark");
});

test("linkIsStale flags a link the moment the open amount moved", () => {
  assert.equal(linkIsStale("300.00", 300), false, "same open amount → reuse");
  assert.equal(linkIsStale("300.00", 200), true, "an instalment shrank the ask → the old link over-asks");
  assert.equal(linkIsStale("300.00", 0), true, "nothing open → no link should stand at all");
});
