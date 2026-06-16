// src/app/api/email/upload/route.ts
// [BOEK-011] Manual upload for paper/WhatsApp invoices
// POST multipart/form-data with 'file' field
// Claude verifies → if real invoice → stored in Storage + documents + invoices

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [BOEK-011 + BOEK-SECURITY] invoice insert needs service_role to bypass
// invoices_zzp_insert RLS — that policy expects sender_id = auth.uid(),
// but incoming invoices have sender_id = null.
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { verifyInvoiceFromPdf } from "@/lib/ai";
import { resolveImportTarget } from "@/lib/bestanden";

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
    return NextResponse.json({ error: "Ongeldig formulier" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }

  const okType =
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!okType) {
    return NextResponse.json(
      { error: "Alleen PDF of afbeelding toegestaan" },
      { status: 400 }
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Bestand te groot — max 10MB" }, { status: 400 });
  }

  // Read file bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");

  // [BOEK-011] Claude verifies the actual file
  const verification = await verifyInvoiceFromPdf(base64, file.type, file.name);

  if (!verification.is_invoice) {
    return NextResponse.json(
      {
        error:
          verification.reason ||
          "Dit lijkt geen factuur te zijn. Alleen facturen kunnen worden toegevoegd.",
        rejected: true,
      },
      { status: 422 }
    );
  }

  // Store the file in Supabase Storage
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  let documentId: string | null = null;
  let pdfUrl: string | null = null;

  const invoiceDate = verification.invoice_date
    ? new Date(verification.invoice_date).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  if (!uploadError) {
    pdfUrl = storagePath;

    // [BOEK-011] Resolve correct folder via BOEK-033's function
    // ctx='user' — manual upload, user is logged in (RLS session active)
    const folderId = await resolveImportTarget(
      user.id,
      verification.invoice_date ?? null,
      "facturen",
      "user"
    );

    const { data: doc } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        file_name: file.name,
        file_url: storagePath,
        file_size: file.size,
        file_type: file.type,
        doc_type: "factuur",
        folder_id: folderId,
        year: new Date(invoiceDate).getFullYear(),
        source: "upload",
        ai_processed: true,
        ai_doc_type: "invoice",
      })
      .select("id")
      .single();
    documentId = doc?.id ?? null;
  }

  // Save the invoice — status 'received', awaiting confirmation
  // [BOEK-011 + BOEK-SECURITY] Incoming invoice: receiver_id = user, sender_id = null.
  // Must use service_role: invoices_zzp_insert RLS requires sender_id = auth.uid(),
  // which fails for incoming (sender_id is null — vendor isn't a BoekBrug user).
  const pipeline = createPipelineClient();
  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: user.id,
      direction: "incoming",
      // [BRIDGE-B] Hold state — not shared with the accountant until the client
      // verifies. 'processing' is excluded from the `shared` GENERATED expression.
      status: "processing",
      source: "upload",
      client_name: verification.vendor || "Onbekende afzender",
      invoice_date: invoiceDate,
      invoice_number: verification.invoice_number || `UPLOAD-${Date.now()}`,
      total_ex_btw: verification.total_ex_btw ?? 0,
      btw_amount: verification.btw_amount ?? 0,
      total_inc_btw: verification.total_inc_btw ?? verification.amount ?? 0,
      pdf_url: pdfUrl,
      document_id: documentId,
    })
    .select("id")
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // [BOEK-011] Link document back to invoice (bidirectional) — same pipeline
  if (documentId && invoice?.id) {
    await pipeline
      .from("documents")
      .update({ invoice_id: invoice.id })
      .eq("id", documentId);
  }

  return NextResponse.json({ ok: true, invoice_id: invoice?.id });
}