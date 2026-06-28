// src/app/api/bank/attach-invoice/route.ts
// [BANK-ATTACH] Attach a document to an UNMATCHED bank transaction (the "Geen
// factuur" tab). The owner uploads the file that belongs to a real payment we
// already see on the statement (a supplier invoice that was never imported, an
// electricity/internet bill, a rent/lease receipt). We:
//   1. read the file with the SAME AI extractor as manual upload (vendor, amount,
//      full BTW breakdown, date, vendor IBAN) — so the owner re-types nothing,
//   2. create the incoming invoice from that extraction (+ the bank amount/date
//      as the source of truth for the money side),
//   3. link the transaction to the new invoice and mark it paid.
//
// This merges two existing flows (api/email/upload + api/bank/confirm) into one
// atomic-ish action. Money discipline is unchanged:
//   - invoice → 'paid' uses the SESSION client so the B.4 verwerkt trigger fires.
//   - bank_transactions → 'matched' uses the pipeline (service_role), user-pinned.
//   - the file/invoice/transaction end up linked three ways and SHARED with the
//     accountant (status 'paid' is included in the `shared` GENERATED column).
//
// Honest by design: the owner is attaching the file for a payment THEY made and
// can SEE on their statement → the invoice is created already-confirmed ('paid'),
// not held in 'processing'. AI prepares the fields; the owner confirms by acting.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { verifyInvoiceFromPdf } from "@/lib/ai";
import { resolveImportTarget } from "@/lib/bestanden";
import { computeContentHash } from "@/lib/content-hash";
import { buildFolderBreadcrumb } from "@/lib/documents";
import { logAuditAction, getClientIP } from "@/lib/audit";

// Amount agreement tolerance between the AI-read invoice total and the bank
// transaction. Within this → link silently. Outside → still allow, but flag a
// warning so the UI can ask the owner to double-check (AI misread is possible).
const AMOUNT_TOLERANCE = 0.02;

