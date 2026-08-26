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
  type UblSupplier,
} from "@/lib/ubl-export";
// [E-FACTUUR] De SELECT's en de rij → generator-afbeelding staan in één module, omdat het
// kwartaalpakket dezelfde e-factuur bouwt. Een tweede kopie van die afbeelding zou niet opvallen
// en wél uiteenlopen — en dan zijn er twee e-facturen van één factuur die van elkaar verschillen.
import {
  UBL_INVOICE_SELECT,
  UBL_LINES_SELECT,
  UBL_LINES_SELECT_MINIMAL,
  UBL_PROFILE_SELECT,
  ublHeaderFrom,
  originalInvoiceRef,
  ublLinesFrom,
  type UblInvoiceRow,
  type UblLineRow,
} from "@/lib/ubl-inputs";
// [UNIT] Herkent "die kolom ken ik niet" (42703/PGRST204) — zie de terugval bij de regels.
import { isUnknownColumn } from "@/lib/created-by";
// [KLANT-EXTRA] De drie vrije klantregels, in een EIGEN mislukbare leesbeurt — de hoofdselect
// noemt zijn kolommen expliciet, en die mag niet falen op een database waar de migratie nog
// open staat. Zelfde vorm als de terugkerende-facturen-cron.
import { CLIENT_EXTRA_LINE_COLUMNS } from "@/lib/client-extra-lines";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";




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
    case "CLIENT_MISSING_PEPPOL_ADDRESS":
      // [SI-UBL] Peppol routes on het BTW-nummer van de klant (EAS 9944) — zonder dat nummer
      // heeft een BIS-document geen bestemming.
      return "Voor een Peppol-versie is het BTW-nummer van de klant nodig. Vul dat in op de factuur en probeer opnieuw.";
    case "CLIENT_PEPPOL_EAS_UNSUPPORTED":
      // [SI-UBL-EAS] Een adres met een verkeerd schema komt aan de andere kant nooit aan — dan
      // liever eerlijk weigeren met het land erbij.
      return "Het BTW-nummer van deze klant komt uit een land waarvoor we het Peppol-adresschema nog niet ondersteunen. De gewone UBL-export werkt wel.";
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

  // [DIEP-3] One invoice per call — a per-action ceiling, not the year-scale one: handing a
  // quarter to a boekhoudpakket goes invoice-by-invoice and legitimately reaches hundreds.
  const limited = await checkRateLimit({ userId: user.id, endpoint: "ubl-export", ...RATE_LIMITS.UBL_SINGLE });
  if (!limited.allowed) return rateLimitResponse(limited);

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  // [SI-UBL] De Peppol-variant van hetzelfde document — zie UblBuildOptions.peppol.
  const peppol = req.nextUrl.searchParams.get("peppol") === "1";
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId ontbreekt" }, { status: 400 });
  }

  // ── Invoice (by id; RLS still applies: own invoice, or accountant on a
  //    shared/paid client invoice) ──
  const { data: invoiceRow, error: invErr } = await supabase
    .from("invoices")
    .select(UBL_INVOICE_SELECT)
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
    .select(UBL_LINES_SELECT)
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
          .select(UBL_LINES_SELECT_MINIMAL)
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
    .select(UBL_PROFILE_SELECT)
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
  } else if (extraErr) {
    // [KLANT-EXTRA] Alleen de open-migratie-fout is onschuldig. Elke andere leesfout betekent dat
    // de factuur klantregels KAN dragen die we niet hebben gelezen — en een geldig bestand waarin
    // inhoud ontbreekt is erger dan een weigering: het pakket van de ontvanger boekt het als
    // compleet. Zelfde regel als de mailroute (ubl-for-email.ts), zodat de twee paden niet twee
    // verschillende bestanden van één factuur maken.
    return NextResponse.json(
      { error: "We konden de factuur nu niet volledig lezen. Probeer het zo opnieuw." },
      { status: 503 },
    );
  }

  // ── Map DB rows → pure generator inputs ──
  // [E-FACTUUR] Via ubl-inputs.ts, niet hier. Deze afbeelding stond hier ooit uitgeschreven, en
  // twee keer is er in dat handwerk een kolom weggevallen die WÉL was geselecteerd: eerst
  // `vat_treatment` (een vrijgestelde regel exporteerde als 0%-belast), daarna `discount_type` en
  // `discount_value` (elke regelkorting was onzichtbaar in de e-factuur, dus BG-27 werd nooit
  // geschreven en er stond een stuksprijs op die niemand had afgesproken). Beide keren bleef het
  // bestand geldig en werd het niets zichtbaars — dat is precies waarom dit één plek moet zijn.
  // [CREDIT-REF] BG-3 for a creditnota — its own best-effort read, like the extra lines above.
  const origRef = await originalInvoiceRef(supabase, inv as unknown as UblInvoiceRow);
  const header = ublHeaderFrom(inv as unknown as UblInvoiceRow, (extraRow ?? null) as Record<string, string | null> | null, origRef);
  const lines = ublLinesFrom((lineRows ?? []) as unknown as UblLineRow[]);

  const supplier: UblSupplier = profileRow as unknown as UblSupplier;

  // ── Generate ──
  let xml: string;
  let warnings: string[];
  try {
    const result = buildInvoiceUbl(header, lines, supplier, {
      korActive: !!(profileRow as { kor_active?: boolean | null }).kor_active,
      // [SI-UBL] ?peppol=1 vraagt dezelfde factuur als Peppol BIS 3.0-document — één bouwer,
      // twee identiteiten, nooit twee bedragen.
      peppol,
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
  const filename = `boekbrug-factuur-${safeFilenamePart(inv.invoice_number)}${peppol ? "-peppol" : ""}-ubl.xml`;

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