// src/lib/turnover-closing.ts
// [TURNOVER-CLOSING] Pure builder for the accountant's retail turnover section of the
// closing package: a per-rate turnover + BTW summary, a per-day payment reconciliation
// (till vs bank card-settlement vs cash book), an exceptions list (the days that don't
// tie out), and an import audit trail. No I/O — the orchestrator fetches, this computes,
// so it is fully testable (run: npx tsx src/lib/turnover-closing.test.ts).
//
// The accountant's trust comes from HONESTY about gaps: every day whose three witnesses
// disagree is surfaced as an exception, never smoothed over. Reuses the same reconcile
// logic the owner sees (turnover.ts), so the package and the app never diverge.

import {
  reconcileDay,
  sumPosSettlements,
  type DailyTurnover,
  type ReconcileBreak,
  type PosSettlementLine,
} from "./turnover";
import { round2 } from "./invoice-totals";

export interface CashOmzetForClosing {
  date: string;                 // entry_date 'YYYY-MM-DD'
  amount: number | null;        // positive
}

export interface TurnoverRateSummary {
  rate: 0 | 9 | 21;
  net: number;                  // ex-BTW turnover at this rate
  btw: number;                  // BTW at this rate (0% → 0)
}

export interface TurnoverSummary {
  days: number;
  perRate: TurnoverRateSummary[];
  totalNet: number;
  totalBtw: number;
  totalIncl: number;
  totalPin: number;
  totalCash: number;
}

export interface DayReconciliation {
  date: string;
  pinExpected: number;
  pinSettled: number;           // Σ bank pos_income for that takings day
  pinDiff: number;              // settled − expected
  cashExpected: number;
  cashCounted: number;          // Σ cash-book omzet that day
  cashDiff: number;
  breaks: ReconcileBreak[];
}

export interface TurnoverException {
  date: string;
  kind: ReconcileBreak["kind"];
  note: string;
  diff: number;
}

export interface TurnoverClosing {
  summary: TurnoverSummary;
  reconciliation: DayReconciliation[];
  exceptions: TurnoverException[];
  audit: { date: string; totalIncl: number }[];
}

const r2 = round2;

/**
 * Build the retail turnover section for the closing package. `posLines` are the bank
 * pos_income lines over the quarter (± a settlement-lag buffer); `cashOmzet` are the
 * cash-book omzet entries. Reconciliation keys the card settlements to their takings day
 * via the embedded DAT date (sumPosSettlements), so a T+1 / batched settlement still
 * matches the right day.
 */
export function buildTurnoverClosing(
  turnover: DailyTurnover[],
  posLines: PosSettlementLine[],
  cashOmzet: CashOmzetForClosing[],
): TurnoverClosing {
  // ── summary (per rate + totals) ──
  let net0 = 0, net9 = 0, net21 = 0, btw9 = 0, btw21 = 0, incl = 0, pin = 0, cash = 0;
  for (const t of turnover) {
    net0 += t.base_0 ?? 0;
    net9 += t.base_9 ?? 0;
    net21 += t.base_21 ?? 0;
    btw9 += t.btw_9 ?? 0;
    btw21 += t.btw_21 ?? 0;
    incl += t.total_incl ?? 0;
    pin += t.pin_amount ?? 0;
    cash += t.cash_amount ?? 0;
  }
  const summary: TurnoverSummary = {
    days: turnover.length,
    perRate: [
      { rate: 21, net: r2(net21), btw: r2(btw21) },
      { rate: 9, net: r2(net9), btw: r2(btw9) },
      { rate: 0, net: r2(net0), btw: 0 },
    ],
    totalNet: r2(net0 + net9 + net21),
    totalBtw: r2(btw9 + btw21),
    totalIncl: r2(incl),
    totalPin: r2(pin),
    totalCash: r2(cash),
  };

  // ── per-day reconciliation + exceptions ──
  const cashByDay = new Map<string, number>();
  for (const c of cashOmzet) {
    cashByDay.set(c.date, (cashByDay.get(c.date) ?? 0) + (c.amount ?? 0));
  }

  const reconciliation: DayReconciliation[] = [];
  const exceptions: TurnoverException[] = [];
  const audit: { date: string; totalIncl: number }[] = [];

  const days = [...turnover].sort((a, b) => a.turnover_date.localeCompare(b.turnover_date));
  for (const t of days) {
    const date = t.turnover_date;
    const pinSettled = r2(sumPosSettlements(posLines, date).total);
    const cashCounted = r2(cashByDay.get(date) ?? 0);
    const pinExpected = t.pin_amount ?? 0;
    const cashExpected = t.cash_amount ?? 0;
    const breaks = reconcileDay({ turnover: t, posSettledForDay: pinSettled, cashCountedForDay: cashCounted });

    reconciliation.push({
      date,
      pinExpected: r2(pinExpected), pinSettled, pinDiff: r2(pinSettled - pinExpected),
      cashExpected: r2(cashExpected), cashCounted, cashDiff: r2(cashCounted - cashExpected),
      breaks,
    });
    for (const b of breaks) {
      exceptions.push({ date, kind: b.kind, note: b.note ?? b.kind, diff: r2(b.diff) });
    }
    audit.push({ date, totalIncl: r2(t.total_incl ?? 0) });
  }

  return { summary, reconciliation, exceptions, audit };
}
