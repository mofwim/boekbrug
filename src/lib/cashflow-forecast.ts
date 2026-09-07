// src/lib/cashflow-forecast.ts
// [VOORUIT] How much money will there be in 7 and in 30 days. Pure, no I/O, no clock.
// Run: npx tsx --test src/lib/cashflow-forecast.test.ts
//
// The owner's first question every week — "kom ik uit?" — had no answer, while the app holds
// every number it needs: the last statement's closing balance, the drawer, every open purchase
// invoice with its due date, every open sales invoice, and eight weeks of till takings.
//
// What this refuses, and why each refusal is the safe side:
//   · A purchase invoice without a due date is NOT counted — it is named with its amount. A date
//     the app invents is a payment the owner did not plan.
//   · A sales invoice already past its expected date is NOT counted as money arriving inside the
//     horizon — it is late, and a forecast that books late money as tomorrow's is the rosy kind
//     that gets an owner into an overdraft. Named, with the amount, so the owner chases it.
//   · An unknown bank balance produces NO end balance (null, never 0), only the movements.
//   · Takings are an average over BOOKED trading days, never a guess for a shop without a till.
//
// Everything money is euros rounded to the cent via round2, the one rounding ([CENT]).

import { round2 } from "./invoice-totals";
import { dayNumberFromIso } from "./invoice-reminders";
import { addDays } from "./recurring";
import { STALE_BALANCE_DAYS } from "./btw-reservation";

export interface ForecastPayable {
  id: string;
  name: string;
  dueDate: string | null;
  /** Open amount, euros, signed (a creditnota is negative and lowers the outflow). */
  open: number;
  /** Leaves the account by mandate on the due date — the most certain date in the forecast. */
  incasso: boolean;
}

export interface ForecastReceivable {
  id: string;
  name: string;
  invoiceDate: string | null;
  dueDate: string | null;
  /** Open amount, euros, after creditnotas and known payment differences. */
  open: number;
  /** The client's measured median days from invoice to payment, or null when unmeasured. */
  expectedDays: number | null;
}

export interface ForecastTakings {
  /** Average pin + cash takings per BOOKED trading day, euros. */
  perTradingDay: number;
  /** Booked trading days per week over the measured span (0–7). */
  tradingDaysPerWeek: number;
  /** How many booked days the average rests on. */
  daysMeasured: number;
}

export interface ForecastInput {
  today: string;
  /**
   * From bankBalanceOf, plus the net of bank lines dated after asOf (null when no balance).
   *
   * `accounts` is how many accounts the balance sums. With several, the route can only add the
   * lines dated after the NEWEST statement — a line between two accounts' end dates cannot be
   * placed on one of them, and may already sit inside the other's closing balance — so the
   * forecast says that it left those out (note "bank-accounts").
   */
  bank: { balance: number | null; asOf: string | null; partial: boolean; netSinceAsOf: number | null; accounts?: number };
  /** The drawer (computeDrawerBalance), or null when the owner handles no cash / it could not be read. */
  kas: number | null;
  payables: readonly ForecastPayable[];
  receivables: readonly ForecastReceivable[];
  takings: ForecastTakings | null;
  horizons?: readonly number[];
}

export type ForecastNote =
  | { code: "bank-unknown" }
  | { code: "bank-partial" }
  | { code: "bank-stale"; asOf: string }
  | { code: "bank-accounts"; count: number }
  | { code: "kas-unknown" }
  | { code: "payables-undated"; count: number; amount: number }
  | { code: "receivables-late"; count: number; amount: number }
  | { code: "receivables-undated"; count: number; amount: number }
  | { code: "takings-unknown" }
  | { code: "takings-thin"; days: number };

export interface HorizonForecast {
  days: number;
  endDate: string;
  /** Purchase invoices due inside the horizon (overdue ones count today). */
  out: number;
  outCount: number;
  outIncasso: number;
  /** Sales invoices expected inside the horizon. */
  inInvoices: number;
  inCount: number;
  /** Average takings over the horizon's trading days. */
  inTakings: number;
  /** Bank + drawer now; null when the bank balance is unknown. */
  start: number | null;
  /** start + in − out; null when start is null. */
  end: number | null;
  /** The lowest the running balance gets inside the horizon; null when start is null. */
  lowest: { date: string; balance: number } | null;
  notes: ForecastNote[];
}

export interface CashflowForecast {
  today: string;
  horizons: HorizonForecast[];
}

/** The date a purchase invoice's money leaves: its due date, or today when that has passed. */
export function outflowDate(p: ForecastPayable, today: string): string | null {
  if (!p.dueDate || dayNumberFromIso(p.dueDate) === null) return null;
  return p.dueDate < today ? today : p.dueDate;
}

/**
 * The date a sales invoice's money is expected: the client's measured pace from the invoice
 * date when there is one, else the due date. Null when neither can be placed on a calendar.
 */
export function expectedInflowDate(r: ForecastReceivable): string | null {
  if (r.expectedDays !== null && r.invoiceDate && dayNumberFromIso(r.invoiceDate) !== null) {
    return addDays(r.invoiceDate, Math.max(0, Math.round(r.expectedDays)));
  }
  if (r.dueDate && dayNumberFromIso(r.dueDate) !== null) return r.dueDate;
  return null;
}

function daysAfter(a: string, b: string): number {
  return (dayNumberFromIso(b) ?? 0) - (dayNumberFromIso(a) ?? 0);
}

/**
 * Late means PAST DUE. A client who usually pays in four days is not "over tijd" on day six of a
 * thirty-day term — the money is merely not in yet, and its expected day is simply today. Only
 * without a due date does the pace's date decide.
 */
