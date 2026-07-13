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
// [INTAKE-IMG-PDF] Convert an uploaded image (jpg/png) to a one-page PDF at
// ingest, so every invoice lives as a PDF from day one (opens uniformly, can be
// stamped by the closing package with no download-time conversion).
import { maybeImageToPdf } from "@/lib/image-to-pdf"
// [SAFECORE Rule 2] semantic duplicate detection — same graded logic as the
// email path, so the camera/file path also blocks "same invoice, different file".
import { findSemanticDuplicate } from "@/lib/safecore"
// [EXTRACT-DUE-DATE] shared due-date derivation (explicit → invoice_date+term →
// null). Same single source of truth as the email path; never duplicated.
import { deriveDueDate } from "@/lib/safecore"
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
    return NextResponse.json({
      error: where,
      duplicate: true,
      // [INTAKE-FEEDBACK] structured target so the client can deep-link + focus
      existing: {
        id: existingDoc.id,
        folder_id: existingDoc.folder_id ?? null,
        folder_name: folderPath.length ? folderPath[folderPath.length - 1] : null,
      },
    }, { status: 409 })
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

  // ── [SAFECORE Rule 2] Semantic duplicate gate (invoice/receipt only) ────────
  // Byte-hash (above) only catches the SAME file. This catches the SAME INVOICE
  // arriving as a DIFFERENT file (re-photographed, regenerated PDF, re-upload) —
  // the real double-pay risk. Same graded key as the email path: real number →
  // number+total(+date); placeholder number + reliable vendor → vendor+total+date;
  // otherwise un-dedupable (allowed for human review, never silently blocked).
  // Runs BEFORE storage/insert so a duplicate costs nothing.
  if (decision.destination === "invoice" || decision.destination === "receipt") {
    const dup = await findSemanticDuplicate(
      {
        invoiceNumber: v.invoice_number,
        vendor: v.vendor,
        totalIncBtw: v.total_inc_btw ?? v.amount,
        invoiceDate: v.invoice_date,
      },
      async (q) => {
        let query = supabase
          .from("invoices")
          .select("id, invoice_number, client_name")
          .eq("receiver_id", user.id)
          .eq("direction", "incoming")
          .eq("total_inc_btw", q.total)
        if (q.tier === "number" && q.invoiceNumber) {
          query = query.eq("invoice_number", q.invoiceNumber)
        } else if (q.tier === "vendor" && q.vendor) {
          query = query.ilike("client_name", q.vendor)
        }
        if (q.dateIso) query = query.eq("invoice_date", q.dateIso)
        const { data } = await query.limit(1)
        return data && data.length > 0
          ? { id: data[0].id, invoice_number: data[0].invoice_number, client_name: data[0].client_name }
          : null
      }
    )

    if (dup.duplicate && dup.match) {
      // Block the duplicate before any storage/insert. Truth in the audit log,
      // a clear message to the owner. The original is untouched.
      await logAuditAction({
        userId: user.id,
        action: "invoice.duplicated",
        entityType: "invoice",
        entityId: dup.match.id,
        newValue: {
          reason: "semantic_duplicate_blocked",
          matched_on: dup.tier,
          invoice_number: v.invoice_number ?? null,
          total_inc_btw: v.total_inc_btw ?? v.amount ?? null,
          rejected_vendor: v.vendor ?? null,
          path: "intake",
        },
        ipAddress: getClientIP(req),
      })
      const nr = dup.match.invoice_number ? `factuur ${dup.match.invoice_number}` : "deze factuur"

      // [INTAKE-FOCUS] Resolve the ORIGINAL invoice's file so the client can
      // deep-link + highlight it in Mijn bestanden — the owner's natural
      // question on "bestaat al" is "waar dan?". Same `existing` shape as the
      // byte-hash duplicate above, so BOTH upload surfaces (results modal and
      // IntakeButton) render their "Bekijk in bestanden →" link with zero
      // client changes. Two-step lookup covers both linkage directions
      // (documents.invoice_id → fallback invoices.document_id). Best-effort:
      // a lookup hiccup must never turn a clean 409 into a 500 — on any
      // failure we simply omit `existing` (today's behaviour, no link).
      let existing:
        | { id: string; folder_id: string | null; folder_name: string | null }
        | undefined
      try {
        let doc: { id: string; folder_id: string | null } | null = null
        const { data: byInvoice } = await supabase
          .from("documents")
          .select("id, folder_id")
          .eq("user_id", user.id)
          .eq("invoice_id", dup.match.id)
          .limit(1)
          .maybeSingle()
        doc = byInvoice ?? null
        if (!doc) {
          const { data: inv } = await supabase
            .from("invoices")
            .select("document_id")
            .eq("id", dup.match.id)
            .eq("receiver_id", user.id)
            .maybeSingle()
          if (inv?.document_id) {
            const { data: byId } = await supabase
              .from("documents")
              .select("id, folder_id")
              .eq("user_id", user.id)
              .eq("id", inv.document_id)
              .maybeSingle()
            doc = byId ?? null
          }
        }
        if (doc) {
          const path = await buildFolderBreadcrumb(supabase, user.id, doc.folder_id ?? null)
          existing = {
            id: doc.id,
            folder_id: doc.folder_id ?? null,
            folder_name: path.length ? path[path.length - 1] : null,
          }
        }
      } catch {
        // omit `existing` — the link simply doesn't render
      }

      return NextResponse.json(
        {
          error: `Deze factuur bestaat al — ${nr}${dup.match.client_name ? ` van ${dup.match.client_name}` : ""} is al toegevoegd.`,
          duplicate: true,
          original_id: dup.match.id,
          ...(existing ? { existing } : {}),
        },
        { status: 409 }
      )
    }
    // tier 'none' (un-dedupable) → allow through; the human reviews in the queue.
  }

  // ── [INTAKE-IMG-PDF] Convert image → PDF BEFORE storage ─────────────────────
  // Runs AFTER the AI (the extractor reads the raw photo above) and AFTER dedup
  // (so a duplicate costs no conversion). Wrapping only — full image fidelity,
  // no re-compression. One file per request → peak memory is a single image.
  // Best-effort: a failed conversion returns the original bytes unchanged.
  const upload = await maybeImageToPdf(buffer, file.type, file.name)

  // ── Store the file in Storage (shared by all destinations) ──────────────────
  const safeName = upload.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, upload.buffer, { contentType: upload.fileType, upsert: false })
  // [R1] A swallowed storage failure was the silent-loss bug: the flow continued and
  // wrote a documents/invoice row whose file_url points at a file that was NEVER stored,
  // while telling the owner "opgeslagen" / "factuur herkend". The evidence is then gone
  // but looks present, and the closing package can never find it. Fail loudly instead —
  // the owner retries; a cheap AI re-run beats a phantom document that breaks the aangifte.
  if (uploadError) {
    return NextResponse.json(
      { error: "Bestand kon niet worden opgeslagen — probeer het opnieuw." },
      { status: 502 }
    )
  }
  const pdfUrl = storagePath

  const pipeline = createPipelineClient()

  // ── Destination: document (not an invoice/receipt) → bestanden only ─────────
  if (decision.destination === "document") {
    const folderId = await ensureImportedFolder(user.id, "pipeline")
    const { data: doc, error: docErr } = await pipeline
      .from("documents")
      .insert({
        user_id: user.id,
        file_name: upload.fileName,
        file_url: storagePath,
        file_size: upload.buffer.length,
        file_type: upload.fileType,
        doc_type: "overig",
        folder_id: folderId,
        source: "camera",
        ai_processed: true,
        ai_doc_type: v.document_kind ?? "other",
        content_hash: contentHash,
      })
      .select("id")
      .single()
    // [R1] Don't report success on a failed write. Roll back the stored file so it isn't
    // orphaned in Storage (a leaked object with no row), and tell the owner to retry.
    if (docErr || !doc) {
      await supabase.storage.from("documents").remove([storagePath])
      return NextResponse.json(
        { error: "Opslaan in je bestanden is mislukt — probeer het opnieuw." },
        { status: 500 }
      )
    }
    // [INTAKE-FEEDBACK] resolve the folder name so the client can show "where"
    // and deep-link to it (same breadcrumb helper as the duplicate path).
    const docFolderPath = await buildFolderBreadcrumb(supabase, user.id, folderId)
    return NextResponse.json({
      ok: true,
      destination: "document",
      document_id: doc?.id ?? null,
      folder_id: folderId,
      folder_name: docFolderPath.length ? docFolderPath[docFolderPath.length - 1] : null,
      message: "Opgeslagen in je bestanden (geen factuur of bon herkend).",
    })
  }

  // ── Destination: invoice or receipt → documents + invoices (verify queue) ───
  // [DATE-GATE] Honest date: null when the AI could not read one. Never
  // substitute today — a fabricated date would look confident and land the
  // expense in the wrong quarter. The verify queue forces the human to enter it
  // before confirming (the confirm route blocks a null date).
  const invoiceDate = v.invoice_date
    ? new Date(v.invoice_date).toISOString().split("T")[0]
    : null

  const folderId = await resolveImportTarget(user.id, v.invoice_date ?? null, "facturen", "pipeline")

  const { data: doc, error: docErr } = await pipeline
    .from("documents")
    .insert({
      user_id: user.id,
      file_name: upload.fileName,
      file_url: storagePath,
      file_size: upload.buffer.length,
      file_type: upload.fileType,
      doc_type: "factuur",
      folder_id: folderId,
      year: invoiceDate ? new Date(invoiceDate).getFullYear() : null,
      source: "camera",
      ai_processed: true,
      ai_doc_type: decision.destination === "receipt" ? "receipt" : "invoice",
      content_hash: contentHash,
    })
    .select("id")
    .single()
  // [R1] The document row IS the evidence link for an incoming invoice (the closing
  // package resolves the PDF via invoices.document_id → documents.file_url). If it fails
  // to write, an invoice with document_id=null has unreachable evidence. Stop and roll
  // back the stored file rather than create a half-linked, evidence-less invoice.
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath])
    return NextResponse.json(
      { error: "Opslaan van de factuur is mislukt — probeer het opnieuw." },
      { status: 500 }
    )
  }
  const documentId = doc.id

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
      // [EXTRACT-DUE-DATE] explicit due date → invoice_date + term → null. The
      // backbone of the "Vandaag" screen; null is honest when nothing is stated.
      due_date: deriveDueDate(invoiceDate, v.due_date ?? null, v.payment_term_days ?? null),
      invoice_number: v.invoice_number || `CAMERA-${Date.now()}`,
      // [BRIDGE-CREDITNOTA-SIGN] mark the type; amounts stay NEGATIVE as
      // extracted for a creditnota (one sign convention with [BOEK-031]).
      // The read-time health classifier (import-health) applies the
      // sign-inverted gate for this row via invoice_type.
      invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
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
    // [R1] Roll back the document row + stored file we just created. Otherwise a
    // documents row with no invoice is orphaned — and worse, its content_hash would
    // make the byte-hash dedup BLOCK a re-upload (409), trapping the owner with a file
    // they can neither re-add nor see as an invoice. Best-effort; then surface the error.
    await pipeline.from("documents").delete().eq("id", documentId)
    await supabase.storage.from("documents").remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  if (invoice?.id) {
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