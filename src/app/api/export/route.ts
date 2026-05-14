// app/api/export/route.ts
// CSV export for invoices (BOEK-014)
// GET /api/export?year=2026&quarter=1&status=paid

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { invoicesToCsv, type InvoiceExportRow } from "@/lib/export";

export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = req.nextUrl.searchParams.get("year");
  const quarter = req.nextUrl.searchParams.get("quarter");
  const status = req.nextUrl.searchParams.get("status");

  let q = supabase
    .from("invoices")
    .select(
      "invoice_number, client_name, status, total_ex_btw, btw_amount, total_inc_btw, btw_rate, invoice_date, due_date"
    )
    .eq("sender_id", user.id)
    .order("invoice_date", { ascending: true });

  if (status) q = q.eq("status", status);

  if (year && quarter) {
    // Filter by quarter date range
    const month = (Number(quarter) - 1) * 3;
    const start = new Date(Number(year), month, 1).toISOString().slice(0, 10);
    const end = new Date(Number(year), month + 3, 0).toISOString().slice(0, 10);
    q = q.gte("invoice_date", start).lte("invoice_date", end);
  } else if (year) {
    q = q.gte("invoice_date", `${year}-01-01`).lte("invoice_date", `${year}-12-31`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((inv): InvoiceExportRow => ({
    invoice_number: inv.invoice_number ?? "",
    client_name: inv.client_name ?? "",
    status: inv.status ?? "",
    total_ex_btw: Number(inv.total_ex_btw ?? 0),
    btw_amount: Number(inv.btw_amount ?? 0),
    total_inc_btw: Number(inv.total_inc_btw ?? 0),
    btw_rate: Number(inv.btw_rate ?? 21),
    invoice_date: inv.invoice_date ?? "",
    due_date: inv.due_date ?? "",
    period: year && quarter ? `Q${quarter} ${year}` : year ?? "",
  }));

  const csv = invoicesToCsv(rows);
  const filename = year && quarter
    ? `boekbrug-facturen-Q${quarter}-${year}.csv`
    : `boekbrug-facturen-${year ?? "export"}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
