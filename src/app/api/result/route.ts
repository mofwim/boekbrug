// src/app/api/result/route.ts
// [RESULT] The true quarterly result across all channels. Fetches the period's
// invoices + bank lines + cash entries, then computeResult() de-duplicates and
// aggregates. Read-only, user-scoped (RLS server client).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { reconcileTriangle, bankNetByDay } from "@/lib/triangle";
import { netCommissionToBook, ACQUIRER_VENDOR_RE } from "@/lib/card-reconcile";
import type { EftSettlement } from "@/lib/eft-parser";

function pad(n: number): string { return String(n).padStart(2, "0"); }

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  // [QUARTER] Honour ?year&quarter (bounded 2000–2100), else default to the LAST COMPLETED
  // quarter — the app-wide default (quarter.ts). Fixes the missing year bound here and the
  // open-quarter default a bare hit used to return.
  const { year, quarter } = quarterFromParams((k) => sp.get(k));

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;

  // [ACCOUNTANT-TRUTH] Dual-path: own result, OR a linked client's result for an
  // accountant (same authorization as /api/closing-package). Data queries below use the
  // service-role pipeline scoped to ownerId — an accountant cannot read a client's rows
  // through RLS, so this route's reads move from the session client to the pipeline.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const ownerId = owner.ownerId;
  const pipeline = createPipelineClient();

  // Invoices for this owner (outgoing = sender, incoming = receiver) in the quarter.
  const invRows = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));

  // [FIN-4] Infer a NULL direction from ownership (owner is the receiver of an incoming
  // invoice) — the SAME rule effectiveDirection / aangifte / readiness use — so a
  // null-direction row is never dropped and result never diverges from the concept.
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

  // Bank lines in the quarter (computeResult excludes invoice payments + uncategorized).
  // [TURNOVER] `description` is needed to parse a pos_income line's takings date (DAT.),
  // which keys the covered-day de-dup against the till turnover.
  const bankRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end)
    .order("id", { ascending: true }).range(from, to));

  // The card-settlement de-dup (settleDate/settleExact/posSettlement) is derived by the shared
  // toResultBankTx mapper so all four money surfaces agree. It also flags an acquirer payout
  // the owner mis-tapped as 'omzet' as a settlement, so it can't double-count on a covered day.
  const bankTx: ResultBankTx[] = bankRows.map(toResultBankTx);

  // Cash entries in the quarter.
  const cashRows = await fetchAllRows((from, to) => pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end)
    .order("id", { ascending: true }).range(from, to));

  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate,
    date: c.entry_date,
  }));

  // [TURNOVER] Daily till Z-report. Fetch a few days BEFORE the quarter too: a sale on
  // the last days of the previous quarter settles into this one, and its pos_income line
  // must be suppressed here (covered set) without its revenue being re-added (revenue
  // rows are the in-quarter ones only). This closes the cross-quarter double-count.
  const bufD = new Date(Date.UTC(year, startMonth, 1));
  bufD.setUTCDate(bufD.getUTCDate() - 5);
  const startBuffer = `${bufD.getUTCFullYear()}-${pad(bufD.getUTCMonth() + 1)}-${pad(bufD.getUTCDate())}`;

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

  // Revenue rows: strictly in-quarter. Covered set: the widened window, revenue rows only
  // (a zero/empty turnover row must not suppress a real settlement).
  const turnover = allTurnover.filter((t) => t.turnover_date >= start);
  const coveredDates = new Set(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => t.turnover_date),
  );

  // [TRIANGLE] Card-takings reconciliation. The till counts card sales GROSS while the bank
  // pays out NET, so the acquirer commission is otherwise never a cost and profit is
  // overstated. Fetch the EFT terminal settlements (corner 2), reconcile against the till
  // (Leg A) and the bank's net pos_income (Leg B = commission), then book the commission —
  // de-duped against any acquirer-fee invoice already in kosten so the fee is never counted
  // twice. In-quarter EFT rows only (settlement_date within the period).
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

  // Bank NET card settlement per takings day. A card sale on the LAST days of the quarter
  // settles into the bank AFTER quarter-end, so fetch pos_income with a +5-day (and −5, for
  // symmetry with the covered set) settlement-lag buffer — otherwise an end-of-quarter day's
  // commission is missed here while the closing package (which buffers) counts it, and the
  // two artifacts disagree. Each line is keyed by its embedded DAT takings date; we then keep
  // ONLY the days whose takings date is IN the quarter, so the buffer completes in-quarter
  // days without adding prev/next-quarter rows.
  const endD2 = new Date(Date.UTC(year, startMonth + 3, 0));
  endD2.setUTCDate(endD2.getUTCDate() + 5);
  const endBuffer = `${endD2.getUTCFullYear()}-${pad(endD2.getUTCMonth() + 1)}-${pad(endD2.getUTCDate())}`;
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

  // [LEDGER · Leg-A witness] The bookkeeper's PIN grootboek (ledger_daily kind='pin') is an
  // independent GROSS cross-check of the till's PIN takings. It is fed to the triangle ONLY as
  // pinLedgerByDay — reconcileTriangle raises a break when it disagrees with the till's PIN; it
  // is NEVER a revenue/cost source (money stays in daily_turnover). In-quarter days only.
  const pinLedgerRows = await fetchAllRows<{ ledger_date: string; received: number | null; spent: number | null }>((from, to) => pipeline
    .from("ledger_daily")
    .select("ledger_date, received, spent")
    .eq("user_id", ownerId)
    .eq("kind", "pin")
    .gte("ledger_date", start)
    .lte("ledger_date", end)
    .order("ledger_date", { ascending: true }).range(from, to)).catch(() => []);
  // NET PIN (received − spent, card refunds under 'spent'): the till's pin_amount is net-of-
  // refunds, so comparing net-to-net avoids a spurious break on a day with card refunds.
  const pinLedgerByDay = new Map<string, number>();
  for (const r of pinLedgerRows) if (r.ledger_date) pinLedgerByDay.set(r.ledger_date, (Number(r.received) || 0) - (Number(r.spent) || 0));

  const triangle = reconcileTriangle({ turnover, eftSettlements, bankNetByDay: netByDay, pinLedgerByDay });

  // Acquirer-fee invoices already booked as kosten — subtract them so the commission delta
  // isn't double-counted with the fee invoice. Computed from the RAW invoice rows (which
  // still carry client_name + status), NOT the stripped ResultInvoice objects, and gated to
  // the SAME statuses computeResult actually books as kosten (INCOMING_OK = paid/received) —
  // a draft/processing acquirer invoice is not in kosten, so it must not reduce the
  // commission either.
  const INCOMING_OK = new Set(["paid", "received"]);
  const acquirerFeesBooked = (invRows ?? [])
    .filter((i) =>
      effDir(i) === "incoming" &&
      INCOMING_OK.has(i.status ?? "") &&
      ACQUIRER_VENDOR_RE.test(i.client_name ?? ""))
    .reduce((s, i) => s + (i.total_ex_btw ?? 0) + (i.btw_amount ?? 0), 0);
  const commissionToBook = netCommissionToBook(triangle.totalCommission, acquirerFeesBooked);

  // [CARD-BUDGET] Per covered day, the max bank revenue it may suppress as till card takings —
  // built from the SAME buffer-inclusive rows as coveredDates so prior-quarter days are bounded
  // (their off-till excess still counts this quarter), not blindly suppressed.
  const coveredBudget = new Map(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );

  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates, commissionToBook, coveredBudget);

  return NextResponse.json({
    ok: true,
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    result,
    // [TRIANGLE] Transparency for the owner + the closing package: the raw commission, what
    // was actually booked (net of acquirer invoices), and the Leg-A exceptions to review.
    reconciliation: {
      totalCommission: triangle.totalCommission,
      commissionBooked: commissionToBook,
      acquirerFeeInvoices: Math.round(acquirerFeesBooked * 100) / 100,
      grossMismatchDays: triangle.grossMismatchDays,
      incompleteDays: triangle.incompleteDays,
      eftSettlements: eftSettlements.length,
    },
  });
}
