// app/api/export/ubl/route.ts
// [BOEK-020] UBL 2.1 single-invoice export — download route — June 2026
// [BOEK-020] Phase 3: accountant dual-path authorization — June 2026
//
// GET /api/export/ubl?invoiceId={uuid}
//   → returns a UBL 2.1 XML file (Content-Disposition: attachment)
//
// Authorization (dual-path):
//   - ZZP'er exports their OWN invoice (sender_id = auth.uid()), OR
//   - a linked accountant exports their client's invoice (accountant_clients link).
// Session client + RLS only — NO service_role / pipeline client.
//   UBL is generated from DB data (invoices + invoice_lines + profiles); it never
//   touches Storage, so no signed-URL/pipeline workaround is needed.
//   RLS already scopes reads: invoices_accountant_read (shared/paid + linked),
//   invoice_lines_select_accountant, profiles_select_accountant_clients.
//
// Supplier anchor: the UBL AccountingSupplierParty = the invoice SELLER = sender.
//   The supplier profile is loaded for the SELLER (ownerId), NOT the current user —
//   otherwise an accountant export would list the accountant as the seller.
//   Incoming invoices (ZZP'er = buyer) are not UBL-exportable from this side.

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
// [UNIT] Herkent "die kolom ken ik niet" (42703/PGRST204) — zie de terugval bij de regels.
import { isUnknownColumn } from "@/lib/created-by";
// [KLANT-EXTRA] De drie vrije klantregels, in een EIGEN mislukbare leesbeurt — de hoofdselect
// noemt zijn kolommen expliciet, en die mag niet falen op een database waar de migratie nog
// open staat. Zelfde vorm als de terugkerende-facturen-cron.
import { CLIENT_EXTRA_LINE_COLUMNS } from "@/lib/client-extra-lines";

// [BOEK-020] Single-line SELECT literals — avoids GenericStringError (see BOEK-014)
const INVOICE_SELECT =
  "id, sender_id, direction, invoice_number, invoice_date, due_date, invoice_type, total_ex_btw, btw_amount, total_inc_btw, client_name, client_address, client_postal_code, client_city, client_btw_number" as const;

// [UNIT] `unit` komt uit migratie invoice_line_unit.sql. Selecteren van een kolom die nog
// niet bestaat laat de HELE query falen (42703) — en dan zou een boekhouder geen enkele UBL meer
// kunnen ophalen. Vandaar twee lijsten en de terugval hieronder; zelfde les als created_by.
// [E-FACTUUR] vat_treatment hoort in dezelfde optionele groep als `unit`: het is de vlag waaraan
// een vrijgestelde regel (art. 11 Wet OB) te herkennen is, en zonder die vlag exporteert de UBL
// hem als categorie Z — een 0%-BELASTE levering. Dat is een ander juridisch feit dan vrijgesteld,
// en het is precies het feit dat de ontvanger anders moet boeken.
const LINES_SELECT =
  "description, quantity, unit_price, btw_rate, line_total, unit, vat_treatment" as const;
const LINES_SELECT_ZONDER_EENHEID =
  "description, quantity, unit_price, btw_rate, line_total" as const;

// [E-FACTUUR-VERLEGD] kor_active hoort erbij: onder de KOR wordt er geen btw berekend om een
// reden die niets met verleggen te maken heeft, dus een 0%-factuur aan een EU-klant is dan GEEN
// verlegde prestatie. Precies de vraag die de PDF ook aan dit veld stelt.
const PROFILE_SELECT =
  "company_name, full_name, kvk_number, btw_number, iban, address, postal_code, city, kor_active" as const;

