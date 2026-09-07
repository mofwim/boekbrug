// src/lib/cashflow-forecast.test.ts — run: npx tsx --test src/lib/cashflow-forecast.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastCashflow, takingsFromTillDays, outflowDate, expectedInflowDate, isLateReceivable, type ForecastInput } from "./cashflow-forecast";

const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.005;
const base = (): ForecastInput => ({
  today: "2026-09-07",
  bank: { balance: 5000, asOf: "2026-09-05", partial: false, netSinceAsOf: -200 },
  kas: 800,
  payables: [
    { id: "a", name: "HVO Meat", dueDate: "2026-09-10", open: 2500, incasso: false },
    { id: "b", name: "Energie", dueDate: "2026-09-12", open: 400, incasso: true },
    { id: "c", name: "Enka", dueDate: "2026-10-01", open: 1559.97, incasso: false },
    { id: "d", name: "Overdue", dueDate: "2026-08-30", open: 300, incasso: false },
  ],
  receivables: [
    { id: "r1", name: "Vermeulen", invoiceDate: "2026-09-01", dueDate: "2026-09-15", open: 1210, expectedDays: null },
    { id: "r2", name: "Slow BV", invoiceDate: "2026-09-01", dueDate: "2026-09-15", open: 1000, expectedDays: 40 },
    { id: "r3", name: "Late", invoiceDate: "2026-07-01", dueDate: "2026-07-15", open: 500, expectedDays: null },
  ],
  takings: { perTradingDay: 1900, tradingDaysPerWeek: 7, daysMeasured: 56 },
});

test("[VOORUIT] start = last statement + lines since + drawer; 7 days books what falls inside, 30 days the rest", () => {
  const f = forecastCashflow(base());
  const [d7, d30] = f.horizons;
  assert.ok(near(d7.start, 5000 - 200 + 800), "bank as of the statement, moved by the lines since, plus the drawer");
  assert.equal(d7.outCount, 3, "a, b and the overdue d (today) — Enka is due 1 October");
  assert.ok(near(d7.out, 2500 + 400 + 300));
  assert.ok(near(d7.outIncasso, 400));
  assert.equal(d7.inCount, 0, "Vermeulen is due 15 September — outside seven days; Slow BV pays in 40; Late is late");
  assert.ok(near(d7.inTakings, 1900 * 7));
  assert.ok(near(d7.end, 5600 - 3200 + 13300));
  assert.equal(d30.outCount, 4);
  assert.equal(d30.inCount, 1, "Vermeulen by due date; Slow BV's 40-day pace lands on 11 October, outside 30 days");
  assert.ok(near(d30.inInvoices, 1210));
});

test("[VOORUIT] the lowest point is found inside the horizon, not just the end", () => {
  const i = base(); i.takings = null; i.bank.netSinceAsOf = 0; i.kas = 0;
  i.payables = [{ id: "big", name: "X", dueDate: "2026-09-09", open: 6000, incasso: false }];
  i.receivables = [{ id: "r", name: "Y", invoiceDate: "2026-09-01", dueDate: "2026-09-11", open: 3000, expectedDays: null }];
  const d7 = forecastCashflow(i).horizons[0];
  assert.ok(near(d7.end, 5000 - 6000 + 3000));
  assert.deepEqual(d7.lowest, { date: "2026-09-09", balance: -1000 }, "two days in the red before the client pays");
});

test("[VOORUIT] an unknown bank balance gives movements but never an end balance", () => {
  const i = base(); i.bank = { balance: null, asOf: null, partial: false, netSinceAsOf: null };
  const d7 = forecastCashflow(i).horizons[0];
  assert.equal(d7.start, null); assert.equal(d7.end, null); assert.equal(d7.lowest, null);
  assert.ok(d7.out > 0 && d7.inTakings > 0, "the movements are still worth knowing");
  assert.ok(d7.notes.some((n) => n.code === "bank-unknown"));
});

test("[VOORUIT] what is not counted is named: undated purchases, late clients, a stale or partial balance, a thin average", () => {
  const i = base();
  i.bank.asOf = "2026-08-01"; i.bank.partial = true;
  i.payables = [...i.payables, { id: "u", name: "Zonder datum", dueDate: null, open: 750, incasso: false }];
  i.takings = { perTradingDay: 1000, tradingDaysPerWeek: 6, daysMeasured: 9 };
  i.kas = null;
  const d7 = forecastCashflow(i).horizons[0];
  const codes = d7.notes.map((n) => n.code);
  assert.deepEqual(codes.sort(), ["bank-partial", "bank-stale", "kas-unknown", "payables-undated", "receivables-late", "takings-thin"].sort());
  const undated = d7.notes.find((n) => n.code === "payables-undated") as { count: number; amount: number };
  assert.deepEqual([undated.count, undated.amount], [1, 750]);
  const late = d7.notes.find((n) => n.code === "receivables-late") as { count: number; amount: number };
  assert.deepEqual([late.count, late.amount], [1, 500]);
  assert.ok(near(d7.out, 3200), "the undated purchase is not in the number");
  assert.ok(near(d7.start, 4800), "no drawer → the start is the bank alone, and the note says so");
  assert.ok(near(d7.inTakings, 1000 * 6 / 7 * 7));
});