export function isLateReceivable(r: ForecastReceivable, today: string): boolean {
  if (r.dueDate && dayNumberFromIso(r.dueDate) !== null) return r.dueDate < today;
  const d = expectedInflowDate(r);
  return d !== null && d < today;
}

export function forecastCashflow(input: ForecastInput): CashflowForecast {
  const { today } = input;
  const horizons = input.horizons ?? [7, 30];
  const startKnown = input.bank.balance !== null;
  const bankNow = startKnown ? round2((input.bank.balance as number) + (input.bank.netSinceAsOf ?? 0)) : null;
  const start = bankNow === null ? null : round2(bankNow + (input.kas ?? 0));

  const undated = input.payables.filter((p) => outflowDate(p, today) === null);
  const late = input.receivables.filter((r) => isLateReceivable(r, today));
  // No invoice date and no due date: nothing places it on a day, so it is named, not counted.
  const undatedIn = input.receivables.filter((r) => expectedInflowDate(r) === null);

  const out: HorizonForecast[] = [];
  for (const days of horizons) {
    const endDate = addDays(today, days);
    const notes: ForecastNote[] = [];
    if (!startKnown) notes.push({ code: "bank-unknown" });
    else {
      if (input.bank.partial) notes.push({ code: "bank-partial" });
      if (input.bank.asOf && daysAfter(input.bank.asOf, today) > STALE_BALANCE_DAYS) notes.push({ code: "bank-stale", asOf: input.bank.asOf });
      if ((input.bank.accounts ?? 1) > 1) notes.push({ code: "bank-accounts", count: input.bank.accounts as number });
    }
    if (input.kas === null) notes.push({ code: "kas-unknown" });

    // Day-by-day ledger of movements inside (today, endDate].
    const byDay = new Map<string, number>();
    const add = (date: string, amount: number) => byDay.set(date, (byDay.get(date) ?? 0) + amount);

    let outSum = 0, outCount = 0, outIncasso = 0;
    for (const p of input.payables) {
      const d = outflowDate(p, today);
      if (d === null || d > endDate) continue;
      outSum += p.open; outCount++; if (p.incasso) outIncasso += p.open;
      add(d, -p.open);
    }
    let inSum = 0, inCount = 0;
    for (const r of input.receivables) {
      const d0 = expectedInflowDate(r);
      if (d0 === null || isLateReceivable(r, today)) continue;
      // A pace date already behind us on an invoice still inside its term: expected today.
      const d = d0 < today ? today : d0;
      if (d > endDate) continue;
      inSum += r.open; inCount++;
      add(d, r.open);
    }
    let takingsSum = 0;
    if (input.takings && input.takings.daysMeasured > 0 && input.takings.tradingDaysPerWeek > 0) {
      const perCalendarDay = input.takings.perTradingDay * (Math.min(7, input.takings.tradingDaysPerWeek) / 7);
      for (let i = 1; i <= days; i++) { add(addDays(today, i), perCalendarDay); takingsSum += perCalendarDay; }
      if (input.takings.daysMeasured < 14) notes.push({ code: "takings-thin", days: input.takings.daysMeasured });
    } else {
      notes.push({ code: "takings-unknown" });
    }
    if (undated.length > 0) notes.push({ code: "payables-undated", count: undated.length, amount: round2(undated.reduce((s, p) => s + p.open, 0)) });
    if (late.length > 0) notes.push({ code: "receivables-late", count: late.length, amount: round2(late.reduce((s, r) => s + r.open, 0)) });
    if (undatedIn.length > 0) notes.push({ code: "receivables-undated", count: undatedIn.length, amount: round2(undatedIn.reduce((s, r) => s + r.open, 0)) });

    let lowest: HorizonForecast["lowest"] = null;
    let end: number | null = null;
    if (start !== null) {
      let running = start;
      lowest = { date: today, balance: start };
      for (let i = 0; i <= days; i++) {
        const d = addDays(today, i);
        running += byDay.get(d) ?? 0;
        if (running < lowest.balance) lowest = { date: d, balance: round2(running) };
      }
      end = round2(running);
      lowest = { date: lowest.date, balance: round2(lowest.balance) };
    }
    out.push({
      days, endDate,
      out: round2(outSum), outCount, outIncasso: round2(outIncasso),
      inInvoices: round2(inSum), inCount,
      inTakings: round2(takingsSum),
      start, end, lowest, notes,
    });
  }
  return { today, horizons: out };
}

/**
 * Average takings from booked till days: Σ(pin + cash) ÷ booked days, and booked days per week.
 *
 * The week rate is measured over the span the till has actually been in use — from its first
 * booked day to `today` — never over the whole look-back window. A till three weeks old with 18
 * booked days trades six days a week; over a fixed eight-week window it read as 2,25, and the
 * forecast scaled a € 800 day down to a third of itself and painted a tekort that was not there.
 */
export function takingsFromTillDays(
  rows: readonly { turnover_date: string | null; pin_amount: number | null; cash_amount: number | null }[],
  spanDays: number,
  today?: string,
): ForecastTakings | null {
  const booked = rows.filter((r) => r.turnover_date && dayNumberFromIso(r.turnover_date) !== null);
  if (booked.length === 0 || spanDays <= 0) return null;
  const total = booked.reduce((s, r) => s + (Number(r.pin_amount) || 0) + (Number(r.cash_amount) || 0), 0);
  let span = spanDays;
  if (today && dayNumberFromIso(today) !== null) {
    const first = booked.reduce<string>((m, r) => (r.turnover_date! < m ? r.turnover_date! : m), booked[0].turnover_date!);
    span = Math.max(1, Math.min(spanDays, daysAfter(first, today) + 1));
  }
  return {
    perTradingDay: round2(total / booked.length),
    tradingDaysPerWeek: Math.min(7, round2(booked.length / (span / 7))),
    daysMeasured: booked.length,
  };
}
