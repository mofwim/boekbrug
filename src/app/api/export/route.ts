// app/api/export/route.ts
// Unified export endpoint (BOEK-014)
//
// GET  /api/export?format=csv&scope=quarter&year=2026&quarter=1
// GET  /api/export?format=csv&scope=year&year=2026
// GET  /api/export?format=json&scope=quarter&year=2026&quarter=1
// GET  /api/export?format=pdf-btw&scope=quarter&year=2026&quarter=1
// GET  /api/export?format=pdf-list&scope=quarter&year=2026&quarter=1
// POST /api/export/bank  → see below (bank file parse, read-only)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  invoicesToCsv,
  calcBtwSummary,
  toExportRowFull,
  type InvRow,
} from "@/lib/export";
import {
  renderBtwAangiftePdf,
  renderFactuuroverzichtPdf,
} from "@/lib/export-pdf";

// ─── Supabase select — all columns needed by every format ─────────────────────

const SELECT = [
  "invoice_number",
  "client_name",
  "client_email",
  "client_address",
  "client_postal_code",
  "client_city",
  "status",
  "direction",
  "total_ex_btw",
  "btw_amount",
  "total_inc_btw",
  "invoice_date",
  "due_date",
  "created_at",
  "sent_to_accountant",
].join(", ");

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") ?? "csv";   // csv | json | pdf-btw | pdf-list
  const scope = sp.get("scope") ?? "quarter"; // quarter | year | all
  const year = parseInt(sp.get("year") ?? String(new Date().getFullYear()));
  const quarter = parseInt(sp.get("quarter") ?? "1") as 1 | 2 | 3 | 4;
  const statusFilter = sp.get("status");      // optional: paid | sent | draft

  // ── Build query ─────────────────────────────────────────────────────────────
  let query = supabase
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .order("invoice_date", { ascending: true });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  if (scope === "quarter") {
    const month = (quarter - 1) * 3;
    const start = new Date(year, month, 1).toISOString().slice(0, 10);
    const end = new Date(year, month + 3, 0).toISOString().slice(0, 10);
    query = query.gte("invoice_date", start).lte("invoice_date", end);
  } else if (scope === "year") {
    query = query
      .gte("invoice_date", `${year}-01-01`)
      .lte("invoice_date", `${year}-12-31`);
  }
  // scope === "all" → no date filter

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const invoices = (data ?? []) as unknown as InvRow[];

  // ── Period label for filenames and PDF titles ────────────────────────────────
  const periodLabel =
    scope === "quarter"
      ? `Q${quarter} ${year}`
      : scope === "year"
      ? `${year}`
      : "Alles";

  // ── Format: CSV ──────────────────────────────────────────────────────────────
  if (format === "csv") {
    const rows = invoices.map((inv) => toExportRowFull(inv, periodLabel));
    const csv = invoicesToCsv(rows);
    const filename = `boekbrug-facturen-${periodLabel.replace(" ", "-")}.csv`;

    return new NextResponse("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Format: JSON ─────────────────────────────────────────────────────────────
  if (format === "json") {
    return NextResponse.json({
      period: periodLabel,
      exportedAt: new Date().toISOString(),
      count: invoices.length,
      invoices,
    });
  }

  // ── Format: PDF BTW Aangifte ─────────────────────────────────────────────────
  if (format === "pdf-btw") {
    if (scope !== "quarter") {
      return NextResponse.json(
        { error: "BTW aangifte is alleen beschikbaar per kwartaal" },
        { status: 400 }
      );
    }

    // Get company name from profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, full_name")
      .eq("id", user.id)
      .single();

    const companyName =
      profile?.company_name ?? profile?.full_name ?? "Mijn bedrijf";

    const summary = calcBtwSummary(invoices, year, quarter);
    const buffer = await renderBtwAangiftePdf(summary, companyName);
    const filename = `boekbrug-btw-aangifte-Q${quarter}-${year}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Format: PDF Factuuroverzicht ─────────────────────────────────────────────
  if (format === "pdf-list") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, full_name")
      .eq("id", user.id)
      .single();

    const companyName =
      profile?.company_name ?? profile?.full_name ?? "Mijn bedrijf";

    const buffer = await renderFactuuroverzichtPdf(
      invoices,
      periodLabel,
      companyName
    );
    const filename = `boekbrug-factuuroverzicht-${periodLabel.replace(" ", "-")}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    { error: `Onbekend formaat: ${format}` },
    { status: 400 }
  );
}

// ─── POST /api/export — bank file parse (read-only, BOEK-014) ─────────────────
//
// Accepts: multipart/form-data with field "file" (MT940 or CAMT.053)
// Returns: ParseResult JSON — transactions are NOT saved to DB here.
// Saving happens in BOEK-016 (Bank Matching Engine).

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Ongeldig formulier" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Geen bestand gevonden — stuur een MT940 of CAMT.053 bestand" },
      { status: 400 }
    );
  }

  // Size limit: 10MB
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Bestand te groot (max 10MB)" },
      { status: 400 }
    );
  }

  // Only allow safe extensions
  const allowed = [".mt940", ".sta", ".txt", ".xml", ".camt"];
  const filename = file.name.toLowerCase();
  if (!allowed.some((ext) => filename.endsWith(ext))) {
    return NextResponse.json(
      { error: "Bestandstype niet ondersteund. Gebruik MT940 of CAMT.053" },
      { status: 400 }
    );
  }

  const content = await file.text();

  // Lazy import — bank-parser is only needed for this POST route
  const { parseBankFile, summarizeParseResult } = await import(
    "@/lib/bank-parser"
  );

  const result = parseBankFile(content, file.name);
  const summary = summarizeParseResult(result);

  return NextResponse.json({
    format: result.format,
    accountIban: result.accountIban,
    accountName: result.accountName,
    currency: result.currency,
    transactionCount: result.transactions.length,
    summary,
    transactions: result.transactions,
    parseErrors: result.parseErrors,
  });
}