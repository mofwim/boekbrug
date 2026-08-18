// [BTW-RESERVERING] Run: npx tsx --test src/lib/btw-reservation.test.ts
//
// Every rule in btw-reservation.ts leans deliberately one way. A test that only checked the
// arithmetic would pass just as happily on the version that leans the other way — which is the
// version that tells an owner they have money they do not have. So each case below pins the
// DIRECTION, and says which way the failure would run.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeBtwReservation,
  btwDeadline,
  stillOwed,
  withDeadline,
  quarterOfDate,
  quartersBefore,
  STALE_BALANCE_DAYS,
  type QuarterPosition,
} from "./btw-reservation";

const quarterAt = (p: Partial<QuarterPosition> & { year: number; quarter: 1 | 2 | 3 | 4 }): QuarterPosition => ({
  key: `${p.year}-Q${p.quarter}`,
  balance: 0,
  filed: false,
  ...p,
});

const input = (over: Partial<Parameters<typeof computeBtwReservation>[0]>) =>
  computeBtwReservation({
    balance: 10_000,
    balanceAsOf: "2026-05-05",
    balanceIncomplete: false,
    quarters: [],
    today: "2026-05-05",
    ...over,
  });

// ─── The deadline ────────────────────────────────────────────────────────────────────

test("[BTW-RESERVERING] the four quarterly deadlines, Q4 in the FOLLOWING year", () => {
  assert.equal(btwDeadline(2026, 1), "2026-04-30");
  assert.equal(btwDeadline(2026, 2), "2026-07-31");
  assert.equal(btwDeadline(2026, 3), "2026-10-31");
  // The one that gets written wrong. Stated as 2026-01-31 it is a date eleven months in the past,
  // and every owner with a perfectly timely Q4 would be told their aangifte is late.
  assert.equal(btwDeadline(2026, 4), "2027-01-31");
});

test("[BTW-RESERVERING] 29 February falls inside Q1, so a leap day is never outside every quarter", () => {
  const p = withDeadline(quarterAt({ year: 2028, quarter: 1 }), "2028-02-29");
  assert.equal(p.running, true, "a payment dated on the leap day belongs to a quarter like any other");
});

// ─── Which quarters still have to be paid ────────────────────────────────────────────

test("[BTW-RESERVERING] a running quarter is always still owed — nobody paid a quarter that has not ended", () => {
  const p = withDeadline(quarterAt({ year: 2026, quarter: 2, balance: 900 }), "2026-05-05");
  assert.equal(p.running, true);
  assert.equal(stillOwed(p), true);
});

test("[BTW-RESERVERING] an ended quarter whose deadline is still ahead stays reserved", () => {
  // 20 April: Q1 is over, the 30th has not arrived. The owner may have paid it already, in which
  // case this reserves money that is gone — over-reserving, which is the direction you survive.
  const p = withDeadline(quarterAt({ year: 2026, quarter: 1, balance: 1_400, filed: true }), "2026-04-20");
  assert.equal(p.running, false);
  assert.ok(p.days > 0);
  assert.equal(stillOwed(p), true);
});

test("[BTW-RESERVERING] filed AND past its deadline is assumed settled — else the figure grows forever", () => {
  // Without this the reserved amount gains a quarter every quarter, for an owner who has done
  // everything right. A number that only ever climbs is not merely useless, it teaches its reader
  // to dismiss it — and then it is not there on the day it matters.
  const p = withDeadline(quarterAt({ year: 2026, quarter: 1, balance: 1_400, filed: true }), "2026-05-05");
  assert.ok(p.days < 0);
  assert.equal(stillOwed(p), false);
});

test("[BTW-RESERVERING] past its deadline and NEVER filed is still owed — this is the owner in trouble", () => {
  // The case a plain "past due → drop it" would go silent on, which is exactly backwards: there is
  // not even a declaration yet, so the money is unambiguously still there to be paid.
  const p = withDeadline(quarterAt({ year: 2026, quarter: 1, balance: 1_400, filed: false }), "2026-05-05");
  assert.equal(stillOwed(p), true);

  const r = input({ quarters: [quarterAt({ year: 2026, quarter: 1, balance: 1_400, filed: false })] });
  assert.equal(r.reserved, 1_400);
  assert.ok(r.notes.includes("return-overdue"), "and it says so, rather than only counting it");
});

// ─── The sums ────────────────────────────────────────────────────────────────────────

test("[BTW-RESERVERING] free to spend is the balance minus what is owed", () => {
  const r = input({
    balance: 10_000,
    quarters: [quarterAt({ year: 2026, quarter: 2, balance: 2_100 })],
  });
  assert.equal(r.reserved, 2_100);
  assert.equal(r.free, 7_900);
  assert.equal(r.state, "covered");
});

test("[BTW-RESERVERING] a shortfall is named a shortfall", () => {
  // The sentence the whole module exists to be able to say.
  const r = input({ balance: 1_500, quarters: [quarterAt({ year: 2026, quarter: 2, balance: 2_100 })] });
  assert.equal(r.free, -600);
  assert.equal(r.state, "short");
});

test("[BTW-RESERVERING] an expected refund is NEVER money you can spend", () => {
  // The Belastingdienst has not paid it, and may settle it against something else entirely.
  // Counted as available it would raise `free` by exactly the amount the owner does not have.
  const r = input({ balance: 1_000, quarters: [quarterAt({ year: 2026, quarter: 2, balance: -800 })] });
  assert.equal(r.refundExpected, 800);
  assert.equal(r.reserved, 0);
  assert.equal(r.free, 1_000, "the refund did not raise this by a cent");
  assert.ok(r.notes.includes("refund-separate"));
});

