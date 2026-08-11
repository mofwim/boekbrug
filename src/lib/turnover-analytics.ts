// src/lib/turnover-analytics.ts
// [TURNOVER-ANALYTICS] Pure business-intelligence over the normalized daily turnover.
// It sits on DailyTurnover (the domain model), NOT on any file format — so the same KPIs
// hold whether the data came from xls, csv, or a future POS API. No I/O, fully testable
// (run: npx tsx src/lib/turnover-analytics.test.ts).
//
// HONEST SCOPE: daily-granular data supports trend, VAT mix, payment mix, average day,
// and anomalies. It does NOT support best-selling products or peak HOURS — those need
// line-level / timestamped transactions we don't have, so we don't fake them. The
// average-transaction figure is PIN-only (from the bank's AANT ticket count) and labelled
// as such; cash ticket counts are unknown.

import type { DailyTurnover } from "./turnover";
import { round2 } from "./invoice-totals";

export interface MonthlyPoint { month: string; omzet: number } // month = 'YYYY-MM'
export interface VatMixEntry { rate: 0 | 9 | 21; net: number; share: number } // share 0..1 of net
export interface DayPoint { date: string; omzet: number }
export interface Anomaly { date: string; omzet: number; direction: "hoog" | "laag" }

export interface TurnoverAnalytics {
  days: number;
  totalOmzetIncl: number;
  totalNet: number;
  avgDayOmzet: number;
  busiestDay: DayPoint | null;
  quietestDay: DayPoint | null;
  monthly: MonthlyPoint[];
  vatMix: VatMixEntry[];
  payment: { pin: number; cash: number; other: number; pinShare: number; cashShare: number; otherShare: number };
  avgPinTicket: number | null;   // totalPin / posTicketCount — PIN transactions only
  posTicketCount: number | null; // Σ AANT from the bank card settlements (null if unknown)
  anomalies: Anomaly[];
}

const r2 = round2;
const gross = (t: DailyTurnover) => t.total_incl ?? ((t.base_0 ?? 0) + (t.base_9 ?? 0) + (t.base_21 ?? 0) + (t.btw_9 ?? 0) + (t.btw_21 ?? 0));

/**
 * Compute turnover KPIs for a set of days. `posTicketCount` is the total number of card
 * transactions in the period (Σ AANT parsed from the bank pos_income lines); pass it to
 * get an average PIN ticket, or omit it (undefined) when unknown.
 */
export function computeTurnoverAnalytics(
  turnover: DailyTurnover[],
  posTicketCount?: number,
): TurnoverAnalytics {
  const days = turnover.length;
  const empty: TurnoverAnalytics = {
    days: 0, totalOmzetIncl: 0, totalNet: 0, avgDayOmzet: 0, busiestDay: null, quietestDay: null,
    monthly: [], vatMix: [], payment: { pin: 0, cash: 0, other: 0, pinShare: 0, cashShare: 0, otherShare: 0 },
    avgPinTicket: null, posTicketCount: posTicketCount ?? null, anomalies: [],
  };
  if (days === 0) return empty;

  let net0 = 0, net9 = 0, net21 = 0, pin = 0, cash = 0, other = 0, totalIncl = 0;
  const monthMap = new Map<string, number>();
  const dayPoints: DayPoint[] = [];

  for (const t of turnover) {
    const g = gross(t);
    totalIncl += g;
    net0 += t.base_0 ?? 0; net9 += t.base_9 ?? 0; net21 += t.base_21 ?? 0;
    pin += t.pin_amount ?? 0; cash += t.cash_amount ?? 0; other += t.other_amount ?? 0;
    const month = t.turnover_date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + g);
    dayPoints.push({ date: t.turnover_date, omzet: g });
  }

  const totalNet = net0 + net9 + net21;
  const shareOf = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

  const vatMix: VatMixEntry[] = [
    { rate: 21, net: r2(net21), share: r2(shareOf(net21, totalNet)) },
    { rate: 9, net: r2(net9), share: r2(shareOf(net9, totalNet)) },
    { rate: 0, net: r2(net0), share: r2(shareOf(net0, totalNet)) },
  ];

  const payTotal = pin + cash + other;
  const payment = {
    pin: r2(pin), cash: r2(cash), other: r2(other),
    pinShare: r2(shareOf(pin, payTotal)), cashShare: r2(shareOf(cash, payTotal)), otherShare: r2(shareOf(other, payTotal)),
  };

  const monthly: MonthlyPoint[] = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, omzet]) => ({ month, omzet: r2(omzet) }));

  const sortedByOmzet = [...dayPoints].sort((a, b) => b.omzet - a.omzet);
  const busiestDay = { date: sortedByOmzet[0].date, omzet: r2(sortedByOmzet[0].omzet) };
  const quietestDay = { date: sortedByOmzet[sortedByOmzet.length - 1].date, omzet: r2(sortedByOmzet[sortedByOmzet.length - 1].omzet) };

  // Anomalies: days more than 2σ from the mean daily turnover. Needs enough days for the
  // deviation to be meaningful — below 5 days it's noise, so we skip it (honest silence).
  const anomalies: Anomaly[] = [];
  const mean = totalIncl / days;
  if (days >= 5) {
    const variance = dayPoints.reduce((s, d) => s + (d.omzet - mean) ** 2, 0) / days;
    const std = Math.sqrt(variance);
    if (std > 0) {
      for (const d of dayPoints) {
        if (Math.abs(d.omzet - mean) > 2 * std) {
          anomalies.push({ date: d.date, omzet: r2(d.omzet), direction: d.omzet > mean ? "hoog" : "laag" });
        }
      }
      anomalies.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const avgPinTicket = posTicketCount && posTicketCount > 0 ? r2(pin / posTicketCount) : null;

  return {
    days,
    totalOmzetIncl: r2(totalIncl),
    totalNet: r2(totalNet),
    avgDayOmzet: r2(mean),
    busiestDay, quietestDay,
    monthly, vatMix, payment,
    avgPinTicket,
    posTicketCount: posTicketCount ?? null,
    anomalies,
  };
}
