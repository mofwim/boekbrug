// src/app/api/result/route.ts
// [RESULT] The true quarterly result across all channels. Fetches the period's
// invoices + bank lines + cash entries, then computeResult() de-duplicates and
// aggregates. Read-only, user-scoped (RLS server client).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeResult, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";

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
  const { data: bankRows } = await supabase
    .from("bank_transactions")
    .select("amount, category, invoice_id, date")
    .eq("user_id", user.id)
    .gte("date", start)
    .lte("date", end);

  const bankTx: ResultBankTx[] = (bankRows ?? []).map((b) => ({
    amount: b.amount, category: b.category, invoice_id: b.invoice_id,
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
  }));

  const result = computeResult(invoices, bankTx, cashEntries);

  return NextResponse.json({
    ok: true,
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    result,
  });
}
