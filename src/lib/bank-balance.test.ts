// [BANK-SALDO] Pure node test — run: npx tsx --test src/lib/bank-balance.test.ts
//
// This number goes on the home screen next to "je moet € 58.129 betalen". Every test here is about
// one of the three ways it could be wrong in that context, in order of how much damage each does:
//
//   1. A ZERO where the truth is "unknown". Shown to someone with €58k of debt, that is the most
//      alarming wrong number this app can produce.
//   2. A TOTAL that quietly omits an account. Same error, quieter — the owner reads less money
//      than he has and cannot tell why.
//   3. A DATE that flatters. A sum of a fresh statement and a month-old one is a month old, and
//      dating it by the fresh half makes stale money look like this morning's.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bankBalanceOf, type StatementPeriod } from "./bank-balance";

const p = (over: Partial<StatementPeriod>): StatementPeriod => ({
  iban: "NL01BANK0123456789",
  periodEnd: "2026-07-28",
  closingBalance: 12_500.5,
  ...over,
});

// ── 1. Unknown is never zero ─────────────────────────────────────────

test("[BANK-SALDO] no statements at all → null, never 0", () => {
  assert.deepEqual(bankBalanceOf([]), { balance: null, asOf: null, accounts: 0, partial: false });
  // Defensive: the API degrades its reads, so this can be handed anything.
  assert.equal(bankBalanceOf(null as unknown as StatementPeriod[]).balance, null);
});

test("[BANK-SALDO] statements that declare NO balance → null, and said to be partial", () => {
  // The ordinary CSV case: transactions imported fine, no balance column in the file.
  const r = bankBalanceOf([
    p({ closingBalance: null }),
    p({ closingBalance: null, periodEnd: "2026-06-30" }),
  ]);
  assert.equal(r.balance, null, "unknown, and unknown renders as nothing");
  assert.equal(r.accounts, 0);
  assert.equal(r.partial, true, "there IS an account here — the screen must not act as if there is not");
});

test("[BANK-SALDO] a real zero balance is a real answer and survives", () => {
  // An emptied account states 0,00 in its own file. That is a fact, not a gap, and it must not be
  // swallowed by the same branch that handles "we do not know".
  const r = bankBalanceOf([p({ closingBalance: 0 })]);
  assert.equal(r.balance, 0);
  assert.equal(r.accounts, 1);
  assert.equal(r.partial, false);
});

test("[BANK-SALDO] an overdrawn account keeps its minus", () => {
  const r = bankBalanceOf([p({ closingBalance: -1_240.75 })]);
  assert.equal(r.balance, -1_240.75, "red is information — never an absolute value");
});

// ── 2. Only the newest statement of an account is a balance ──────────

test("[BANK-SALDO] twelve statements of one account are not twelve balances", () => {
  // The bug this prevents: summing every uploaded statement makes the total GROW every month the
  // owner uploads, with no relation whatsoever to his money.
  const r = bankBalanceOf([
    p({ periodEnd: "2026-05-31", closingBalance: 8_000 }),
    p({ periodEnd: "2026-06-30", closingBalance: 9_500 }),
    p({ periodEnd: "2026-07-28", closingBalance: 12_500.5 }),
  ]);
  assert.equal(r.balance, 12_500.5, "the last one IS the balance; the rest are history");
  assert.equal(r.accounts, 1);
  assert.equal(r.asOf, "2026-07-28");
});

test("[BANK-SALDO] upload order does not decide the answer — the date does", () => {
  // Statements arrive out of order all the time (a forgotten month, uploaded later).
  const r = bankBalanceOf([
    p({ periodEnd: "2026-07-28", closingBalance: 12_500.5 }),
    p({ periodEnd: "2026-06-30", closingBalance: 9_500 }),
  ]);
  assert.equal(r.balance, 12_500.5);
});

test("[BANK-SALDO] a statement with a balance but no date cannot be ranked, so it is not used", () => {
  const r = bankBalanceOf([
    p({ periodEnd: "2026-07-28", closingBalance: 12_500.5 }),
    p({ periodEnd: null, closingBalance: 99_999 }),
  ]);
  assert.equal(r.balance, 12_500.5, "an unrankable balance must not silently become 'the newest'");
});

// ── 3. Several accounts, and the date that must not flatter ──────────

test("[BANK-SALDO] two accounts add up, and the total is dated by the STALEST", () => {
  const r = bankBalanceOf([
    p({ iban: "NL01BANK0123456789", periodEnd: "2026-07-28", closingBalance: 12_500.5 }),
    p({ iban: "NL99SPAR9876543210", periodEnd: "2026-06-30", closingBalance: 40_000 }),
  ]);
  assert.equal(r.balance, 52_500.5);
  assert.equal(r.accounts, 2);
  assert.equal(r.asOf, "2026-06-30", "a sum is only as current as its oldest part");
  assert.equal(r.partial, false);
});

test("[BANK-SALDO] an account with no balance anywhere makes the total PARTIAL", () => {
  // The dangerous shape: one bank exports MT940 (has balances), the other CSV (has none). The sum
  // is real but incomplete, and an incomplete sum presented as the whole is a number the owner
  // will act on.
  const r = bankBalanceOf([
    p({ iban: "NL01BANK0123456789", closingBalance: 12_500.5 }),
    p({ iban: "NL99SPAR9876543210", closingBalance: null }),
  ]);
  assert.equal(r.balance, 12_500.5);
  assert.equal(r.accounts, 1);
  assert.equal(r.partial, true, "the screen must be able to say a bank is missing from this total");
});

test("[BANK-SALDO] statements without an IBAN are one account, not dropped", () => {
  // A bank that exports no IBAN is still a bank with money in it. Dropping those would be the same
  // silent under-report this whole file exists to prevent.
  const r = bankBalanceOf([
    p({ iban: null, periodEnd: "2026-06-30", closingBalance: 1_000 }),
    p({ iban: null, periodEnd: "2026-07-28", closingBalance: 1_800 }),
    p({ iban: "   ", periodEnd: "2026-07-31", closingBalance: 2_500 }),
  ]);
  assert.equal(r.accounts, 1, "blank and null are the same unnamed account, not three");
  assert.equal(r.balance, 2_500, "and still only its newest statement counts");
});

test("[BANK-SALDO] cents survive the sum", () => {
  const r = bankBalanceOf([
    p({ iban: "A", closingBalance: 0.1 }),
    p({ iban: "B", closingBalance: 0.2 }),
  ]);
  assert.equal(r.balance, 0.3, "0.1 + 0.2 is money, not floating point");
});

test("[BANK-SALDO] nonsense values are not balances", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, "12500" as unknown as number]) {
    const r = bankBalanceOf([p({ closingBalance: bad })]);
    assert.equal(r.balance, null, `${String(bad)} is not a balance`);
    assert.equal(r.partial, true, "and the account it belongs to is still reported as missing");
  }
});