export async function POST(req: NextRequest) {
  // 1. Auth — session client (RLS). The owner acts on their own data.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // 2. Read form: the file + the target transaction id.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Ongeldig formulier" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const transactionId = (formData.get("transactionId") as string | null)?.trim();
  if (!file) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }
  if (!transactionId) {
    return NextResponse.json({ error: "Geen transactie opgegeven" }, { status: 400 });
  }

  const okType =
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!okType) {
    return NextResponse.json({ error: "Alleen PDF of afbeelding toegestaan" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Bestand te groot — max 10MB" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // 3. The transaction must exist, belong to the user, and still be pending.
  //    (Same ownership/state discipline as api/bank/confirm.)
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, user_id, amount, date")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }
  if (tx.status !== "pending") {
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }

  // A debit (money out, negative) → incoming invoice (an expense). Attaching a
  // file to a credit (money in) would mean an outgoing invoice, which this flow
  // doesn't create — guard against it rather than produce a wrong record.
  if ((tx.amount ?? 0) >= 0) {
    return NextResponse.json(
      { error: "only_expense_supported", detail: "Alleen uitgaande betalingen kunnen aan een inkoopfactuur worden gekoppeld." },
      { status: 422 }
    );
  }

  // 4. Read bytes + byte-hash dedup (same gate as manual upload).
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");
  const contentHash = computeContentHash(buffer);

  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, file_name, folder_id")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  if (existingDoc) {
    const folderPath = await buildFolderBreadcrumb(supabase, user.id, existingDoc.folder_id ?? null);
    await logAuditAction({
      userId: user.id,
      action: "document.duplicate_blocked",
      entityType: "document",
      entityId: existingDoc.id,
      newValue: { file_name: file.name, content_hash: contentHash, path: "bank_attach" },
      ipAddress: getClientIP(req),
    });
    const where = folderPath.length
      ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
      : "Dit bestand is al toegevoegd";
    return NextResponse.json({ error: where, duplicate: true }, { status: 409 });
  }

  // 5. Who are WE (receiver) — so the AI never returns us as the vendor.
  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const receiverName = me?.company_name || me?.full_name || null;

  // 6. AI extraction. We do NOT hard-reject a non-invoice here: a rent/lease
  //    receipt or a bank confirmation is a legitimate expense document even if
  //    the AI isn't confident it's a "factuur". We still store it and link it;
  //    BTW simply stays 0 when the AI can't find it (correct for rent).
  const verification = await verifyInvoiceFromPdf(base64, file.type, file.name, receiverName);

  // Money side: the BANK is the source of truth for the paid amount/date.
  const bankAmount = Math.abs(tx.amount ?? 0);
  const invoiceDate = tx.date
    ? new Date(tx.date).toISOString().split("T")[0]
    : verification.invoice_date
      ? new Date(verification.invoice_date).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

  // Prefer the AI total when it agrees with the bank; otherwise trust the bank
  // amount (what actually moved) and flag a warning for the owner to verify.
  const aiTotal = verification.total_inc_btw ?? verification.amount ?? null;
  const amountAgrees =
    aiTotal != null && Math.abs(aiTotal - bankAmount) <= AMOUNT_TOLERANCE;
  const totalIncBtw = amountAgrees ? aiTotal! : bankAmount;
  // Keep the AI's BTW split only if the totals agree (otherwise it's unreliable).
  const totalExBtw = amountAgrees ? (verification.total_ex_btw ?? 0) : 0;
  const btwAmount = amountAgrees ? (verification.btw_amount ?? 0) : 0;
  const amountWarning = aiTotal != null && !amountAgrees;

  // 7. Store the file in Storage + documents (same shape as manual upload).
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: "Opslaan van bestand mislukt" }, { status: 500 });
  }

  const folderId = await resolveImportTarget(
    user.id,
    verification.invoice_date ?? invoiceDate,
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
      content_hash: contentHash,
    })
    .select("id")
    .single();
  const documentId = doc?.id ?? null;

  // 8. Create the incoming invoice — already 'paid' (the owner attached the file
  //    for a payment they SEE on the statement). Incoming → receiver_id = user,
  //    sender_id = null. service_role required (RLS expects sender_id = auth.uid()).
  //    payment_method 'bank' + marked_paid_at mirror api/bank/confirm.
  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: user.id,
      direction: "incoming",
      status: "paid", // attached to a real, visible bank payment
      payment_method: "bank",
      marked_paid_at: new Date().toISOString(),
      source: "upload",
      client_name: verification.vendor || "Onbekende afzender",
      invoice_date: invoiceDate,
      invoice_number: verification.invoice_number || `UPLOAD-${Date.now()}`,
      total_ex_btw: totalExBtw,
      btw_amount: btwAmount,
      total_inc_btw: totalIncBtw,
      pdf_url: storagePath,
      document_id: documentId,
      vendor_iban: verification.vendor_iban ?? null,
      payment_reference: verification.payment_reference ?? null,
      field_confidence: verification.field_confidence ?? null,
    })
    .select("id")
    .single();

  if (dbError || !invoice) {
    return NextResponse.json({ error: dbError?.message || "Aanmaken factuur mislukt" }, { status: 500 });
  }

  // 9. Link document → invoice (bidirectional).
  if (documentId) {
    await pipeline.from("documents").update({ invoice_id: invoice.id }).eq("id", documentId);
  }

  // 10. Link the transaction → matched + invoice_id. Pipeline, user-pinned,
  //     only pending → matched (never overwrite an existing link).
  const { error: linkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "matched", invoice_id: invoice.id })
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending");

  if (linkErr) {
    // The invoice is created + paid + shared regardless; only the tx link failed.
    // Self-healing: re-running /api/bank/match surfaces the tx again.
    console.error("[BANK-ATTACH] transaction link failed:", linkErr.message);
    return NextResponse.json({
      ok: true,
      invoice_id: invoice.id,
      warning: "transaction_link_failed",
      amountWarning,
    });
  }

  // 11. Notification (non-blocking) — service_role by rule.
  try {
    await pipeline.from("notifications").insert({
      user_id: user.id,
      title: "Factuur gekoppeld",
      body: `Een bestand is gekoppeld aan een banktransactie en opgeslagen als betaalde inkoopfactuur (${verification.vendor || "onbekende leverancier"}).`,
      type: "payment",
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({
    ok: true,
    invoice_id: invoice.id,
    vendor: verification.vendor ?? null,
    amountWarning, // UI can prompt "controleer het bedrag" when AI total disagreed
  });
}