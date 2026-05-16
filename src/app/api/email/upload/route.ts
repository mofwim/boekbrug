// src/app/api/email/upload/route.ts
// [BOEK-011] Manual upload for paper/WhatsApp invoices
// POST multipart/form-data with 'file' field
// Runs AI classification → saves as incoming invoice with status='received'

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { classifyDocument } from "@/lib/ai";

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

  // Validate file type
  const allowed = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/webp",
  ];
  if (!allowed.includes(file.type) && !file.name.endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Alleen PDF of afbeelding toegestaan" },
      { status: 400 }
    );
  }

  // Max 10MB
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Bestand te groot — max 10MB" },
      { status: 400 }
    );
  }

  // AI classification using filename + metadata as context
  const fileDescription = [
    `Bestandsnaam: ${file.name}`,
    `Bestandstype: ${file.type}`,
    `Grootte: ${Math.round(file.size / 1024)}KB`,
    `Bron: handmatige upload door gebruiker`,
  ].join("\n");

  const classification = await classifyDocument(fileDescription, file.name);

  // Save to Supabase Storage → documents bucket
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const storagePath = `${user.id}/${year}/Q${quarter}/${Date.now()}-${file.name}`;

  const { error: storageError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (storageError) {
    // Storage failed — still save invoice record without PDF
    console.error("[BOEK-011] Storage upload failed:", storageError.message);
  }

  const { data: signedUrl } = storageError
    ? { data: null }
    : await supabase.storage
        .from("documents")
        .createSignedUrl(storagePath, 3600 * 24 * 7);

  // Save invoice record
  const invoiceDate = classification.date
    ? new Date(classification.date).toISOString().split("T")[0]
    : now.toISOString().split("T")[0];

  const { data: invoice, error: dbError } = await supabase
    .from("invoices")
    .insert({
      sender_id: user.id,
      direction: "incoming",
      status: "received",
      source: "upload",
      client_name: classification.vendor || "Onbekende afzender",
      invoice_date: invoiceDate,
      total_inc_btw: classification.amount || 0,
      total_ex_btw: 0,
      btw_amount: 0,
      invoice_number: `UPLOAD-${Date.now()}`,
      pdf_url: signedUrl?.signedUrl || null,
    })
    .select("id, client_name, client_email, total_inc_btw, invoice_date, invoice_number, source, created_at")
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Also save to documents table for file management
  if (!storageError) {
    await supabase.from("documents").insert({
      user_id: user.id,
      file_name: file.name,
      file_url: storagePath,
      file_size: file.size,
      file_type: file.type,
      doc_type: classification.type === "receipt" ? "bon" : "factuur",
      year,
      source: "upload",
      ai_processed: true,
      ai_doc_type: classification.type,
    });
  }

  return NextResponse.json({ invoice, classification });
}