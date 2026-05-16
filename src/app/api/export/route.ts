// app/api/export/route.ts
// [BOEK-013] Quarterly CSV export — May 2026
// [BOEK-014] Year / status / accountant mode — May 2026
// [BOEK-014] Minor fix: exclude archived, add invoice_type to SELECT — May 2026
// [BOEK-014] TS fix: GenericStringError resolved — separate SELECT constants — May 2026
//
// GET /api/export?year=2026&quarter=1           ← quarter export (existing)
// GET /api/export?year=2026                     ← full year export
// GET /api/export?year=2026&status=paid         ← filter by status
// GET /api/export?year=2026&accountant=true     ← all clients (accountant only)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { quarterStartDate, quarterEndDate } from "@/lib/quarterly";
import {
  type InvRow,
  type InvoiceExportRowFull,
  type InvoiceExportRowAccountant,
  toExportRowFull,
  invoicesToCsv,
  invoicesToCsvAccountant,
} from "@/lib/export";

// [BOEK-014] Separate SELECT constants — concatenation causes GenericStringError
const INVOICE_SELECT =
  "invoice_number, client_name, client_email, client_address, client_postal_code, client_city, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, created_at, sent_to_accountant, invoice_type" as const;

const INVOICE_SELECT_WITH_SENDER =
  "invoice_number, client_name, client_email, client_address, client_postal_code, client_city, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, created_at, sent_to_accountant, invoice_type, sender_id" as const;

// Local type for accountant query rows — includes sender_id
type InvRowWithSender = InvRow & { sender_id: string | null };

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Niet ingelogd", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const now = new Date();
  const year = Number(req.nextUrl.searchParams.get("year") ?? now.getFullYear());
  const rawQuarter = req.nextUrl.searchParams.get("quarter");
  const clientId = req.nextUrl.searchParams.get("clientId");
  const statusFilter = req.nextUrl.searchParams.get("status");
  const accountantMode = req.nextUrl.searchParams.get("accountant") === "true";

  if (isNaN(year)) {
    return new NextResponse("Ongeldig jaar", { status: 400 });
  }

  // ─── Date range ───────────────────────────────────────────────────────────
  let start: string;
  let end: string;
  let periodLabel: string;

  if (rawQuarter) {
    const quarter = Number(rawQuarter) as 1 | 2 | 3 | 4;
    if (quarter < 1 || quarter > 4) {
      return new NextResponse("Ongeldig kwartaal", { status: 400 });
    }
    start = quarterStartDate(year, quarter);
    end = quarterEndDate(year, quarter);
    periodLabel = `Q${quarter} ${year}`;
  } else {
    start = `${year}-01-01`;
    end = `${year}-12-31`;
    periodLabel = `${year}`;
  }

  // ─── Accountant all-clients mode ──────────────────────────────────────────
  if (accountantMode) {
    if (profile?.role !== "accountant") {
      return new NextResponse("Geen toegang", { status: 403 });
    }

    const { data: clientLinks } = await supabase
      .from("accountant_clients")
      .select("zzper_id, profiles:zzper_id(id, full_name, company_name)")
      .eq("accountant_id", user.id);

    if (!clientLinks || clientLinks.length === 0) {
      return new NextResponse("Geen klanten gekoppeld", { status: 404 });
    }

    const clientNames: Record<string, string> = {};
    const clientIds: string[] = [];

    for (const link of clientLinks) {
      // profiles join returns array — take first element
      const profilesArr = link.profiles as { id: string; full_name: string | null; company_name: string | null }[] | null;
      const p = Array.isArray(profilesArr) ? profilesArr[0] ?? null : profilesArr;
      if (!p) continue;
      clientIds.push(p.id);
      clientNames[p.id] = p.company_name ?? p.full_name ?? "Onbekend";
    }

    if (clientIds.length === 0) {
      return new NextResponse("Geen klanten gevonden", { status: 404 });
    }

    // [BOEK-014] Use dedicated constant with sender_id — avoids GenericStringError
    const { data: rawData, error } = await supabase
      .from("invoices")
      .select(INVOICE_SELECT_WITH_SENDER)
      .in("sender_id", clientIds)
      .eq("status", "paid")
      .neq("status", "archived")
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .order("sender_id", { ascending: true })
      .order("invoice_date", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Safe cast via unknown — select constant guarantees the shape
    const data = (rawData as unknown) as InvRowWithSender[];

    const rows = data.map((inv) => {
      const base = toExportRowFull(inv, periodLabel);
      return { ...base, klant_id: inv.sender_id ?? "" } as InvoiceExportRowAccountant;
    });

    const csv = invoicesToCsvAccountant(rows as InvoiceExportRowFull[], clientNames);
    const filename = rawQuarter
      ? `boekbrug-klanten-Q${rawQuarter}-${year}.csv`
      : `boekbrug-klanten-${year}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // ─── Single user / single client mode ────────────────────────────────────
  if (profile?.role === "accountant" && clientId) {
    const { data: rel } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!rel) return new NextResponse("Geen toegang", { status: 403 });
  }

  const targetId =
    profile?.role === "accountant" && clientId ? clientId : user.id;

  let query = supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("sender_id", targetId)
    .neq("status", "archived")
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("invoice_date", { ascending: true });

  if (profile?.role === "accountant") {
    query = query.eq("status", statusFilter ?? "paid");
  } else if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data: rawData, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Safe cast via unknown — select constant guarantees the shape
  const data = (rawData as unknown) as InvRow[];

  const rows = data.map((inv) => toExportRowFull(inv, periodLabel));
  const csv = invoicesToCsv(rows);

  const filename = rawQuarter
    ? `boekbrug-Q${rawQuarter}-${year}.csv`
    : `boekbrug-${year}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}