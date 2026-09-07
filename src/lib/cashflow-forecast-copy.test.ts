// [VOORUIT] Run: npx tsx --test src/lib/cashflow-forecast-copy.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { cashflowPanel } from "./cashflow-forecast-copy";
import { forecastCashflow, type ForecastInput } from "./cashflow-forecast";

const base = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today: "2026-09-07",
  bank: { balance: 5_000, asOf: "2026-09-05", partial: false, netSinceAsOf: 0 },
  kas: 250,
  payables: [
    { id: "p1", name: "Sligro", dueDate: "2026-09-10", open: 1_200, incasso: false },
    { id: "p2", name: "Verhuurder", dueDate: "2026-09-12", open: 800, incasso: true },
  ],
  receivables: [
    { id: "r1", name: "Klant A", invoiceDate: "2026-09-01", dueDate: "2026-09-15", open: 600, expectedDays: 10 },
  ],
  takings: { perTradingDay: 100, tradingDaysPerWeek: 7, daysMeasured: 30 },
  ...over,
});

test("[VOORUIT] nothing at all → no panel", () => {
  const f = forecastCashflow(base({
    bank: { balance: null, asOf: null, partial: false, netSinceAsOf: null },
    kas: null, payables: [], receivables: [], takings: null,
  }));
  assert.equal(cashflowPanel(f), null);
});

test("[VOORUIT] the ordinary case names now, the end, and every movement", () => {
  const p = cashflowPanel(forecastCashflow(base()))!;
  assert.ok(p);
  assert.equal(p.horizons.length, 2);
  const week = p.horizons[0];
  assert.equal(week.days, 7);
  assert.match(week.start!.amount, /5\.250/);
  // 5.250 − 2.000 + 600 + 700 takings = 4.550
  assert.match(week.end!.amount, /4\.550/);
  assert.equal(week.end!.short, false);
  assert.equal(week.movements.length, 3);
  assert.match(week.movements[0].amount, /-2\.000/, "what leaves is printed with its minus");
  assert.match(week.movements[0].label, /\(2\)/);
  assert.match(week.incasso!, /800/);
  // On the 10th: 5.250 + 300 takings − 1.200 = 4.350, below the end — so the dip is named.
  assert.match(week.lowest!, /4\.350/);
  assert.match(week.lowest!, /10-09-2026/);
  assert.equal(p.dir, "ltr");
});

test("[VOORUIT] a shortfall is labelled as one and never printed with two minus signs", () => {
  const p = cashflowPanel(forecastCashflow(base({ bank: { balance: 500, asOf: "2026-09-05", partial: false, netSinceAsOf: 0 }, takings: null })))!;
  const week = p.horizons[0];
  assert.equal(week.end!.short, true);
  assert.match(week.end!.label, /Tekort/);
  assert.ok(!week.end!.amount.includes("-") && !week.end!.amount.includes("−"));
  assert.match(week.end!.amount, /650/);
});

test("[VOORUIT] the lowest point gets its own sentence only when it is below the end", () => {
  // Out on the 10th (−1.200) before in on the 11th (+600): the dip is deeper than the end.
  const p = cashflowPanel(forecastCashflow(base({ takings: null, payables: [
    { id: "p1", name: "Sligro", dueDate: "2026-09-10", open: 5_000, incasso: false },
  ] })))!;
  const week = p.horizons[0];
  assert.match(week.lowest!, /10-09-2026/);
  assert.match(week.lowest!, /250/);
});

test("[VOORUIT] an unknown balance renders as an ABSENCE, never as a euro figure", () => {
  const p = cashflowPanel(forecastCashflow(base({ bank: { balance: null, asOf: null, partial: false, netSinceAsOf: null } })))!;
  const week = p.horizons[0];
  assert.equal(week.start, null);
  assert.equal(week.end, null);
  assert.equal(week.lowest, null);
  assert.ok(week.movements.length > 0, "the movements are still stated");
  assert.ok(week.caveats.some((c) => c.includes("banksaldo")));
});

test("[VOORUIT] the counted caveats have a singular and a plural", () => {
  const one = cashflowPanel(forecastCashflow(base({ payables: [
    { id: "p1", name: "X", dueDate: null, open: 100, incasso: false },
  ] })))!;
  assert.ok(one.horizons[0].caveats.some((c) => /^Eén inkoopfactuur/.test(c)), one.horizons[0].caveats.join(" | "));
  const two = cashflowPanel(forecastCashflow(base({ payables: [
    { id: "p1", name: "X", dueDate: null, open: 100, incasso: false },
    { id: "p2", name: "Y", dueDate: null, open: 50, incasso: false },
  ] })))!;
  assert.ok(two.horizons[0].caveats.some((c) => /^2 inkoopfacturen/.test(c) && c.includes("150")));
});

test("[VOORUIT] Arabic gets the words and the direction from the same object", () => {
  const p = cashflowPanel(forecastCashflow(base()), "ar")!;
  assert.equal(p.dir, "rtl");
  assert.ok(/[؀-ۿ]/.test(p.heading));
  assert.ok(/[؀-ۿ]/.test(p.horizons[0].start!.label));
});

test("[VOORUIT] every note code has a sentence, in Dutch", () => {
  const f = forecastCashflow(base({
    bank: { balance: 100, asOf: "2026-01-01", partial: true, netSinceAsOf: 0, accounts: 2 },
    kas: null,
    payables: [{ id: "p", name: "X", dueDate: null, open: 10, incasso: false }],
    receivables: [{ id: "r", name: "Y", invoiceDate: "2026-01-01", dueDate: "2026-01-15", open: 10, expectedDays: null }],
    takings: { perTradingDay: 10, tradingDaysPerWeek: 5, daysMeasured: 3 },
  }));
  const codes = f.horizons[0].notes.map((n) => n.code);
  for (const c of ["bank-partial", "bank-stale", "bank-accounts", "kas-unknown", "payables-undated", "receivables-late", "takings-thin"]) {
    assert.ok(codes.includes(c as never), `expected note ${c}`);
  }
  const p = cashflowPanel(f)!;
  assert.equal(p.horizons[0].caveats.length, codes.length);
  for (const s of p.horizons[0].caveats) assert.ok(!/vooruit\./.test(s), `a key leaked: ${s}`);
});
