// src/app/api/result/route.ts
// [RESULT] The true quarterly result across all channels. Fetches the period's
// invoices + bank lines + cash entries, then computeResult() de-duplicates and
// aggregates. Read-only, user-scoped (RLS server client).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResult, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { parsePosSettlement, turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
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
  const { data: invRows } = await pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end);

  // [FIN-4] Infer a NULL direction from ownership (owner is the receiver of an incoming
  // invoice) — the SAME rule effectiveDirection / aangifte / readiness use — so a
  // null-direction row is never dropped and result never diverges from the concept.
  const effDir = (i: { direction: string | null; receiver_id: string | null }): "incoming" | "outgoing" =>
    i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction
      : i.receiver_id === ownerId ? "incoming" : "outgoing";
  const invoices: ResultInvoice[] = (invRows ?? []).map((i) => ({
    direction: effDir(i),
    status: i.status,
    total_ex_btw: i.total_ex_btw,
    btw_amount: i.btw_amount,
  }));

  // Bank lines in the quarter (computeResult excludes invoice payments + uncategorized).
  // [TURNOVER] `description` is needed to parse a pos_income line's takings date (DAT.),
  // which keys the covered-day de-dup against the till turnover.
  const { data: bankRows } = await pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end);

  const bankTx: ResultBankTx[] = (bankRows ?? []).map((b) => ({
    amount: b.amount, category: b.category, invoice_id: b.invoice_id,
    // For a pos_income line, prefer the embedded takings date (DAT.); fall back to the
    // booking date only when the bank omits it. Non-POS lines don't need a settleDate.
    settleDate: b.category === "pos_income"
      ? (parsePosSettlement(b.description).date ?? b.date)
      : null,
  }));

  // Cash entries in the quarter.
  const { data: cashRows } = await pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end);

  const cashEntries: ResultCashEntry[] = (cashRows ?? []).map((c) => ({
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

  // Bank NET card settlement per takings day (pos_income lines only).
  const posLines = (bankRows ?? []).filter((b) => b.category === "pos_income");
  const netByDay = bankNetByDay(posLines);

  const triangle = reconcileTriangle({ turnover, eftSettlements, bankNetByDay: netByDay });

  // Acquirer-fee invoices already booked as kosten (incoming, from a known acquirer/PSP) —
  // subtract them so the commission delta isn't double-counted with the fee invoice.
  const acquirerFeesBooked = (invoices as (ResultInvoice & { client_name?: string | null })[])
    .filter((i) => i.direction === "incoming" && ACQUIRER_VENDOR_RE.test(i.client_name ?? ""))
    .reduce((s, i) => s + (i.total_ex_btw ?? 0) + (i.btw_amount ?? 0), 0);
  const commissionToBook = netCommissionToBook(triangle.totalCommission, acquirerFeesBooked);

  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates, commissionToBook);

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
