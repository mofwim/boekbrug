// app/api/quarterly/route.ts
// Quarterly financial overview (BOEK-013)
// GET /api/quarterly?year=2026&quarter=1

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildQuarterlySummary, quarterStartDate, quarterEndDate } from "@/lib/quarterly";
import type { InvoiceForQuarterly } from "@/lib/quarterly";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const now = new Date();
  const year = Number(req.nextUrl.searchParams.get("year") ?? now.getFullYear());
  const quarter = Number(
    req.nextUrl.searchParams.get("quarter") ?? Math.ceil((now.getMonth() + 1) / 3)
  ) as 1 | 2 | 3 | 4;
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (quarter < 1 || quarter > 4 || isNaN(year)) {
    return NextResponse.json({ error: "Ongeldige parameters" }, { status: 400 });
  }

  // Accountant: moet clientId opgeven + verificeer dat klant van hem is
  if (profile?.role === "accountant") {
    if (!clientId) return NextResponse.json({ error: "Geen klant geselecteerd" }, { status: 400 });

    const { data: rel } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!rel) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  const targetId = profile?.role === "accountant" && clientId ? clientId : user.id;
  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);

  // Voor accountant: alleen paid facturen
  let query = supabase
    .from("invoices")
    .select("id, invoice_number, client_name, status, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date")
    .eq("sender_id", targetId)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("invoice_date", { ascending: true });

  if (profile?.role === "accountant") {
    query = query.eq("status", "paid");
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

const invoices: InvoiceForQuarterly[] = (data ?? []).map((inv) => ({
  id: inv.id,
  invoice_number: inv.invoice_number,
  client_name: inv.client_name,
  status: inv.status,
  total_ex_btw: inv.total_ex_btw,
  btw_amount: inv.btw_amount,
  total_inc_btw: inv.total_inc_btw,
  invoice_date: inv.invoice_date,
  due_date: inv.due_date ?? undefined,
  btw_rate: inv.total_ex_btw > 0
    ? Math.round((inv.btw_amount / inv.total_ex_btw) * 100)
    : 0,
}));

  const summary = buildQuarterlySummary(invoices, year, quarter);
  return NextResponse.json(summary);
}