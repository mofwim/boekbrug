// app/api/export/ubl/route.ts
// [BOEK-020] UBL 2.1 single-invoice export — download route — June 2026
//
// GET /api/export/ubl?invoiceId={uuid}
//   → returns a UBL 2.1 XML file (Content-Disposition: attachment)
//
// Scope (Phase 2): ZZP'er exports their OWN invoice (sender_id = auth.uid()).
// Session client + RLS only — NO service_role (read-only, RLS already scopes rows).
// Accountant branch (?clientId=) is Phase 3; RLS already permits it
// (invoice_lines_select_accountant + profiles_select_accountant_clients, paid only).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  buildInvoiceUbl,
  UblValidationError,
  type UblErrorCode,
  type UblInvoiceHeader,
  type UblInvoiceLine,
  type UblSupplier,
} from "@/lib/ubl-export";

// [BOEK-020] Single-line SELECT literals — avoids GenericStringError (see BOEK-014)
const INVOICE_SELECT =
  "id, sender_id, invoice_number, invoice_date, due_date, invoice_type, total_ex_btw, btw_amount, total_inc_btw, client_name, client_address, client_postal_code, client_city, client_btw_number" as const;

const LINES_SELECT =
  "description, quantity, unit_price, btw_rate, line_total" as const;

const PROFILE_SELECT =
  "company_name, full_name, kvk_number, btw_number, iban, address, postal_code, city" as const;

// [BOEK-020] Map generator error codes → Dutch user messages (UI text in Dutch)
const DUTCH_ERROR: Record<UblErrorCode, string> = {
  SUPPLIER_MISSING_KVK:
    "Vul eerst je KVK- en BTW-nummer in bij je gegevens voordat je UBL exporteert.",
  SUPPLIER_MISSING_BTW:
    "Vul eerst je KVK- en BTW-nummer in bij je gegevens voordat je UBL exporteert.",
  SUPPLIER_MISSING_NAME:
    "Vul eerst je bedrijfs- of persoonsnaam in bij je gegevens voordat je UBL exporteert.",
  NO_LINES:
    "Deze factuur heeft geen factuurregels en kan niet als UBL geëxporteerd worden.",
  MISSING_INVOICE_NUMBER:
    "Deze factuur heeft nog geen factuurnummer. Verstuur de factuur eerst.",
  MISSING_INVOICE_DATE: "Deze factuur heeft geen geldige factuurdatum.",
};

/** Make a filesystem-safe filename fragment from the invoice number. */
function safeFilenamePart(invoiceNumber: string | null): string {
  return (invoiceNumber ?? "factuur").replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId ontbreekt" }, { status: 400 });
  }

  // ── Invoice (scoped to the ZZP'er as sender; RLS also enforces) ──
  const { data: invoiceRow, error: invErr } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("id", invoiceId)
    .eq("sender_id", user.id)
    .maybeSingle();

  if (invErr) {
    return NextResponse.json({ error: invErr.message }, { status: 500 });
  }
  if (!invoiceRow) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  // ── Lines ──
  const { data: lineRows, error: linesErr } = await supabase
    .from("invoice_lines")
    .select(LINES_SELECT)
    .eq("invoice_id", invoiceId)
    .order("id", { ascending: true });

  if (linesErr) {
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  // ── Supplier = the ZZP'er's own profile ──
  const { data: profileRow, error: profErr } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .single();

  if (profErr || !profileRow) {
    return NextResponse.json(
      { error: "Profielgegevens niet gevonden" },
      { status: 500 }
    );
  }

  // ── Map DB rows → pure generator inputs ──
  const inv = invoiceRow as unknown as {
    invoice_number: string | null;
    invoice_date: string | null;
    due_date: string | null;
    invoice_type: string | null;
    total_ex_btw: number | null;
    btw_amount: number | null;
    total_inc_btw: number | null;
    client_name: string | null;
    client_address: string | null;
    client_postal_code: string | null;
    client_city: string | null;
    client_btw_number: string | null;
  };

  const header: UblInvoiceHeader = {
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    due_date: inv.due_date,
    invoice_type: inv.invoice_type,
    total_ex_btw: inv.total_ex_btw,
    btw_amount: inv.btw_amount,
    total_inc_btw: inv.total_inc_btw,
    client_name: inv.client_name,
    client_address: inv.client_address,
    client_postal_code: inv.client_postal_code,
    client_city: inv.client_city,
    client_btw_number: inv.client_btw_number,
  };

  const lines: UblInvoiceLine[] = ((lineRows ?? []) as unknown as Array<{
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    btw_rate: number | null;
    line_total: number | null;
  }>).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    btw_rate: l.btw_rate,
    line_total: l.line_total,
  }));

  const supplier: UblSupplier = profileRow as unknown as UblSupplier;

  // ── Generate ──
  let xml: string;
  let warnings: string[];
  try {
    const result = buildInvoiceUbl(header, lines, supplier);
    xml = result.xml;
    warnings = result.warnings;
  } catch (err) {
    if (err instanceof UblValidationError) {
      // 422: request understood, but data isn't ready for a valid UBL file.
      return NextResponse.json(
        { error: DUTCH_ERROR[err.code], code: err.code },
        { status: 422 }
      );
    }
    console.error("[BOEK-020] UBL generation error:", err);
    return NextResponse.json(
      { error: "UBL genereren mislukt" },
      { status: 500 }
    );
  }

  // Cross-check diagnostics — non-fatal. Surface in Vercel Runtime Logs.
  if (warnings.length > 0) {
    console.warn(`[BOEK-020] UBL warnings for invoice ${invoiceId}:`, warnings);
  }

  // ── Download response ──
  const filename = `boekbrug-factuur-${safeFilenamePart(inv.invoice_number)}-ubl.xml`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-UBL-Warnings": String(warnings.length),
    },
  });
}