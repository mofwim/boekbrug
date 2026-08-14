// [KAS-BRUG] Pure node test — run: npx tsx --test src/lib/cash-transfer-match.test.ts
//
// Same pairing discipline as money-invariants.test.ts: every finding next to the innocent case that
// looks just like it. This one earns it twice over, because it fires INSIDE an accusation — the app
// has already refused a BTW-aangifte over a negative drawer when this runs. A false finding here does
// not merely annoy: it sends an owner looking for a withdrawal that is already in their cash book,
// while the real cause of the blocked filing goes unexamined.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findUnrecordedCashWithdrawals, CASH_TRANSFER_DAY_WINDOW } from "./cash-transfer-match";
import { isCashTransferDescription } from "./bank-identity";

const line = (id: string, date: string, amount: number, description = "Geldautomaat GEA Amsterdam") =>
  ({ id, date, amount, description });

test("[KAS-BRUG] a withdrawal with no opname in the drawer is named, with its day and amount", () => {
  const found = findUnrecordedCashWithdrawals({
    bankLines: [line("b1", "2026-05-03", -500)],
    drawerTransfers: [],
  });
  assert.equal(found.length, 1);
  assert.deepEqual(
    { ...found[0] },
    { bankLineId: "b1", date: "2026-05-03", amount: 500, description: "Geldautomaat GEA Amsterdam" },
  );
});

test("[KAS-BRUG] …and one the owner DID book is silent", () => {
  // The ordinary case. This must stay quiet or the finding is worthless: it appears under a red
  // banner, so anything that fires on a correct cash book actively misdirects.
  assert.deepEqual(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", -500)],
      drawerTransfers: [{ date: "2026-05-03", direction: "in", amount: 500 }],
    }),
    [],
  );
});

test("[KAS-BRUG] a few days between the machine and the booking is the same event", () => {
  // Cash withdrawn on Friday and written up on Monday is one movement, not two — and a statement
  // date is not always the day the machine dispensed.
  for (const drawerDate of ["2026-05-01", "2026-05-06"]) {
    assert.deepEqual(
      findUnrecordedCashWithdrawals({
        bankLines: [line("b1", "2026-05-03", -500)],
        drawerTransfers: [{ date: drawerDate, direction: "in", amount: 500 }],
      }),
      [],
      `${drawerDate} is inside the ${CASH_TRANSFER_DAY_WINDOW}-day window`,
    );
  }
  // Beyond it they are two different events, and excusing one with the other would point the owner
  // at the wrong week.
  assert.equal(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", -500)],
      drawerTransfers: [{ date: "2026-05-09", direction: "in", amount: 500 }],
    }).length,
    1,
  );
});

test("[KAS-BRUG] one opname excuses exactly ONE withdrawal", () => {
  // A shop that withdraws the same round amount every week is where this finding matters most, and
  // it is exactly where a many-to-one match would hide it: one €500 entry would excuse all four.
  const found = findUnrecordedCashWithdrawals({
    bankLines: [line("b1", "2026-05-04", -500), line("b2", "2026-05-11", -500), line("b3", "2026-05-18", -500)],
    drawerTransfers: [{ date: "2026-05-11", direction: "in", amount: 500 }],
  });
  assert.deepEqual(found.map((f) => f.bankLineId), ["b1", "b3"], "the booked week is excused, the other two are not");
});

test("[KAS-BRUG] the closest entry pairs, so a later withdrawal keeps the one it needs", () => {
  // Two withdrawals, two entries, one day apart each. Taking the FIRST match rather than the nearest
  // would consume 05-04's entry for the 05-02 line and report a false finding on the other.
  assert.deepEqual(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-02", -200), line("b2", "2026-05-05", -200)],
      drawerTransfers: [
        { date: "2026-05-02", direction: "in", amount: 200 },
        { date: "2026-05-05", direction: "in", amount: 200 },
      ],
    }),
    [],
  );
});

test("[KAS-BRUG] only withdrawals, and only 'in' drawer entries, count", () => {
  // A DEPOSIT (credit) cannot leave a drawer short — it makes the book higher, not lower — so it is
  // not this function's question. See the header for why that asymmetry is deliberate.
  assert.deepEqual(
    findUnrecordedCashWithdrawals({ bankLines: [line("b1", "2026-05-03", 500)], drawerTransfers: [] }),
    [],
  );
  // A storting ('out') is the wrong direction to account for a withdrawal: both took cash OUT of
  // the till, so pairing them would excuse a shortage with a second shortage.
  assert.equal(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", -500)],
      drawerTransfers: [{ date: "2026-05-03", direction: "out", amount: 500 }],
    }).length,
    1,
  );
});

test("[KAS-BRUG] a different amount does not excuse it, and a rounding cent does", () => {
  assert.equal(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", -500)],
      drawerTransfers: [{ date: "2026-05-03", direction: "in", amount: 450 }],
    }).length,
    1,
    "€450 booked against a €500 withdrawal leaves €50 unexplained — that is still a finding",
  );
  assert.deepEqual(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", -500.004)],
      drawerTransfers: [{ date: "2026-05-03", direction: "in", amount: 500 }],
    }),
    [],
    "float dust is not a difference",
  );
});

test("[KAS-BRUG] unusable rows are skipped, never guessed", () => {
  // No date = nothing to place against a drawer day; €0 = not a movement. Skipping is the safe
  // direction here: this list appears as an accusation's explanation, so an invented entry in it is
  // worse than a missing one.
  assert.deepEqual(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", 0), { id: "b2", date: null, amount: -500, description: "x" }],
      drawerTransfers: [],
    }),
    [],
  );
  // A drawer entry with no date cannot excuse anything either — it is not on any day.
  assert.equal(
    findUnrecordedCashWithdrawals({
      bankLines: [line("b1", "2026-05-03", -500)],
      drawerTransfers: [{ date: null, direction: "in", amount: 500 }],
    }).length,
    1,
  );
});

test("[KAS-BRUG] oldest first — the earliest gap is where the running balance starts drifting", () => {
  const found = findUnrecordedCashWithdrawals({
    bankLines: [line("b2", "2026-06-20", -100), line("b1", "2026-04-02", -300)],
    drawerTransfers: [],
  });
  assert.deepEqual(found.map((f) => f.date), ["2026-04-02", "2026-06-20"]);
});

test("[KAS-BRUG] the bank half is recognised by the classifier's own patterns, not a copy", () => {
  // The stored category cannot answer this: savings transfers and cash machines both land on
  // 'transfer'. So the text is asked, against the SAME regex classifyBankTransaction uses — a second
  // copy would drift and then disagree with the classifier about the same line.
  for (const text of ["Geldautomaat Rabobank Utrecht", "GEA NR:12345 03.05.26/14.22", "Geldopname kantoor", "Contante opname balie", "Cash opname"]) {
    assert.ok(isCashTransferDescription(text), `${text} must read as a cash movement`);
  }
  // A savings transfer is not a drawer movement, and neither is a recording studio invoice — the
  // exact false positive [ATM-NARROW] in bank-identity.ts was written to kill.
  for (const text of ["Overboeking naar spaarrekening", "Opname studio sessie", "Kruispost eigen rekening", "Opname videoclip"]) {
    assert.ok(!isCashTransferDescription(text), `${text} must NOT read as a cash movement`);
  }
});
