// [GEVONDEN] Run: npx tsx --test src/lib/found-money.test.ts
//
// Two failure modes are worse here than being wrong by a euro. Claiming money the owner does not
// have — this figure is a COST, and a screen that reads "gevonden € 340" as if it were income is
// the one framing MARKTPOSITIE_2026.md §5 explicitly warns against. And rendering an absence as a
// zero, which on a screen is indistinguishable from "we checked and your books are clean".

import { test } from "node:test";
import assert from "node:assert/strict";
import { foundMoney } from "./found-money";
import type { RangeResult } from "./result-range-assemble";

/** A RangeResult carrying only what foundMoney reads. */
function range(recon: Partial<RangeResult["reconciliation"]> = {}, scheme: "factuur" | "kas" = "factuur"): RangeResult {
  return {
    result: {} as RangeResult["result"],
    datelessVerifiedCount: 0, undatedPaidCount: 0, estimatedPortionCount: 0,
    unconfirmedIncomingCount: 0, scheme, spansSchemeChange: false, schemeSince: null,
    reconciliation: {
      totalCommission: 0, commissionBooked: 0, acquirerFeeInvoices: 0,
      grossMismatchDays: 0, incompleteDays: 0, commissionIssueDays: 0,
      eftSettlements: 0, pinLedgerAvailable: true, ...recon,
    },
  };
}

test("no terminal settlement is an absence, never a zero", () => {
  const f = foundMoney(range({ eftSettlements: 0 }));
  assert.equal(f.amount, null, "an absent figure must be absent, not € 0,00");
  assert.equal(f.absence, "no_card_takings");
  assert.equal(f.settlements, 0);
});

test("legs that ran and agreed report 'nothing hidden' — a different fact from 'we did not look'", () => {
  const f = foundMoney(range({ eftSettlements: 12, totalCommission: 0, commissionBooked: 0 }));
  assert.equal(f.amount, null);
  assert.equal(f.absence, "nothing_found", "not no_card_takings — the check DID run");
});

test("a booked commission is the figure, and it rests on a stated number of settlements", () => {
  const f = foundMoney(range({ eftSettlements: 90, totalCommission: 341.27, commissionBooked: 341.27 }));
  assert.equal(f.amount, 341.27);
  assert.equal(f.absence, null);
  assert.equal(f.settlements, 90);
  assert.equal(f.complete, true, "no caveat, so the figure is the whole story");
});

test("under kas it is measured and NOT claimed as booked", () => {
  // The scheme is the SECOND argument of `range`, not of foundMoney. Writing
  // `foundMoney(range({...}), "kas")` compiles under tsx --test, which does not typecheck, and
  // silently leaves the fixture on factuur — the test then passes for the wrong reason.
  const f = foundMoney(range({ eftSettlements: 90, totalCommission: 341.27, commissionBooked: 0 }, "kas"));
  assert.equal(f.amount, null, "never presented as booked — the result does not contain it");
  assert.equal(f.absence, "not_booked_under_kas");
  assert.equal(f.measured, 341.27, "but the owner still gets to see what it was");
});

test("what was already booked by the owner is not re-counted as a finding", () => {
  // The acquirer's own invoice covers most of the commission; only the delta was auto-booked.
  const f = foundMoney(range({
    eftSettlements: 40, totalCommission: 400, commissionBooked: 25, acquirerFeeInvoices: 375,
  }));
  assert.equal(f.amount, 25, "the finding is the delta, never the gross commission");
  assert.equal(f.measured, 400, "while the measurement stays what it was");
});

test("every caveat is reported, and each one means the figure is a FLOOR", () => {
  const f = foundMoney(range({
    eftSettlements: 60, totalCommission: 200, commissionBooked: 200,
    pinLedgerAvailable: false, commissionIssueDays: 3, incompleteDays: 2, grossMismatchDays: 1,
  }));
  assert.equal(f.amount, 200);
  assert.equal(f.complete, false, "the figure is not the whole story and must not read as it");
  assert.deepEqual(f.caveats, {
    pinLedgerMissing: true, suspectDays: 3, incompleteDays: 2, grossMismatchDays: 1,
  });
});

test("a negative or nonsensical booked amount never becomes a finding", () => {
  const f = foundMoney(range({ eftSettlements: 10, totalCommission: 5, commissionBooked: -5 }));
  assert.equal(f.amount, null);
  assert.equal(f.absence, "nothing_found");
});
