// app/api/quarterly/route.ts
// Quarterly financial overview (BOEK-013)
// GET /api/quarterly?year=2026&quarter=1

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  buildQuarterlySummary,
  quarterStartDate,
  quarterEndDate,
} from "@/lib/quarterly";
import type { InvoiceForQuarterly } from "@/lib/quarterly";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const now = new Date();
  const year = Number(req.nextUrl.searchParams.get("year") ?? now.getFullYear());
  const quarter = Number(
    req.nextUrl.searchParams.get("quarter") ?? Math.ceil((now.getMonth() + 1) / 3)
  ) as 1 | 2 | 3 | 4;

  if (quarter < 1 || quarter > 4 || isNaN(year)) {
    return NextResponse.json({ error: "Ongeldige parameters" }, { status: 400 });
  }

  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);

  // btw_rate bestaat niet in DB — wordt berekend uit btw_amount / total_ex_btw
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, client_name, status, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date"
    )
    .eq("sender_id", user.id)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("invoice_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Bereken btw_rate per factuur
  const invoices: InvoiceForQuarterly[] = (data ?? []).map((inv) => ({
    ...inv,
    due_date: inv.due_date ?? undefined,
    btw_rate:
      inv.total_ex_btw > 0
        ? Math.round((inv.btw_amount / inv.total_ex_btw) * 100)
        : 0,
  }));

  const summary = buildQuarterlySummary(invoices, year, quarter);
  return NextResponse.json(summary);
}