// [BOEK-020] Map generator error codes → Dutch user messages (UI text in Dutch).
// Context-aware: when an accountant exports a client's invoice, missing seller
// data belongs to the CLIENT, so the message must address that (the accountant
// cannot edit the client's profile).
function dutchError(code: UblErrorCode, isOwner: boolean): string {
  switch (code) {
    case "SUPPLIER_MISSING_KVK":
    case "SUPPLIER_MISSING_BTW":
      return isOwner
        ? "Vul eerst je KVK- en BTW-nummer in bij je gegevens voordat je UBL exporteert."
        : "De klant heeft nog geen KVK-/BTW-nummer ingevuld. UBL-export is daardoor niet mogelijk.";
    case "SUPPLIER_MISSING_NAME":
      return isOwner
        ? "Vul eerst je bedrijfs- of persoonsnaam in bij je gegevens voordat je UBL exporteert."
        : "De klant heeft nog geen bedrijfs- of persoonsnaam ingevuld. UBL-export is daardoor niet mogelijk.";
    case "NO_LINES":
      return "Deze factuur heeft geen bedragen en kan niet als UBL geëxporteerd worden.";
    case "MISSING_INVOICE_NUMBER":
      return "Deze factuur heeft nog geen factuurnummer. Verstuur de factuur eerst.";
    case "MISSING_INVOICE_DATE":
      return "Deze factuur heeft geen geldige factuurdatum.";
  }
}

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

  // ── Invoice (by id; RLS still applies: own invoice, or accountant on a
  //    shared/paid client invoice) ──
  const { data: invoiceRow, error: invErr } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr) {
    return NextResponse.json({ error: invErr.message }, { status: 500 });
  }
  if (!invoiceRow) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  const inv = invoiceRow as unknown as {
    sender_id: string | null;
    direction: string | null;
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

  // ── UBL supplier = the invoice SELLER = sender. Incoming invoices have the
  //    ZZP'er as buyer, so they are not UBL-exportable from this side. ──
  const ownerId = inv.sender_id;
  if (inv.direction === "incoming" || !ownerId) {
    return NextResponse.json(
      {
        error: "UBL-export is alleen beschikbaar voor uitgaande facturen.",
        code: "INCOMING_NOT_SUPPORTED",
      },
      { status: 422 }
    );
  }

  // ── Dual-path authorization: owner (ZZP'er) OR a linked accountant ──
  let authorized = ownerId === user.id;
  if (!authorized) {
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", ownerId)
      .maybeSingle();
    authorized = !!link;
  }
  if (!authorized) {
    // 404 (not 403) — do not reveal existence of another user's invoice.
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  // ── Lines (RLS: own, or accountant on paid client invoice) ──
  // [UNIT] Eerst mét de eenheidskolom; bestaat die nog niet (migratie invoice_line_unit.sql
  // open), dan opnieuw zonder. Zonder deze terugval faalt de hele query met 42703 en kan een
  // boekhouder GEEN ENKELE e-factuur meer ophalen — dezelfde vorm van fout als created_by, en
  // die had ik vandaag al één keer te pakken.
  const eersteLezing = await supabase
    .from("invoice_lines")
    .select(LINES_SELECT)
    .eq("invoice_id", invoiceId)
    .order("id", { ascending: true });

  // [E-FACTUUR] De terugval geldt nu voor twee optionele kolommen. Eén 42703 op ÓF `unit` ÓF
  // `vat_treatment` laat de hele query falen, en dan kan een boekhouder geen enkele e-factuur meer
  // ophalen — dezelfde vorm van fout als created_by. De smalle lijst laat beide vallen, wat de
  // export terugbrengt naar precies het gedrag van vóór deze twee kolommen.
  const { data: lineRows, error: linesErr } =
    isUnknownColumn(eersteLezing.error, "unit") || isUnknownColumn(eersteLezing.error, "vat_treatment")
      ? await supabase
          .from("invoice_lines")
          .select(LINES_SELECT_ZONDER_EENHEID)
          .eq("invoice_id", invoiceId)
          .order("id", { ascending: true })
      : eersteLezing;

  if (linesErr) {
    return NextResponse.json({ error: linesErr.message }, { status: 500 });
  }

  // ── Supplier = the SELLER's profile (ownerId), NOT the current user.
  //    Critical: when an accountant exports, the supplier must be the ZZP'er. ──
  const { data: profileRow, error: profErr } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", ownerId)
    .single();

  if (profErr || !profileRow) {
    return NextResponse.json(
      { error: "Profielgegevens niet gevonden" },
      { status: 500 }
    );
  }

  // ── [KLANT-EXTRA] De drie vrije klantregels, apart en mislukbaar gelezen ──
  // Op een database waar client_extra_lines.sql nog open staat faalt DEZE select (42703) en
  // niet de export: de e-factuur is dan wat hij altijd was, zonder de regels. Zodra de
  // kolommen bestaan reizen ze mee naar het adresblok van de koper — dezelfde regels die de
  // PDF al drukt, want twee documenten over dezelfde factuur mogen niet verschillend
  // geadresseerd zijn.
  const { data: extraRow, error: extraErr } = await supabase
    .from("invoices")
    .select(CLIENT_EXTRA_LINE_COLUMNS.join(", "))
    .eq("id", invoiceId)
    .maybeSingle();
  if (extraErr && CLIENT_EXTRA_LINE_COLUMNS.some((c) => isUnknownColumn(extraErr, c))) {
    console.warn(
      "[KLANT-EXTRA] de klantregels ontbreken op deze e-factuur — pas " +
        "supabase/migrations/client_extra_lines.sql toe",
      { invoiceId },
    );
  }

  // ── Map DB rows → pure generator inputs ──
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
    ...((extraRow ?? {}) as Record<string, string | null>),
  };

  const lines: UblInvoiceLine[] = ((lineRows ?? []) as unknown as Array<{
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    btw_rate: number | null;
    line_total: number | null;
    unit?: string | null;
    vat_treatment?: string | null;
  }>).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    btw_rate: l.btw_rate,
    line_total: l.line_total,
    // [UNIT] Ontbreekt de kolom (migratie invoice_line_unit.sql nog niet toegepast), dan is
    // dit undefined en valt de export terug op C62 — precies het gedrag van vóór deze regel.
    unit: l.unit ?? null,
    // [E-FACTUUR] De vrijstellingsvlag werd hier WEL geselecteerd maar NIET doorgegeven — de
    // generator kreeg hem nooit, dus een vrijgestelde regel exporteerde als categorie Z
    // (0%-belast) in plaats van E. Dat is een ander juridisch feit, en precies het feit dat
    // de ontvanger anders moet boeken. Zelfde terugvalvorm als `unit`: kolom onbekend →
    // undefined → het gedrag van vóór de vlag.
    ...(l.vat_treatment !== undefined ? { vat_treatment: l.vat_treatment } : {}),
  }));

  const supplier: UblSupplier = profileRow as unknown as UblSupplier;

  // ── Generate ──
  let xml: string;
  let warnings: string[];
  try {
    const result = buildInvoiceUbl(header, lines, supplier, {
      korActive: !!(profileRow as { kor_active?: boolean | null }).kor_active,
    });
    xml = result.xml;
    warnings = result.warnings;
  } catch (err) {
    if (err instanceof UblValidationError) {
      return NextResponse.json(
        { error: dutchError(err.code, ownerId === user.id), code: err.code },
        { status: 422 }
      );
    }
    console.error("[BOEK-020] UBL generation error:", err);
    return NextResponse.json({ error: "UBL genereren mislukt" }, { status: 500 });
  }

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