// src/app/api/email/reimport/[id]/route.ts
// [REIMPORT] Re-read a stored incoming-invoice PDF with the CURRENT extractor and refresh the
// SAME invoice row. This is the owner's self-heal for a mis-read invoice (wrong amount, a
// statement booked as an invoice, a creditnota blanked to €0) after the extractor improves.
//
// THREE SAFETY GUARDS (money-truth):
//   1. Never overwrite human work — allowed ONLY while status = 'processing' (still in the
//      verify queue). A 'received' / 'paid' / 'archived' invoice has been human-confirmed or
//      pushed to the accountant; re-reading it is refused (409).
//   2. Same row, never a duplicate — UPDATE by id (+ receiver_id + status guard), never INSERT.
//   3. Never auto-verify — the status STAYS 'processing'; the human still confirms.
// The re-read result never leaves the owner's account and never marks anything paid/shared.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { classifyAttachment } from "@/lib/email-integration";
import { evaluateArithmetic, deriveDueDate } from "@/lib/safecore";
import { logAuditAction, getClientIP } from "@/lib/audit";
import type { Database } from "@/types/database.types";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];

// [REREAD-STRONG] The manual "Opnieuw inlezen" is a single, user-initiated re-read of ONE flagged
// invoice — the right place to spend a stronger model that reads the real page layout. The
// automatic sync stays on Haiku (cheap, high-volume). This is the fix for complex invoices Haiku
// mis-reads on every pass (statiegeld/retour, net-negative creditnota, crowded multi-column
// tables). Must be a model enabled on the account.
const REREAD_MODEL = "claude-sonnet-5";

// [REREAD-STRONG] A raw-PDF read on the stronger model is slower than the Haiku text path — give
// the route headroom so a heavy invoice doesn't get killed mid-read. Cap still depends on the plan.
export const maxDuration = 120;

// A stored value may be a relative path (new) or a legacy full signed/public URL. Normalise
// to the bucket-relative path. (Mirror of the helper in api/email/file/[id].)
function toStoragePath(stored: string): string {
  if (stored.startsWith("http")) {
    const signMarker = "/object/sign/documents/";
    const publicMarker = "/object/public/documents/";
    let idx = stored.indexOf(signMarker);
    if (idx !== -1) {
      idx += signMarker.length;
    } else {
      idx = stored.indexOf(publicMarker);
      if (idx === -1) return stored;
      idx += publicMarker.length;
    }
    return decodeURIComponent(stored.slice(idx).split("?")[0]);
  }
  return stored;
}

