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
import { posTakingsDay, SETTLE_LAG_DAYS, type DailyTurnover } from "./turnover";

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
    const d = posTakingsDay(l.description, l.date);
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
  // [CROSS-QUARTER] The REPORTING period. When set, days OUTSIDE [windowStart, windowEnd] are still
  // built + reconciled (so a −5/+5 buffer day can ANCHOR the re-attribution of a payout that settles
  // across the quarter boundary), but they contribute nothing to totalCommission / the exception
  // counts — only the quarter that OWNS the takings day books its fee. Omit → every day counts (the
  // reporting-only CSV callers pass nothing and are byte-identical).
  windowStart?: string;
  windowEnd?: string;
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
  // Union PIN-grootboek days too. A day the bookkeeper recorded PIN takings for but the till
  // Z-report is MISSING (no turnover/EFT/bank row) would otherwise be dropped — hiding exactly
  // the missing-omzet signal the ledger is there to expose. Surfaced as an incomplete day.
  if (input.pinLedgerByDay) for (const d of input.pinLedgerByDay.keys()) days.add(d);

  const tillByDay = new Map<string, DailyTurnover>();
  for (const t of input.turnover) tillByDay.set(t.turnover_date, t);

  // [TRIANGLE-LAG] Acquirer payouts post T+0..T+2 after the takings day. When the bank line carries
  // no "DAT." takings-date marker, bankNetByDay keyed it to the BOOKING day — a different day than
  // eftGross (keyed to the takings day). That split the pair (eftGross on day D with no bankNet, a
  // payout on D+1 with no eftGross), so Leg B commission was never booked and the fee silently
  // vanished. Re-attribute a payout that lands on a PURE settlement day (no eft AND no till of its
  // own) back to the nearest EARLIER takings day within the lag window that still lacks a payout —
  // so the gross↔net pair reunites and commission = gross − net is booked. Same-day payouts are
  // untouched; a payout with a genuine same-day eft/till keeps its day.
  // [SETTLE-LAG] Use the SAME window financial-result uses to suppress the payout's omzet, so the
  // commission is re-attributed to the exact day the omzet was already counted. At the old 3, a
  // DAT-less payout posting T+4/T+5 onto a pure settlement day (long weekend + holiday) found no
  // takings day within reach → its fee was silently dropped and resultaat overstated, while
  // financial-result still (correctly) suppressed that day's omzet at back=5. Widening to 5 only
  // adds targets for payouts that previously found NONE (stayed orphaned at €0 commission); every
  // payout that already matched at back≤3 is untouched (the loop stops at the first target), and
  // same-day / genuine-card-day payouts never enter this block at all.
  const LAG_DAYS = SETTLE_LAG_DAYS;
  const dayMs = 86_400_000;
  const bankByDay = new Map<string, number>(input.bankNetByDay ?? []);
  const hasCardActivity = (d: string) => eftByDay.has(d) || (tillByDay.get(d)?.pin_amount ?? null) != null;
  for (const [payoutDay, net] of [...bankByDay.entries()].sort()) {
    if (hasCardActivity(payoutDay)) continue; // a real card day keeps its own payout
    const pt = Date.parse(payoutDay);
    if (Number.isNaN(pt)) continue;
    let target: string | null = null;
    for (let back = 1; back <= LAG_DAYS && !target; back++) {
      const cand = new Date(pt - back * dayMs).toISOString().slice(0, 10);
      // Pull back only to a takings day that HAS card activity and does NOT already carry a payout.
      if (hasCardActivity(cand) && !bankByDay.has(cand)) target = cand;
    }
    if (target) {
      bankByDay.set(target, r2((bankByDay.get(target) ?? 0) + net));
      bankByDay.delete(payoutDay);
      days.add(target);
    }
  }
  // The re-attribution moves a payout OFF its (pure settlement) booking day onto the takings day.
  // Rebuild the day set: add any payout day that still holds money, then DROP any day now left with
  // NO witness at all (no till row, no EFT, no bank line, no PIN-ledger) — otherwise an emptied
  // settlement day lingers as a phantom "incomplete" row in the reconciliation + accountant CSV. A
  // genuinely un-attributable payout still carries its bankNet here, so it is kept and surfaced.
  for (const d of bankByDay.keys()) days.add(d);
  for (const d of [...days]) {
    const hasWitness =
      tillByDay.has(d) || eftByDay.has(d) || bankByDay.has(d) || !!input.pinLedgerByDay?.has(d);
    if (!hasWitness) days.delete(d);
  }

  const inputs: CardDayInput[] = [...days].sort().map((date) => {
    const till = tillByDay.get(date);
    return {
      date,
      tillPin: till ? till.pin_amount : null,
      eftGross: eftByDay.has(date) ? eftByDay.get(date)! : null,
      bankNet: bankByDay.has(date) ? bankByDay.get(date)! : null,
      ledgerPin: input.pinLedgerByDay?.has(date) ? input.pinLedgerByDay.get(date)! : null,
    };
  });

  const inWindow =
    input.windowStart != null && input.windowEnd != null
      ? (d: string) => d >= input.windowStart! && d <= input.windowEnd!
      : undefined;
  const period = reconcileCardPeriod(inputs, inWindow);
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
  const rows = tri.days.filter((d) => d.tillPin != null || d.eftGross != null || d.bankNet != null || d.ledgerPin != null);
  const L: string[] = [];
  L.push(`BoekBrug — Kaart-reconciliatie ${quarterLabel}`);
  L.push("Kassa-PIN (bruto) ↔ terminal-afrekening (bruto) ↔ bank-uitbetaling (netto). Het verschil bruto − netto is de acquirer-commissie (betaalkosten, BTW-vrij). Een verschil tussen kassa en terminal is een ECHT verschil — controleer die dag. 'Grootboek PIN' is een extra controle uit de boekhouding (telt niet mee als geld).");
  L.push("");
  L.push(["Datum", "Kassa PIN (bruto)", "Terminal (bruto)", "Grootboek PIN", "Bank (netto)", "Commissie", "Status"].map(esc).join(";"));
  for (const d of rows) {
    L.push([
      d.date, EUR(d.tillPin), EUR(d.eftGross), EUR(d.ledgerPin ?? null), EUR(d.bankNet),
      EUR(d.commission), STATUS_NL[d.status] ?? d.status,
    ].map(esc).join(";"));
  }
  L.push("");
  L.push(["Totaal kaartcommissie (bruto − netto, BTW-vrij)", "", "", "", "", EUR(tri.totalCommission), ""].map(esc).join(";"));
  L.push(["Dagen kassa ≠ terminal (controleer voor de aangifte)", "", "", "", "", "", String(tri.grossMismatchDays)].map(esc).join(";"));
  L.push(["Dagen nog niet compleet (bank-uitbetaling of terminal ontbreekt)", "", "", "", "", "", String(tri.incompleteDays)].map(esc).join(";"));
  L.push("");
  L.push("Let op: als de acquirer (CCV/Worldline/…) de transactiekosten APART factureert, staat die factuur bij de inkoopfacturen en IS die commissie daar al als kosten geboekt — dan is dit bruto-verschil ter controle, niet nog eens boeken.");
  return L.join("\r\n");
}
