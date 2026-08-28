// src/app/api/invoice/bulk-pdf/route.ts
// [BULK-PDF] Take several invoices away at once, as pdf.
//
// ── WHAT WAS MISSING ──
//
// Reported plainly: "I want to download invoices as pdf, but I have to open each one, open the pdf
// and press save — far too many steps." Both lists already let the owner select several rows; what
// they could not do afterwards is take them.
//
// ── THE ONE RULE THAT DECIDES EVERYTHING HERE ──
//
// A SENT invoice already has a pdf, and that stored file is the document the customer received. It
// is the evidence. Re-drawing it from the lines would produce a document that merely LOOKS like
// the one that was sent — a logo since changed, an address since corrected, a template since
// improved — and hand it over as if it were the original. So the stored file wins whenever there
// is one, and rendering is only ever the fallback for an invoice that never had one (a draft, or
// one created before the pdf was stored).
//
// That is also why nothing here writes: a download may not repair, backfill or normalise anything.
// It answers with what exists.
//
// ── PURCHASE INVOICES TOO ──
//
// direction 'incoming' works the same way and is even simpler: the supplier's own document is the
// only truth there, so a missing one is reported rather than invented. We never draw a supplier's
// invoice ourselves — that would be manufacturing someone else's paperwork.

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [ACTING-FOR] An employee downloading for the owner reads the owner's invoices, exactly as their
// screens show the owner's invoices.
import { getActingFor } from "@/lib/acting-for-server";
import { invoiceOwnerId } from "@/lib/acting-for";
import { planBulkPdf, bulkZipName, BULK_PDF_MAX } from "@/lib/invoice-bulk-pdf";
import { renderInvoicePdf } from "@/lib/invoice-pdf-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const acting = await getActingFor();
  if (!acting) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ownerId = invoiceOwnerId(acting);
  const supabase = await createServerSupabaseClient();

  let body: { ids?: unknown; direction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  const direction = body.direction === "incoming" ? "incoming" : "outgoing";

  // The cap is checked on what was ASKED for, before a single row is read: an owner who selected
  // three hundred rows should hear so immediately, not after the database has fetched them.
  if (ids.length === 0) {
    return NextResponse.json({ error: "Selecteer eerst de facturen die je wilt downloaden." }, { status: 400 });
  }
  if (ids.length > BULK_PDF_MAX) {
    return NextResponse.json(
      { error: `Je kunt er ${BULK_PDF_MAX} tegelijk downloaden. Selecteer er minder en herhaal het daarna voor de rest.` },
      { status: 400 },
    );
  }

  // Ownership is a WHERE, never a filter applied afterwards: the ids come from a client.
  const ownerColumn = direction === "incoming" ? "receiver_id" : "sender_id";
  const { data: rows, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, client_name, pdf_url, direction")
    .in("id", ids)
    .eq(ownerColumn, ownerId)
    .eq("direction", direction);
  if (error) {
    // [NO-SILENT-EMPTY] A failed read is not "none of these exist". Handing back an empty archive
    // over a hiccup would tell the owner their invoices have no documents.
    return NextResponse.json(
      { error: "We konden deze facturen nu niet ophalen — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  const invoices = rows ?? [];
  if (invoices.length === 0) {
    return NextResponse.json({ error: "Deze facturen zijn niet gevonden." }, { status: 404 });
  }

  const plan = planBulkPdf(invoices);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  // The sender's own details, once — every rendered invoice carries the same ones.
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name, full_name, email, phone, address, postal_code, city, kvk_number, btw_number, iban, kor_active, vat_exempt_activity, vat_statement_note")
    .eq("id", ownerId)
    .maybeSingle();

  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  /** Named, never counted: "3 of the 8 could not be included" is a number nobody can act on. */
  const missing: string[] = [];

  for (const inv of invoices) {
    const name = plan.names.get(inv.id)!;
    const stored = String(inv.pdf_url ?? "").trim();

    // 1. The stored file — the document that was actually sent, and therefore the evidence.
    if (stored) {
      const { data: blob } = await supabase.storage.from("documents").download(stored);
      if (blob) {
        files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        continue;
      }
    }

    // 2. A purchase invoice has no second source. Drawing one ourselves would be manufacturing the
    // supplier's paperwork, so it is reported by name instead.
    if (direction === "incoming") {
      missing.push(inv.invoice_number || name);
      continue;
    }

    // 3. Our own invoice with no stored pdf — a draft, or one from before pdfs were kept. Drawn
    // from its own lines, which is exactly what the screen would have shown.
    try {
      const { data: lines } = await supabase
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", inv.id)
        .order("id", { ascending: true });
      const bytes = await renderInvoicePdf(inv, lines ?? [], profile ?? {});
      files.push({ name, bytes: new Uint8Array(bytes) });
    } catch (e) {
      console.error("[BULK-PDF] rendering one invoice failed", {
        userId: ownerId, invoiceId: inv.id, error: e instanceof Error ? e.message : String(e),
      });
      missing.push(inv.invoice_number || name);
    }
  }

  // Nothing at all: say so, and say which. An empty archive is the worst possible answer — it
  // downloads, it opens, and it is empty.
  if (files.length === 0) {
    return NextResponse.json(
      {
        error:
          "Van deze facturen konden we geen enkel document ophalen. " +
          (missing.length ? `Het gaat om: ${missing.join(", ")}.` : ""),
      },
      { status: 404 },
    );
  }

  // One file → the pdf itself. Nobody should unpack an archive for a single invoice.
  if (files.length === 1 && missing.length === 0) {
    return new NextResponse(new Uint8Array(files[0].bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${files[0].name}"`,
        // [BULK-PDF] What could not be included travels in a header, because the body is the file
        // itself. The screen reads it and says so; without it a short archive looks complete.
        "X-Bulk-Missing": "0",
      },
    });
  }

  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bulkZipName()}"`,
      "X-Bulk-Missing": String(missing.length),
      // Names, not just a count — encoded because a header may not carry arbitrary bytes.
      "X-Bulk-Missing-Names": encodeURIComponent(missing.join(", ")),
    },
  });
}