test("[BTW-RESERVERING] a refund in one quarter does not pay off a debt in another", () => {
  // Netting them would report 'gedekt' on the strength of money that has not arrived, while the
  // Belastingdienst collects the one and pays the other on its own schedule.
  const r = input({
    balance: 1_000,
    today: "2026-05-05",
    quarters: [
      quarterAt({ year: 2026, quarter: 1, balance: -900, filed: false }), // late, a refund
      quarterAt({ year: 2026, quarter: 2, balance: 1_600 }),                  // running, a debt
    ],
  });
  assert.equal(r.reserved, 1_600, "the debt is not reduced by the refund");
  assert.equal(r.refundExpected, 900);
  assert.equal(r.state, "short");
});

// ─── What it refuses to claim ────────────────────────────────────────────────────────

test("[BTW-RESERVERING] no balance means NO free figure — not a reassuring zero", () => {
  // A € 0,00 where a real balance belongs is the reassuring lie this codebase refuses everywhere
  // else, and it would be worst here: on the number meant to prevent a shortfall.
  const r = input({ balance: null, quarters: [quarterAt({ year: 2026, quarter: 2, balance: 2_100 })] });
  assert.equal(r.free, null);
  assert.equal(r.state, "unknown");
  assert.notEqual(r.free, 0);
  assert.ok(r.notes.includes("balance-unknown"));
  assert.equal(r.reserved, 2_100, "what is OWED is still known and still said");
});

test("[BTW-RESERVERING] an incomplete balance total is flagged — `free` is then too low", () => {
  const r = input({ balanceIncomplete: true, quarters: [quarterAt({ year: 2026, quarter: 2, balance: 100 })] });
  assert.ok(r.notes.includes("balance-incomplete"));
});

test("[BTW-RESERVERING] a stale balance describes a past day, and says so", () => {
  const fresh = input({ balanceAsOf: "2026-05-01", today: "2026-05-05" });
  assert.ok(!fresh.notes.includes("balance-stale"));

  const stale = input({ balanceAsOf: "2026-04-01", today: "2026-05-05" });
  assert.ok(stale.notes.includes("balance-stale"));
  assert.ok(STALE_BALANCE_DAYS > 0);
});

test("[BTW-RESERVERING] a running quarter's figure is labelled as still moving", () => {
  const r = input({ today: "2026-05-05", quarters: [quarterAt({ year: 2026, quarter: 2, balance: 700 })] });
  assert.ok(r.notes.includes("quarter-running"));
});

test("[BTW-RESERVERING] unverified purchase invoices mean the reserved amount is knowingly too high", () => {
  // Their voorbelasting is not deducted yet, so this over-reserves. Survivable — but a figure
  // nobody can reproduce is not trusted a second time, so it is stated.
  const r = input({
    quarters: [quarterAt({ year: 2026, quarter: 2, balance: 900, unverifiedPurchases: 3 })],
  });
  assert.ok(r.notes.includes("purchases-unverified"));
});

// ─── Ordering ────────────────────────────────────────────────────────────────────────

test("[BTW-RESERVERING] the nearest deadline comes first, and it is what the screen counts down to", () => {
  const r = input({
    today: "2026-05-05",
    quarters: [
      quarterAt({ year: 2026, quarter: 2, balance: 800 }),                   // running, due 31 July
      quarterAt({ year: 2026, quarter: 1, balance: 1_200, filed: false }), // late, due 30 April
    ],
  });
  assert.equal(r.nextDue?.key, "2026-Q1");
  assert.deepEqual(r.quarters.map((p) => p.key), ["2026-Q1", "2026-Q2"]);
  assert.equal(r.reserved, 2_000);
});

test("[BTW-RESERVERING] nothing owed is an ordinary, complete answer", () => {
  const r = input({ quarters: [] });
  assert.equal(r.reserved, 0);
  assert.equal(r.free, 10_000);
  assert.equal(r.state, "covered");
  assert.equal(r.nextDue, null);
  assert.deepEqual(r.notes, []);
});

// ─── The quarter arithmetic the route walks back on ──────────────────────────────────

test("[BTW-RESERVERING] which quarter a date falls in", () => {
  assert.deepEqual(quarterOfDate("2026-01-01"), { year: 2026, quarter: 1 });
  assert.deepEqual(quarterOfDate("2026-03-31"), { year: 2026, quarter: 1 });
  assert.deepEqual(quarterOfDate("2026-04-01"), { year: 2026, quarter: 2 });
  assert.deepEqual(quarterOfDate("2026-12-31"), { year: 2026, quarter: 4 });
});

test("[BTW-RESERVERING] walking back over the year boundary lands on the right quarter", () => {
  // The off-by-one here does not throw. It quietly reports a different quarter's tax debt.
  assert.deepEqual(quartersBefore(2026, 1, 1), { year: 2025, quarter: 4 });
  assert.deepEqual(quartersBefore(2026, 1, 2), { year: 2025, quarter: 3 });
  assert.deepEqual(quartersBefore(2026, 1, 3), { year: 2025, quarter: 2 });
  assert.deepEqual(quartersBefore(2026, 2, 3), { year: 2025, quarter: 3 });
  assert.deepEqual(quartersBefore(2026, 4, 0), { year: 2026, quarter: 4 });
  assert.deepEqual(quartersBefore(2026, 1, 4), { year: 2025, quarter: 1 });
});