test("[VOORUIT] dates: overdue purchases count today, a client's pace beats the due date, nothing is invented", () => {
  assert.equal(outflowDate({ id: "x", name: "", dueDate: "2026-08-01", open: 1, incasso: false }, "2026-09-07"), "2026-09-07");
  assert.equal(outflowDate({ id: "x", name: "", dueDate: null, open: 1, incasso: false }, "2026-09-07"), null);
  assert.equal(outflowDate({ id: "x", name: "", dueDate: "gisteren", open: 1, incasso: false }, "2026-09-07"), null);
  assert.equal(expectedInflowDate({ id: "r", name: "", invoiceDate: "2026-09-01", dueDate: "2026-09-15", open: 1, expectedDays: 21 }), "2026-09-22");
  assert.equal(expectedInflowDate({ id: "r", name: "", invoiceDate: null, dueDate: "2026-09-15", open: 1, expectedDays: 21 }), "2026-09-15", "no invoice date → the due date");
  assert.equal(expectedInflowDate({ id: "r", name: "", invoiceDate: null, dueDate: null, open: 1, expectedDays: null }), null);
});

test("[VOORUIT] takings come from booked days only, and a shop with no till has none", () => {
  const rows = Array.from({ length: 48 }, (_, i) => ({ turnover_date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`, pin_amount: 1500, cash_amount: 250 }));
  const t = takingsFromTillDays(rows, 56);
  assert.ok(t && near(t.perTradingDay, 1750) && t.daysMeasured === 48 && near(t.tradingDaysPerWeek, 6));
  assert.equal(takingsFromTillDays([], 56), null);
  assert.equal(takingsFromTillDays([{ turnover_date: null, pin_amount: 1, cash_amount: 1 }], 56), null);
  const eightPerWeek = takingsFromTillDays(Array.from({ length: 64 }, () => ({ turnover_date: "2026-08-01", pin_amount: 1, cash_amount: 0 })), 56);
  assert.equal(eightPerWeek?.tradingDaysPerWeek, 7, "never more than seven trading days in a week");
});

// [NEGATIEVE CONTROLE] The rule bites: move one date and the seven-day figure moves with it.
test("[VOORUIT] negative control — an invoice due on day 8 is outside seven days and inside thirty", () => {
  const i = base(); i.takings = null; i.receivables = [];
  i.payables = [{ id: "e", name: "Edge", dueDate: "2026-09-15", open: 100, incasso: false }];
  const [d7, d30] = forecastCashflow(i).horizons;
  assert.equal(d7.outCount, 0); assert.equal(d30.outCount, 1);
  i.payables[0].dueDate = "2026-09-14";
  assert.equal(forecastCashflow(i).horizons[0].outCount, 1, "day seven is inside");
});

test("[VOORUIT] late means past due — a fast payer inside its term is expected today, not written off", () => {
  const i = base(); i.takings = null; i.payables = [];
  // Invoiced 1 September, 30-day term, this client pays in 4 days: on 7 September it is not late.
  i.receivables = [{ id: "fast", name: "Snel BV", invoiceDate: "2026-09-01", dueDate: "2026-10-01", open: 600, expectedDays: 4 }];
  const [d7] = forecastCashflow(i).horizons;
  assert.equal(isLateReceivable(i.receivables[0], "2026-09-07"), false);
  assert.equal(d7.inCount, 1, "expected today, inside seven days");
  assert.ok(near(d7.inInvoices, 600));
  assert.ok(!d7.notes.some((n) => n.code === "receivables-late"));
  // Past its due date it IS late, whatever the pace.
  assert.equal(isLateReceivable({ ...i.receivables[0], dueDate: "2026-09-06" }, "2026-09-07"), true);
  // Without a due date the pace's date decides.
  assert.equal(isLateReceivable({ ...i.receivables[0], dueDate: null }, "2026-09-07"), true);
  assert.equal(isLateReceivable({ ...i.receivables[0], dueDate: null, expectedDays: 10 }, "2026-09-07"), false);
});

test("[VOORUIT] a receivable with no date at all is named, never silently dropped", () => {
  const i = base(); i.takings = null; i.payables = [];
  i.receivables = [{ id: "nd", name: "Zonder", invoiceDate: null, dueDate: null, open: 320, expectedDays: null }];
  const [d7] = forecastCashflow(i).horizons;
  assert.equal(d7.inCount, 0);
  const n = d7.notes.find((x) => x.code === "receivables-undated") as { count: number; amount: number };
  assert.deepEqual([n.count, n.amount], [1, 320]);
});

test("[VOORUIT] the week rate is measured over the till's own history — a three-week-old till trades six days a week", () => {
  // 18 booked days in the three weeks up to today, six a week.
  const days = ["2026-08-18","2026-08-19","2026-08-20","2026-08-21","2026-08-22","2026-08-23",
                "2026-08-25","2026-08-26","2026-08-27","2026-08-28","2026-08-29","2026-08-30",
                "2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-05","2026-09-06"];
  const rows = days.map((d) => ({ turnover_date: d, pin_amount: 800, cash_amount: 0 }));
  const t = takingsFromTillDays(rows, 56, "2026-09-07");
  assert.ok(t && near(t.tradingDaysPerWeek, 6), `six days a week, got ${t?.tradingDaysPerWeek}`);
  const old = takingsFromTillDays(rows, 56);
  assert.ok(old && old.tradingDaysPerWeek < 3, "negative control: over a fixed 56-day window the same till read as 2,25 days a week");
  // A till older than the window is measured over the window, never beyond it.
  const long = Array.from({ length: 48 }, (_, i) => ({ turnover_date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, pin_amount: 1, cash_amount: 0 }));
  const l = takingsFromTillDays(long, 56, "2026-09-07");
  assert.ok(l && near(l.tradingDaysPerWeek, 6));
});
