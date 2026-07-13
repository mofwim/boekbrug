// src/app/api/result/route.ts
// [RESULT] The true quarterly result across all channels. Fetches the period's
// invoices + bank lines + cash entries, then computeResult() de-duplicates and
// aggregates. Read-only, user-scoped (RLS server client).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeResult, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { parsePosSettlement, turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";

function pad(n: number): string { return String(n).padStart(2, "0"); }

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || now.getUTCFullYear();
  const quarter = ([1, 2, 3, 4].includes(Number(sp.get("quarter")))
    ? Number(sp.get("quarter"))
    : Math.floor(now.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;

  // Invoices for this user (outgoing = sender, incoming = receiver) in the quarter.
  const { data: invRows } = await supabase
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end);

  const invoices: ResultInvoice[] = (invRows ?? []).map((i) => ({
    direction: i.direction as "outgoing" | "incoming" | null,
    status: i.status,
    total_ex_btw: i.total_ex_btw,
    btw_amount: i.btw_amount,
  }));

  // Bank lines in the quarter (computeResult excludes invoice payments + uncategorized).
  // [TURNOVER] `description` is needed to parse a pos_income line's takings date (DAT.),
  // which keys the covered-day de-dup against the till turnover.
  const { data: bankRows } = await supabase
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description")
    .eq("user_id", user.id)
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
  const { data: cashRows } = await supabase
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date")
    .eq("user_id", user.id)
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

  const { data: turnoverRows } = await supabase
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", user.id)
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

  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates);

  return NextResponse.json({
    ok: true,
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    result,
  });
}
