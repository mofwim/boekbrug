// src/lib/compute-result-range.ts
// [TRUTH-RANGE] The ONE reconciled financial result for an arbitrary [start, end] date window.
//
// This is the exact fetch + triangle-reconcile + computeResult pipeline that /api/result ran for
// a single quarter, lifted out verbatim so it can run over ANY window — a quarter, a year, all of
// time, a custom range. That is the whole point of the "living truth + time lens": there is only
// ONE truth, computed live from the raw tables; a period is just which [start, end] you feed it.
// Both /api/result (quarter) and /api/truth (lens) call this, so the two can never drift.
//
// Read-only. The caller resolves ownerId (own vs accountant-linked client) and passes the
// service-role pipeline already scoped to that owner.

import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry, type FinancialResult } from "./financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "./turnover";
import { fetchAllRows } from "./supabase-paginate";
import { reconcileTriangle, bankNetByDay } from "./triangle";
import { netCommissionToBook, ACQUIRER_VENDOR_RE } from "./card-reconcile";
import type { EftSettlement } from "./eft-parser";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchSettlementEvents } from "./kas-payment-events-fetch";
import type { VatScheme } from "./vat-scheme";

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Shift an ISO 'YYYY-MM-DD' by whole days via UTC (no local-TZ drift). */
function isoShiftDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface RangeResult {
  result: FinancialResult;
  datelessVerifiedCount: number;
  // [KASSTELSEL] Under cash basis: paid money we could NOT date (undatedPaidCount) MUST block
  // klaar/aangifte — it would otherwise silently under-declare. estimatedPortionCount counts
  // invoices whose paid-date is only an estimate (marked_paid_at). Both 0 under factuur.
  undatedPaidCount: number;
  estimatedPortionCount: number;
  scheme: VatScheme;
  reconciliation: {
    totalCommission: number;
    commissionBooked: number;
    acquirerFeeInvoices: number;
    grossMismatchDays: number;
    incompleteDays: number;
    eftSettlements: number;
  };
}

/**
 * Compute the reconciled result for one owner over [start, end] (inclusive ISO dates).
 * IDENTICAL logic to the old /api/result body — only the period bounds are now a parameter.
 */