// [HUNT-Q4] Identify a file by its magic bytes — authoritative over a filename/extension
// guess. Returns null when the header isn't one the classifier can read (leave the guess).
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf"; // %PDF
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif"; // GIF8
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Load + prove ownership. Keep the current values so a poorer re-read can't wipe metadata.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, receiver_id, direction, status, pdf_url, document_id, client_name, invoice_number, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw, field_confidence")
    .eq("id", id)
    .single();

  if (!invoice || invoice.receiver_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }
  if (invoice.direction !== "incoming") {
    return NextResponse.json({ error: "Alleen inkomende facturen kunnen opnieuw ingelezen worden" }, { status: 400 });
  }
  // GUARD 1 — never overwrite human-confirmed data.
  if (invoice.status !== "processing") {
    return NextResponse.json(
      { error: "Deze factuur is al geverifieerd of gearchiveerd — opnieuw inlezen kan alleen zolang hij nog in de controlewachtrij staat." },
      { status: 409 }
    );
  }
  if (!invoice.pdf_url) {
    return NextResponse.json({ error: "Geen bestand gekoppeld aan deze factuur" }, { status: 404 });
  }

  // Media type + filename from the linked document; fall back to the stored path's extension
  // (older rows may have no document_id) so an image invoice isn't misread as a PDF.
  let mimeType = "";
  let filename = "factuur.pdf";
  if (invoice.document_id) {
    const { data: doc } = await supabase
      .from("documents")
      .select("file_type, file_name")
      .eq("id", invoice.document_id)
      .maybeSingle();
    if (doc?.file_type) mimeType = doc.file_type;
    if (doc?.file_name) filename = doc.file_name;
  }
  if (!mimeType) {
    const ext = invoice.pdf_url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1] ?? "";
    mimeType =
      ext === "png" ? "image/png"
      : (ext === "jpg" || ext === "jpeg") ? "image/jpeg"
      : ext === "webp" ? "image/webp"
      : ext === "gif" ? "image/gif"
      : "application/pdf";
  }

  // Receiver identity — so the extractor never returns US as the vendor.
  let receiverName: string | null = null;
  let receiverKvk: string | null = null;
  let receiverBtw: string | null = null;
  let receiverIban: string | null = null;
  {
    const { data: me } = await supabase
      .from("profiles")
      .select("company_name, full_name, kvk_number, btw_number, iban")
      .eq("id", user.id)
      .maybeSingle();
    receiverName = me?.company_name?.trim() || me?.full_name?.trim() || null;
    // [RECEIVER-IDENTITY] our own legal numbers → backstop drops any vendor field equal to ours.
    receiverKvk = me?.kvk_number?.trim() || null;
    receiverBtw = me?.btw_number?.trim() || null;
    receiverIban = me?.iban?.trim() || null;
  }

  // Download the stored bytes. Storage bucket RLS is separate from table RLS; ownership is
  // already proven above, so the pipeline client is used only to read this one proven file.
  const pipeline = createPipelineClient();
  const storagePath = toStoragePath(invoice.pdf_url);
  const { data: blob, error: dlErr } = await pipeline.storage.from("documents").download(storagePath);
  if (dlErr || !blob) {
    console.error("[REIMPORT] download failed", { invoiceId: id, storagePath, dlErr });
    return NextResponse.json({ error: "Kon het bestand niet lezen" }, { status: 500 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  // [HUNT-Q4] The magic bytes are authoritative over the filename/extension guess above —
  // a legacy image invoice on an extension-less path would otherwise be read as a PDF and
  // fail the classifier's PDF-magic check. Override the mime when the bytes are unambiguous.
  const sniffed = sniffMime(buf);
  if (sniffed) mimeType = sniffed;
  const base64 = buf.toString("base64");

  // Re-read with the CURRENT extractor (same path the import uses → identical behaviour).
  let c: Awaited<ReturnType<typeof classifyAttachment>>;
  try {
    c = await classifyAttachment(base64, mimeType, filename, receiverName, {
      model: REREAD_MODEL,
      preferRawPdf: true,
      receiverKvk,
      receiverBtw,
      receiverIban,
    });
  } catch (e) {
    console.error("[REIMPORT] classify failed", { invoiceId: id, e });
    return NextResponse.json({ error: "Kon de factuur nu niet opnieuw lezen — probeer het later opnieuw." }, { status: 502 });
  }

  // If the fresh read now says this is NOT a bookable invoice (e.g. it's a statement of
  // account, or it could not be read), do NOT wipe the row — report so the human decides
  // whether to keep or ignore it. Nothing is changed.
  if (!c.isInvoice) {
    return NextResponse.json({
      ok: false,
      notInvoice: true,
      reason: c.reason ?? null,
    });
  }

  // Build the refresh patch — the extraction-derived fields only. Identity/links (receiver,
  // pdf_url, document_id, source_message_id) are never touched. Metadata (vendor/number/date)
  // keeps the stored value when the fresh read is empty, so a re-read can only improve it.
  // [DOUBLE-CHECK #1] Amounts are IMPROVE-OR-KEEP, never blindly fresh. If the fresh read
  // recognised an invoice but could NOT read a usable total (freshHasTotal false), keep the
  // stored amounts — otherwise a poorer re-read would wipe correct €121/€21/€100 to €0/€0/€0.
  const freshTotal = c.totalIncBtw ?? c.amount;
  const freshHasTotal = typeof freshTotal === "number" && isFinite(freshTotal);

  const verdict = freshHasTotal
    ? evaluateArithmetic(c, { isCreditNote: c.isCreditNote === true })
    : null;
  // [DOUBLE-CHECK #3] Preserve non-AI keys already on field_confidence that the fresh AI read
  // does not carry: the camera-intake hints (_intake_*) always, and — only when we are KEEPING
  // the stored amounts (no fresh total) — the prior _safecore/_dedup note, so the verdict on
  // those unchanged amounts stays valid instead of being silently dropped.
  const priorFc = (invoice.field_confidence ?? null) as Record<string, unknown> | null;
  const carried: Record<string, unknown> = {};
  if (priorFc) {
    for (const k of Object.keys(priorFc)) {
      if (k.startsWith("_intake")) carried[k] = priorFc[k];
      else if (!freshHasTotal && (k === "_safecore" || k.startsWith("_dedup"))) carried[k] = priorFc[k];
    }
  }
  const aiConfidence = (c.fieldConfidence ?? null) as Record<string, unknown> | null;
  let fieldConfidenceValue: Record<string, unknown> | null =
    aiConfidence || Object.keys(carried).length ? { ...(aiConfidence ?? {}), ...carried } : null;
  // A FRESH verdict (amounts were re-read) is the authority on _safecore: set it when the
  // fresh amounts don't reconcile; a clean fresh read carries no stale hold.
  if (verdict && !verdict.ok) {
    fieldConfidenceValue = {
      ...(fieldConfidenceValue ?? {}),
      _safecore: {
        arithmetic_ok: false,
        reason: verdict.reason,
        flags: verdict.flags,
        held_at: new Date().toISOString(),
      },
    };
  }

  // The effective invoice date the patch writes (fresh-or-keep) — also drives due_date.
  const freshDate = (typeof c.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.invoiceDate))
    ? c.invoiceDate : invoice.invoice_date;

  const patch: InvoiceUpdate = {
    updated_at: new Date().toISOString(),
    total_ex_btw: freshHasTotal ? (c.totalExBtw ?? 0) : invoice.total_ex_btw,
    btw_amount: freshHasTotal ? (c.btwAmount ?? 0) : invoice.btw_amount,
    total_inc_btw: freshHasTotal ? (c.totalIncBtw ?? c.amount ?? 0) : invoice.total_inc_btw,
    invoice_type: c.isCreditNote === true ? "creditnota" : "factuur",
    vendor_iban: c.vendorIban ?? null,
    payment_reference: c.paymentReference ?? null,
    field_confidence: fieldConfidenceValue as InvoiceUpdate["field_confidence"],
    // Metadata: improve-or-keep (never wipe a good stored value with an empty re-read).
    client_name: (c.vendor && c.vendor.trim()) ? c.vendor.trim() : invoice.client_name,
    invoice_number: (c.invoiceNumber && c.invoiceNumber.trim()) ? c.invoiceNumber.trim() : invoice.invoice_number,
    invoice_date: freshDate,
    // [DOUBLE-CHECK #2] Recompute due_date from the effective date + fresh term, so a
    // corrected invoice date doesn't leave a stale due date driving reminders/overdue.
    due_date: deriveDueDate(freshDate, c.dueDate ?? null, c.paymentTermDays ?? null) ?? invoice.due_date,
    // status intentionally NOT set — stays 'processing' (never auto-verify).
  };

  // GUARD 2 + 3 — update the SAME row, and the status guard makes it a no-op if the invoice
  // was verified/archived between the load and now (TOCTOU-safe: never revives a confirmed row).
  const { data: updated, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    // The status guard matched no row — the invoice left the queue concurrently.
    return NextResponse.json(
      { error: "Deze factuur staat niet meer in de controlewachtrij — vernieuw de pagina." },
      { status: 409 }
    );
  }

  // Legal trail: who re-read what, and the resulting amounts.
  await logAuditAction({
    userId: user.id,
    action: "invoice.reimported",
    entityType: "invoice",
    entityId: id,
    oldValue: {
      client_name: invoice.client_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
    },
    newValue: {
      total_ex_btw: patch.total_ex_btw,
      btw_amount: patch.btw_amount,
      total_inc_btw: patch.total_inc_btw,
      invoice_type: patch.invoice_type,
      client_name: patch.client_name,
      invoice_number: patch.invoice_number,
      invoice_date: patch.invoice_date,
      arithmetic_ok: verdict ? verdict.ok : null,
    },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    ok: true,
    invoice: {
      total_ex_btw: patch.total_ex_btw,
      btw_amount: patch.btw_amount,
      total_inc_btw: patch.total_inc_btw,
      invoice_type: patch.invoice_type,
      client_name: patch.client_name,
      invoice_number: patch.invoice_number,
      invoice_date: patch.invoice_date,
      arithmetic_ok: verdict ? verdict.ok : null,
    },
  });
}
