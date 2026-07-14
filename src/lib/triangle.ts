// src/lib/triangle.ts
// [TRIANGLE] Pure integration layer — assembles the reconciliation triangle for a quarter
// from the real sources and runs the per-day card reconciliation. No I/O, fully testable
// (run: npx tsx src/lib/triangle.test.ts). This is the single entry point the result
// route and the closing package call; it owns the "which figure keys to which day" glue so
// no caller reinvents it.
//
//   corner 1  till (DailyTurnover)      → tillPin / tillCash per day  (GROSS)
//   corner 2  EFT settlements           → eftGross per day (Σ shifts by settlementDate)
//   corner 3a bookkeeper PIN ledger     → ledgerPin per day (GROSS cross-check)
//   corner 3b bank pos_income (net)     → bankNet per day (per takings day)
//
// It returns the period reconciliation (Leg A gross==gross, Leg B commission) plus the
// total commission and exception counts, so the result engine can book the commission and
// the package can show the full triangle.

import { reconcileCardPeriod, type CardDayInput, type CardPeriodResult } from "./card-reconcile";
import type { EftSettlement } from "./eft-parser";
import { parsePosSettlement, type DailyTurnover } from "./turnover";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Group bank pos_income lines into the NET card settlement per TAKINGS day. The takings day
 * is the settlement's embedded "DAT." date (parsePosSettlement), falling back to the booking
 * date when the bank omits it — the same key the covered-day de-dup uses, so bankNet lines up
 * with the till/EFT day. Amounts are summed SIGNED (a card refund settles negative).
 */
export function bankNetByDay(
  posLines: { description: string | null; amount: number | null; date: string | null }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of posLines) {
    const d = parsePosSettlement(l.description).date ?? l.date;
    if (!d) continue;
    out.set(d, r2((out.get(d) ?? 0) + (l.amount ?? 0)));
  }
  return out;
}

export interface TriangleInput {
  turnover: DailyTurnover[];
  eftSettlements: EftSettlement[];
  /** Per-day GROSS PIN from the bookkeeper's PIN ledger (ledgerDailyTotals → received). */
  pinLedgerByDay?: Map<string, number>;
  /** Per takings-day NET card settlement from the bank (Σ pos_income keyed by DAT date). */
  bankNetByDay?: Map<string, number>;
}

export interface TriangleResult extends CardPeriodResult {
  /** Σ EFT gross grouped per settlement day — exposed for the package's evidence table. */
  eftGrossByDay: Map<string, number>;
}

/** Sum EFT settlement gross per calendar takings day (settlementDate). Nulls are skipped. */
export function eftGrossByDay(settlements: EftSettlement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of settlements) {
    if (!s.settlementDate) continue;
    out.set(s.settlementDate, r2((out.get(s.settlementDate) ?? 0) + s.grossTotal));
  }
  return out;
}

/**
 * Build one CardDayInput per turnover day and reconcile the whole period. Days are keyed
 * off the till (the authoritative revenue). An EFT gross with no matching till day is still
 * surfaced as its own incomplete day so a terminal batch is never silently dropped.
 */
export function reconcileTriangle(input: TriangleInput): TriangleResult {
  const eftByDay = eftGrossByDay(input.eftSettlements);
  const days = new Set<string>();
  for (const t of input.turnover) days.add(t.turnover_date);
  for (const d of eftByDay.keys()) days.add(d);
  // Union bank payout days too, so a payout keyed to a day with no till/EFT row (a mis-keyed
  // or weekend-merged deposit) is surfaced as an incomplete day, never silently dropped —
  // symmetric with the orphan-EFT handling.
  if (input.bankNetByDay) for (const d of input.bankNetByDay.keys()) days.add(d);

  const tillByDay = new Map<string, DailyTurnover>();
  for (const t of input.turnover) tillByDay.set(t.turnover_date, t);

  const inputs: CardDayInput[] = [...days].sort().map((date) => {
    const till = tillByDay.get(date);
    return {
      date,
      tillPin: till ? till.pin_amount : null,
      eftGross: eftByDay.has(date) ? eftByDay.get(date)! : null,
      bankNet: input.bankNetByDay?.has(date) ? input.bankNetByDay.get(date)! : null,
      ledgerPin: input.pinLedgerByDay?.has(date) ? input.pinLedgerByDay.get(date)! : null,
    };
  });

  const period = reconcileCardPeriod(inputs);
  return { ...period, eftGrossByDay: eftByDay };
}

const STATUS_NL: Record<string, string> = {
  ok: "sluit aan",
  gross_mismatch: "verschil kassa/terminal — controleer",
  commission_issue: "commissie controleren",
  incomplete: "nog niet compleet",
};

/**
 * [TRIANGLE] The card reconciliation as a CSV for the accountant's closing package: per day
 * the till PIN (gross) ↔ terminal afrekening (gross) ↔ bank payout (net), with the
 * commission = gross − net on the last column. Pure (semicolon CSV, Excel-NL). Only days
 * that carry at least one card figure are listed, so a pure-invoice quarter yields no rows.
 */
export function buildCardReconciliationCsv(quarterLabel: string, tri: TriangleResult): string {
  const EUR = (n: number | null) => (n == null ? "" : n.toFixed(2).replace(".", ","));
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = tri.days.filter((d) => d.tillPin != null || d.eftGross != null || d.bankNet != null);
  const L: string[] = [];
  L.push(`BoekBrug — Kaart-reconciliatie ${quarterLabel}`);
  L.push("Kassa-PIN (bruto) ↔ terminal-afrekening (bruto) ↔ bank-uitbetaling (netto). Het verschil bruto − netto is de acquirer-commissie (betaalkosten, BTW-vrij). Een verschil tussen kassa en terminal is een ECHT verschil — controleer die dag.");
  L.push("");
  L.push(["Datum", "Kassa PIN (bruto)", "Terminal (bruto)", "Bank (netto)", "Commissie", "Status"].map(esc).join(";"));
  for (const d of rows) {
    L.push([
      d.date, EUR(d.tillPin), EUR(d.eftGross), EUR(d.bankNet),
      EUR(d.commission), STATUS_NL[d.status] ?? d.status,
    ].map(esc).join(";"));
  }
  L.push("");
  L.push(["Totaal acquirer-commissie (betaalkosten, BTW-vrij)", "", "", "", EUR(tri.totalCommission), ""].map(esc).join(";"));
  L.push(["Dagen kassa ≠ terminal (controleer voor de aangifte)", "", "", "", "", String(tri.grossMismatchDays)].map(esc).join(";"));
  L.push(["Dagen nog niet compleet (bank-uitbetaling of terminal ontbreekt)", "", "", "", "", String(tri.incompleteDays)].map(esc).join(";"));
  return L.join("\r\n");
}
