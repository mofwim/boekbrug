// src/app/api/intake/route.ts
// [SMART-INTAKE] Unified intake point. One upload (camera/file) → classify →
// route to the right destination. Reuses existing building blocks; does NOT
// replace /api/email/upload or /api/bank/upload (kept for back-compat).
//
// Flow:
//   1. auth + read file (image / pdf / bank text/xml)
//   2. byte-hash dedup (same file already imported → 409, cross-path)
//   3. pre-AI: is it a bank statement (by shape)? → bank pipeline, done.
//   4. AI verify+classify (image/pdf): invoice / receipt / other + is_paid
//   5. route:
//        - 'document' (other / not invoice) → store in bestanden only
//        - 'invoice'  → invoices, status 'processing' → verify queue
//        - 'receipt'  → invoices, status 'processing', suggest 'paid' in the
//                       verify queue (human confirms — Pillar ⑤)
//
// Money-truth guardrails: a receipt is NEVER auto-marked paid; it is SUGGESTED.
// A bank statement is never run through the invoice extractor. SAFECORE Rule 1
// (arithmetic) still applies on the invoice/receipt write path.

import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase-server"
import { createPipelineClient } from "@/lib/supabase-pipeline"
import { verifyInvoiceFromPdf } from "@/lib/ai"
import { resolveImportTarget, ensureImportedFolder } from "@/lib/bestanden"
import { computeContentHash } from "@/lib/content-hash"
import { buildFolderBreadcrumb } from "@/lib/documents"
import { parseBankFile } from "@/lib/bank-parser"
import { dedupTransactions, mapToRows, dateRange } from "@/lib/bank-import"
import { logAuditAction, getClientIP } from "@/lib/audit"
import { decidePreAi, decideFromAi } from "@/lib/intake-router"
// [SMART-INTAKE] jsonb column type for invoices.field_confidence — same pattern
// as email-integration.ts / audit.ts: derive the Json type, cast at write.
import type { Database } from "@/types/database.types"
type InvoiceFieldConfidence =
  Database["public"]["Tables"]["invoices"]["Insert"]["field_confidence"]

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Ongeldig formulier" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Bestand te groot — max 10MB" }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // ── Stage 1: bank statement by file shape (pre-AI) ──────────────────────────
  // Read a small text head only when the file could be text/xml (cheap).
  const couldBeText =
    file.type === "" ||
    file.type === "text/plain" ||
    file.type === "text/xml" ||
    file.type === "application/xml" ||
    /\.(xml|mt940|sta|camt|053|txt)$/i.test(file.name)
  const textHead = couldBeText ? buffer.slice(0, 4096).toString("utf8") : undefined

  const preAi = decidePreAi(file.name, file.type, textHead)
  if (preAi?.destination === "bank") {
    return handleBankStatement(buffer, file.name, user.id)
  }

  // ── Type guard for the AI path: only pdf/image go to the extractor ──────────
  const okForAi =
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    file.name.toLowerCase().endsWith(".pdf")
  if (!okForAi) {
    return NextResponse.json(
      { error: "Niet-ondersteund bestand. Upload een foto, PDF of bankafschrift (MT940/CAMT)." },
      { status: 400 }
    )
  }

  // ── Byte-hash dedup (cross-path: same hash as email / upload / bestanden) ───
  const contentHash = computeContentHash(buffer)
  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, file_name, folder_id")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle()

  if (existingDoc) {
    const folderPath = await buildFolderBreadcrumb(supabase, user.id, existingDoc.folder_id ?? null)
    await logAuditAction({
      userId: user.id,
      action: "document.duplicate_blocked",
      entityType: "document",
      entityId: existingDoc.id,
      newValue: { file_name: file.name, content_hash: contentHash, path: "intake" },
      ipAddress: getClientIP(req),
    })
    const where = folderPath.length
      ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
      : "Dit bestand is al toegevoegd"
    return NextResponse.json({ error: where, duplicate: true }, { status: 409 })
  }

  // ── Stage 2: AI verify + classify ───────────────────────────────────────────
  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", user.id)
    .maybeSingle()
  const receiverName = me?.company_name || me?.full_name || null

  const base64 = buffer.toString("base64")
  const v = await verifyInvoiceFromPdf(base64, file.type, file.name, receiverName)

  const decision = decideFromAi({
    is_invoice: v.is_invoice,
    document_kind: v.document_kind,
    is_paid: v.is_paid,
    confidence: v.confidence,
  })

  // ── Store the file in Storage (shared by all destinations) ──────────────────
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })
  const pdfUrl = uploadError ? null : storagePath

  const pipeline = createPipelineClient()

  // ── Destination: document (not an invoice/receipt) → bestanden only ─────────
  if (decision.destination === "document") {
    const folderId = await ensureImportedFolder(user.id, "pipeline")
    const { data: doc } = await pipeline
      .from("documents")
      .insert({
        user_id: user.id,
        file_name: file.name,
        file_url: storagePath,
        file_size: file.size,
        file_type: file.type,
        doc_type: "overig",
        folder_id: folderId,
        source: "camera",
        ai_processed: true,
        ai_doc_type: v.document_kind ?? "other",
        content_hash: contentHash,
      })
      .select("id")
      .single()
    return NextResponse.json({
      ok: true,
      destination: "document",
      document_id: doc?.id ?? null,
      message: "Opgeslagen in je bestanden (geen factuur of bon herkend).",
    })
  }

  // ── Destination: invoice or receipt → documents + invoices (verify queue) ───
  const invoiceDate = v.invoice_date
    ? new Date(v.invoice_date).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0]

  const folderId = await resolveImportTarget(user.id, v.invoice_date ?? null, "facturen", "pipeline")

  const { data: doc } = await pipeline
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
      source: "camera",
      ai_processed: true,
      ai_doc_type: decision.destination === "receipt" ? "receipt" : "invoice",
      content_hash: contentHash,
    })
    .select("id")
    .single()
  const documentId = doc?.id ?? null

  // [SMART-INTAKE] Merge an intake suggestion into field_confidence (same jsonb
  // pattern as _safecore). _intake_suggest='paid' tells the verify queue to
  // surface "Markeer als betaald" prominently. It is a SUGGESTION — the human
  // still confirms. We never write status='paid' here.
  const fieldConfidence: Record<string, unknown> = { ...(v.field_confidence ?? {}) }
  if (decision.destination === "receipt") {
    fieldConfidence._intake_kind = "receipt"
    if (decision.suggestPaid) fieldConfidence._intake_suggest = "paid"
  }

  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: user.id,
      direction: "incoming",
      status: "processing", // verify queue — never auto-paid, even for receipts
      source: "camera",
      client_name: v.vendor || "Onbekende afzender",
      invoice_date: invoiceDate,
      invoice_number: v.invoice_number || `CAMERA-${Date.now()}`,
      total_ex_btw: v.total_ex_btw ?? 0,
      btw_amount: v.btw_amount ?? 0,
      total_inc_btw: v.total_inc_btw ?? v.amount ?? 0,
      pdf_url: pdfUrl,
      document_id: documentId,
      vendor_iban: v.vendor_iban ?? null,
      payment_reference: v.payment_reference ?? null,
      // Cast to the jsonb column type (Json | null) — sanitized, JSON-compatible
      // content. Same pattern as email-integration.ts / audit.ts.
      field_confidence: fieldConfidence as InvoiceFieldConfidence,
    })
    .select("id")
    .single()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  if (documentId && invoice?.id) {
    await pipeline.from("documents").update({ invoice_id: invoice.id }).eq("id", documentId)
  }

  return NextResponse.json({
    ok: true,
    destination: decision.destination, // 'invoice' | 'receipt'
    invoice_id: invoice?.id,
    suggest_paid: decision.suggestPaid,
    message:
      decision.destination === "receipt"
        ? "Bon herkend — controleer en bevestig (waarschijnlijk al betaald)."
        : "Factuur herkend — controleer en bevestig.",
  })
}