export async function computeResultForRange(args: {
  pipeline: PipelineClient;
  ownerId: string;
  start: string; // 'YYYY-MM-DD'
  end: string;   // 'YYYY-MM-DD'
  // [KASSTELSEL] The VAT basis IN FORCE for this window (the caller resolves it per-quarter via
  // resolveSchemeForQuarter, so a pre-switch quarter stays 'factuur'). Default 'factuur' → the
  // accrual path runs byte-identical, and every existing caller is unchanged.
  scheme?: VatScheme;
}): Promise<RangeResult> {
  const { pipeline, ownerId, start, end } = args;
  const scheme: VatScheme = args.scheme === "kas" ? "kas" : "factuur";

  // Invoices for this owner (outgoing = sender, incoming = receiver) in the window.
  const invRows = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));

  // [FIN-4] Infer a NULL direction from ownership (owner is the receiver of an incoming invoice)
  // — the SAME rule effectiveDirection / aangifte / readiness use — so a null-direction row is
  // never dropped and result never diverges from the concept.
  const effDir = (i: { direction: string | null; receiver_id: string | null }): "incoming" | "outgoing" =>
    i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction
      : i.receiver_id === ownerId ? "incoming" : "outgoing";
  const invoices: ResultInvoice[] = invRows.map((i) => ({
    direction: effDir(i),
    status: i.status,
    total_ex_btw: i.total_ex_btw,
    btw_amount: i.btw_amount,
  }));

  // Bank lines in the window (computeResult excludes invoice payments + uncategorized).
  const bankRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  const bankTx: ResultBankTx[] = bankRows.map(toResultBankTx);

  // Cash entries in the window.
  const cashRows = await fetchAllRows((from, to) => pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date, document_id")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end)
    .order("id", { ascending: true }).range(from, to));
  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate,
    date: c.entry_date,
    document_id: (c as { document_id?: string | null }).document_id ?? null, // [CASH-COST-VAT]
  }));

  // [TURNOVER] Daily till Z-report, with a −5-day buffer: a sale on the last days BEFORE the
  // window settles into it, and its pos_income line must be suppressed (covered set) without its
  // revenue being re-added (revenue rows are the in-window ones only). Closes the cross-boundary
  // double-count.
  const startBuffer = isoShiftDays(start, -5);
  const { data: turnoverRows } = await pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId)
    .gte("turnover_date", startBuffer)
    .lte("turnover_date", end);

  const allTurnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));

  // Revenue rows: strictly in-window. Covered set: the widened window, revenue rows only
  // (a zero/empty turnover row must not suppress a real settlement).
  const turnover = allTurnover.filter((t) => t.turnover_date >= start);
  const coveredDates = new Set(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => t.turnover_date),
  );

  // [TRIANGLE] Card-takings reconciliation (till counts GROSS, bank pays NET → acquirer
  // commission is a cost). In-window EFT terminal settlements.
  const { data: eftRows } = await pipeline
    .from("eft_settlements")
    .select("settlement_date, terminal_id, period_nr, shift_nr, period_start, period_end, first_trx, last_trx, gross_total, tx_count, by_scheme")
    .eq("user_id", ownerId)
    .gte("settlement_date", start)
    .lte("settlement_date", end);
  const eftSettlements: EftSettlement[] = (eftRows ?? []).map((e) => ({
    terminalId: e.terminal_id, periodNr: e.period_nr, shiftNr: e.shift_nr,
    periodStart: e.period_start, periodEnd: e.period_end, firstTrx: e.first_trx, lastTrx: e.last_trx,
    settlementDate: e.settlement_date, grossTotal: e.gross_total ?? 0, txCount: e.tx_count ?? 0,
    byScheme: (Array.isArray(e.by_scheme) ? e.by_scheme : []) as unknown as EftSettlement["byScheme"],
  }));

  // Bank NET card settlement per takings day, with a ±5-day settlement-lag buffer; keep ONLY days
  // whose takings date is IN the window.
  const endBuffer = isoShiftDays(end, 5);
  const posBufRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("description, amount, date")
    .eq("user_id", ownerId)
    .eq("category", "pos_income")
    .gte("date", startBuffer)
    .lte("date", endBuffer)
    .order("id", { ascending: true }).range(from, to));
  const netByDay = bankNetByDay(posBufRows.map((b) => ({ description: b.description, amount: b.amount, date: b.date })));
  for (const k of [...netByDay.keys()]) if (k < start || k > end) netByDay.delete(k);

  // [LEDGER · Leg-A witness] The bookkeeper's PIN grootboek — an independent GROSS cross-check of
  // the till's PIN takings; fed to the triangle ONLY as pinLedgerByDay (never a revenue source).
  const pinLedgerRows = await fetchAllRows<{ ledger_date: string; received: number | null; spent: number | null }>((from, to) => pipeline
    .from("ledger_daily")
    .select("ledger_date, received, spent")
    .eq("user_id", ownerId)
    .eq("kind", "pin")
    .gte("ledger_date", start)
    .lte("ledger_date", end)
    .order("ledger_date", { ascending: true }).range(from, to)).catch(() => []);
  const pinLedgerByDay = new Map<string, number>();
  for (const r of pinLedgerRows) if (r.ledger_date) pinLedgerByDay.set(r.ledger_date, (Number(r.received) || 0) - (Number(r.spent) || 0));

  const triangle = reconcileTriangle({ turnover, eftSettlements, bankNetByDay: netByDay, pinLedgerByDay });

  // Acquirer-fee invoices already booked as kosten — subtract so the commission delta isn't
  // double-counted. Gated to the SAME statuses computeResult books as kosten (paid/received).
  const INCOMING_OK = new Set(["paid", "received"]);
  const acquirerFeesBooked = (invRows ?? [])
    .filter((i) =>
      effDir(i) === "incoming" &&
      INCOMING_OK.has(i.status ?? "") &&
      ACQUIRER_VENDOR_RE.test(i.client_name ?? ""))
    .reduce((s, i) => s + (i.total_ex_btw ?? 0) + (i.btw_amount ?? 0), 0);
  const commissionToBook = netCommissionToBook(triangle.totalCommission, acquirerFeesBooked);

  // [CARD-BUDGET] Per covered day, the max bank revenue it may suppress as till card takings.
  const coveredBudget = new Map(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );

  // [KASSTELSEL] Under cash basis, the invoice leg is driven by SETTLEMENTS (BTW on the paid
  // date), not the invoice_date. Only the invoice leg changes: the bank/cash/turnover legs are
  // already payment-dated (a till sale, a bank credit, a cash entry all happen when money moves),
  // so they stay identical. The acquirer-commission auto-book is disabled under kas (its cost is
  // deductible when the acquirer's invoice is PAID, booked via that invoice's own settlement — so
  // auto-booking the triangle delta here would place it in the wrong period / double-count).
  let undatedPaidCount = 0;
  let estimatedPortionCount = 0;
  let kasOpts: Parameters<typeof computeResult>[7] = {};
  if (scheme === "kas") {
    const qs = await fetchSettlementEvents(pipeline, ownerId, start, end);
    undatedPaidCount = qs.undatedPaidCount;
    estimatedPortionCount = qs.estimatedCount;
    kasOpts = { scheme: "kas", settlements: qs.events, priorByInvoice: qs.priorByInvoice };
  }
  const result = computeResult(
    invoices, bankTx, cashEntries, turnover, coveredDates,
    scheme === "kas" ? 0 : commissionToBook, coveredBudget, kasOpts,
  );

  // [DATELESS] Under FACTUUR: verified invoices with NO invoice_date are dropped by the date-range
  // fetch, so they are absent from the figures — count them (same rule as /api/aangifte) so the
  // surface can warn. Under KAS the invoice_date is irrelevant (invoices enter by payment date);
  // the analogous "money we can't place" signal is undatedPaidCount, computed above.
  const OUTGOING_OK = new Set(["paid", "sent", "overdue"]);
  let datelessVerifiedCount = 0;
  if (scheme !== "kas") {
    const datelessRows = await fetchAllRows((from, to) => pipeline
      .from("invoices")
      .select("status, direction, receiver_id")
      .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
      .is("invoice_date", null)
      .order("id", { ascending: true }).range(from, to));
    datelessVerifiedCount = datelessRows.filter((i) => {
      const dir = effDir(i);
      return dir === "incoming" ? INCOMING_OK.has(i.status ?? "") : OUTGOING_OK.has(i.status ?? "");
    }).length;
  }

  return {
    result,
    datelessVerifiedCount,
    undatedPaidCount,
    estimatedPortionCount,
    scheme,
    reconciliation: {
      totalCommission: triangle.totalCommission,
      commissionBooked: commissionToBook,
      acquirerFeeInvoices: Math.round(acquirerFeesBooked * 100) / 100,
      grossMismatchDays: triangle.grossMismatchDays,
      incompleteDays: triangle.incompleteDays,
      eftSettlements: eftSettlements.length,
    },
  };
}
