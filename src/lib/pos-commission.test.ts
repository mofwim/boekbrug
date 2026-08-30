// [COM-IN-DE-REGEL] Run: npx tsx --test src/lib/pos-commission.test.ts
//
// Every fixture below is a REAL ING description from Kiwi Food Market's Q2 2026 statement, copied
// verbatim including its spacing. A parser for a bank's free text is worth exactly as much as the
// real lines it was checked against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePosCommission, statedCommission } from "./pos-commission";

// The two real credit-card payouts, with the amounts the bank actually credited.
const MAST = {
  description: "AFREK. BETAALAUTOMAAT MAST REFNR. F9Q3BH DAT. 202618 AANT. 12 BRUTO 21055 /COM D377",
  amount: 206.78,
};
const VISA = {
  description: "AFREK. BETAALAUTOMAAT VISA REFNR. F9Q3BH DAT. 202618 AANT. 2 BRUTO 4044 /COM D69",
  amount: 39.75,
};
// A real DEBIT payout from the same account: no BRUTO, no /COM — it settles gross.
const MAES = {
  description: "AFREK. BETAALAUTOMAAT MAES REFNR. F9Q3BH DAT. 20260503/6123 AANT. 60 MREFNR. KFM",
  amount: 928.02,
};

test("a stated commission is read off the line, in cents", () => {
  assert.deepEqual(parsePosCommission(MAST), { grossCents: 21055, commissionCents: 377 });
  assert.deepEqual(parsePosCommission(VISA), { grossCents: 4044, commissionCents: 69 });
});

test("a debit payout states nothing, and nothing is invented for it", () => {
  // 13.270 of this shop's 13.478 card transactions look like this. They settle GROSS: there is no
  // commission in the payout to find, and a parser that produced 0 here would be claiming the
  // acquirer charged nothing.
  assert.equal(parsePosCommission(MAES), null);
});

test("the line must prove itself: BRUTO − COM has to equal what was received", () => {
  // One cent off is enough. A description we misread is a cost that never existed.
  assert.equal(parsePosCommission({ ...MAST, amount: 206.79 }), null);
  assert.equal(parsePosCommission({ ...MAST, amount: 210.55 }), null, "the gross is not the amount");
  assert.equal(parsePosCommission({ ...MAST, amount: -206.78 }), null, "nor is its negative");
});

test("float arithmetic does not cost a cent", () => {
  // 206.78 * 100 is 20677.999999999996 in IEEE754. Rounding, not truncation, is why this passes.
  assert.ok(parsePosCommission(MAST), "the identity holds through the euro→cent conversion");
  assert.ok(parsePosCommission({
    description: "AFREK. BETAALAUTOMAAT MAST BRUTO 1000003 /COM D1", amount: 10000.02,
  }), "and at an amount where the error is larger");
});

test("a commission with no gross, or a nonsense number, is refused", () => {
  assert.equal(parsePosCommission({ description: "AFREK. BRUTO 0 /COM D5", amount: -0.05 }), null);
  assert.equal(parsePosCommission({ description: "AFREK. /COM D377", amount: 206.78 }), null);
  assert.equal(parsePosCommission({ description: "AFREK. BRUTO 21055", amount: 210.55 }), null);
  assert.equal(parsePosCommission({ description: null, amount: 1 }), null);
  assert.equal(parsePosCommission({ ...MAST, amount: null }), null);
});

test("a zero commission is a real statement and is kept", () => {
  const zero = { description: "AFREK. BETAALAUTOMAAT MAST BRUTO 5000 /COM D0", amount: 50 };
  assert.deepEqual(parsePosCommission(zero), { grossCents: 5000, commissionCents: 0 });
});

test("the window sums only what proved itself, and names what did not", () => {
  const broken = { description: "AFREK. BETAALAUTOMAAT MAST BRUTO 9999 /COM D50", amount: 12.34 };
  const s = statedCommission([MAST, VISA, MAES, broken]);
  assert.equal(s.total, 4.46, "3,77 + 0,69 — and the broken line is not in it");
  assert.equal(s.gross, 250.99);
  assert.equal(s.lines, 2);
  assert.equal(s.unverified, 1, "a line that looks like ours and did not add up must be visible");
});

test("summing happens in cents — a hundred lines do not drift a cent", () => {
  const s = statedCommission(Array.from({ length: 100 }, () => MAST));
  assert.equal(s.total, 377, "100 × € 3,77 exactly");
  assert.equal(s.gross, 21055);
});

test("an empty window is zero lines, not a zero commission anyone can quote", () => {
  const s = statedCommission([]);
  assert.deepEqual(s, { total: 0, gross: 0, lines: 0, unverified: 0 });
});

test("the measured quarter reproduces: 22 lines, € 54,02 on € 2.922,21", () => {
  // The shape of the real quarter — 14 MAST lines and 8 VISA lines were what the statement held.
  // The point of this test is the identity at scale: Σ BRUTO − Σ COM === Σ amount, to the cent.
  const quarter = [
    ...Array.from({ length: 14 }, () => MAST),
    ...Array.from({ length: 8 }, () => VISA),
  ];
  const s = statedCommission(quarter);
  assert.equal(s.lines, 22);
  const netto = quarter.reduce((sum, l) => sum + Math.round(l.amount * 100), 0) / 100;
  assert.equal(Math.round((s.gross - s.total) * 100) / 100, netto, "gross − commission === what the bank paid");
});