// ── Bank statement handler — mirrors /api/bank/upload (text/xml only) ─────────
async function handleBankStatement(buffer: Buffer, filename: string, userId: string) {
  const content = buffer.toString("utf8")
  const parsed = parseBankFile(content, filename)
  if (parsed.transactions.length === 0) {
    return NextResponse.json(
      { error: "Geen transacties gevonden in het bankafschrift", parseWarnings: parsed.parseErrors },
      { status: 422 }
    )
  }

  const pipeline = createPipelineClient()
  const { min, max } = dateRange(parsed.transactions)

  let existing: {
    date: string | null
    amount: number | null
    description: string | null
    counterpart_name: string | null
    reference: string | null
  }[] = []

  if (min && max) {
    const { data, error } = await pipeline
      .from("bank_transactions")
      .select("date, amount, description, counterpart_name, reference")
      .eq("user_id", userId)
      .gte("date", min)
      .lte("date", max)
    if (error) {
      return NextResponse.json({ error: "lookup_failed", detail: error.message }, { status: 500 })
    }
    existing = data ?? []
  }

  const { toInsert, skipped } = dedupTransactions(parsed.transactions, existing)
  let inserted = 0
  if (toInsert.length > 0) {
    const rows = mapToRows(toInsert, userId)
    const { error } = await pipeline.from("bank_transactions").insert(rows)
    if (error) {
      return NextResponse.json({ error: "insert_failed", detail: error.message }, { status: 500 })
    }
    inserted = rows.length
  }

  return NextResponse.json({
    ok: true,
    destination: "bank",
    format: parsed.format,
    parsed: parsed.transactions.length,
    inserted,
    skipped,
    message: `Bankafschrift verwerkt — ${inserted} transactie(s) toegevoegd.`,
  })
}