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
import { importBankStatement } from "@/lib/bank-ingest"
import { logAuditAction, getClientIP } from "@/lib/audit"
import { decidePreAi, decideFromAi } from "@/lib/intake-router"
// [SHEET-INTAKE] Route an uploaded kassa Z-report / grootboek export into the EXISTING
// turnover + ledger pipelines instead of filing it as an opaque document.
import { sheetBytesToMatrix } from "@/lib/xlsx-adapter"
import { looksLikeSpreadsheetBinary } from "@/lib/detect-file"
import { planSpreadsheetIngest, ledgerKindLabel } from "@/lib/spreadsheet-ingest"
import { looksLikeDailySalesReport, parseDailySalesReport } from "@/lib/daily-sales-report"
import type { DailyTurnover } from "@/lib/turnover"
import { escapeLikeValue } from "@/lib/sanitize"
import { shouldAutoAdvanceInvoice } from "@/lib/auto-advance"
import { reconcileCashSettlements } from "@/lib/cash-settle"
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm"
// [INTAKE-IMG-PDF] Convert an uploaded image (jpg/png) to a one-page PDF at
// ingest, so every invoice lives as a PDF from day one (opens uniformly, can be
// stamped by the closing package with no download-time conversion).
import { maybeImageToPdf } from "@/lib/image-to-pdf"
// [SAFECORE Rule 2] semantic duplicate detection — same graded logic as the
// email path, so the camera/file path also blocks "same invoice, different file".
import { findSemanticDuplicate, normalizeInvoiceNumber, normalizeToIso } from "@/lib/safecore"
// [EXTRACT-DUE-DATE] shared due-date derivation (explicit → invoice_date+term →
// null). Same single source of truth as the email path; never duplicated.
import { deriveDueDate } from "@/lib/safecore"
// [SMART-INTAKE] jsonb column type for invoices.field_confidence — same pattern
// as email-integration.ts / audit.ts: derive the Json type, cast at write.
import type { Database } from "@/types/database.types"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
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

  // [COST] Per-user ceiling on the AI/OCR intake pipeline (Claude calls) — one account
  // cannot drive unbounded spend.
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/intake", ...RATE_LIMITS.AI_OCR })
  if (!rl.allowed) return rateLimitResponse(rl)

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

  // [INTAKE-FORCE] The owner can override a SEMANTIC duplicate block ("toch toevoegen")
  // when the match is a false positive — e.g. two genuinely distinct same-day receipts
  // from one vendor for the same amount, neither carrying an invoice number. This NEVER
  // overrides the byte-hash gate below: the exact same file still can't be added twice.
  const force = formData.get("force") === "true"

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // ── Stage 1: bank statement by file shape (pre-AI) ──────────────────────────
  // Read a small text head only when the file could be text/xml (cheap).
  const couldBeText =
    file.type === "" ||
    file.type === "text/plain" ||
    file.type === "text/xml" ||
    file.type === "application/xml" ||
    file.type === "text/csv" ||
    // [BANK-CSV] Read a text head for .csv too, so decidePreAi's bank-CSV sniff can run — a
    // Rabo/ING/bunq CSV export is a bank statement, not a spreadsheet to file away.
    /\.(xml|mt940|940|sta|camt|053|txt|csv)$/i.test(file.name)
  const textHead = couldBeText ? buffer.slice(0, 4096).toString("utf8") : undefined

  const preAi = decidePreAi(file.name, file.type, textHead)
  if (preAi?.destination === "bank") {
    return handleBankStatement(buffer, file.name, user.id, file.type || "text/plain")
  }

  // ── Stage 1b: a spreadsheet the shop exports monthly — a kassa Z-report (→ dagomzet) or a
  //    PIN/kas grootboek export (→ ledger witness). These are the backbone of a shop's numbers,
  //    and were silently dead-ending as opaque "documents" because the extractor only reads
  //    pdf/image. Detect by magic bytes (.xls/.xlsx) or extension (.csv, already NOT a bank CSV
  //    since decidePreAi ran first), parse ONCE, and hand off to the real pipelines. A file that
  //    is neither turnover nor ledger returns null → falls through to the safe document store. ──
  if (looksLikeSpreadsheetBinary(buffer) || /\.(xls|xlsx|csv)$/i.test(file.name)) {
    const sheetResp = await handleSpreadsheet(buffer, file, user.id, supabase, req)
    if (sheetResp) return sheetResp
    // null → not a recognised turnover/ledger sheet; continue to the document path below.
  }

  // ── Type guard for the AI path: only pdf/image go to the extractor ──────────
  const okForAi =
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    file.name.toLowerCase().endsWith(".pdf")

  // [INTAKE-KEEP-ALL] Never hard-reject a plausible document. A file the extractor can't read —
  // an XML/UBL e-invoice, a Word/Excel document, a .csv that isn't a bank export — must NOT be
  // lost: store it in bestanden so the accountant still receives it and the owner can act on it.
  // Only the automatic EXTRACTION is skipped; the file itself is kept and visible. This upholds
  // "no missing invoice" for every format.
  if (!okForAi) {
    const hash = computeContentHash(buffer)
    const { data: dupDoc } = await supabase
      .from("documents").select("id, folder_id")
      .eq("user_id", user.id).eq("content_hash", hash).limit(1).maybeSingle()
    if (dupDoc && !force) {
      const bc = await buildFolderBreadcrumb(supabase, user.id, dupDoc.folder_id)
      return NextResponse.json({
        duplicate: true, destination: "document",
        error: "Dit bestand staat al in je bestanden.",
        existing: { id: dupDoc.id, folder_id: dupDoc.folder_id ?? null },
        folder_name: bc.length ? bc[bc.length - 1] : null,
      }, { status: 409 })
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`
    const contentType = file.type || "application/octet-stream"
    const { error: upErr } = await supabase.storage
      .from("documents").upload(storagePath, buffer, { contentType, upsert: false })
    if (upErr) {
      return NextResponse.json({ error: "Bestand kon niet worden opgeslagen — probeer het opnieuw." }, { status: 502 })
    }
    const folderId = await ensureImportedFolder(user.id, "pipeline")
    const pipelineDoc = createPipelineClient()
    const { data: doc, error: docErr } = await pipelineDoc
      .from("documents").insert({
        user_id: user.id, file_name: file.name, file_url: storagePath,
        file_size: buffer.length, file_type: contentType,
        doc_type: "overig", folder_id: folderId, source: "camera",
        ai_processed: false, ai_doc_type: "unsupported_type", content_hash: hash,
      })
      .select("id").single()
    if (docErr || !doc) {
      await supabase.storage.from("documents").remove([storagePath])
      return NextResponse.json({ error: "Opslaan in je bestanden is mislukt — probeer het opnieuw." }, { status: 500 })
    }
    const bc = await buildFolderBreadcrumb(supabase, user.id, folderId)
    return NextResponse.json({
      ok: true, destination: "document", document_id: doc.id, folder_id: folderId,
      folder_name: bc.length ? bc[bc.length - 1] : null,
      message: "We konden dit bestandstype niet automatisch uitlezen, maar het staat veilig in je bestanden — je accountant krijgt het en je kunt het zelf controleren.",
    })
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

  // ── Stage 1c: a daily-sales report PDF ("OMZET VAN DD/MM/YYYY") is one day of turnover, not an
  //    invoice. Detect it by its text layer BEFORE the invoice extractor and book it into
  //    daily_turnover (idempotent with the monthly Excel path). A PDF that is NOT this report
  //    returns null and continues to the normal AI extractor below. ──
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const dailyResp = await handleDailySalesPdf(buffer, file, user.id, supabase, req)
    if (dailyResp) return dailyResp
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
    // [PEN-MARK] carry the handwritten/stamped payment hints into the routing decision.
    paid_method: v.paid_method ?? null,
    paid_date: v.paid_date ?? null,
    confidence: v.confidence,
  })

  // [KAS-UPLOAD] The Kas screen can upload a receipt the owner ALREADY paid in cash. The button
  // passes paid_method=kas (optionally paid_date) so — when the file is recognised as an invoice
  // or receipt — it lands in the verify queue PRE-MARKED "contant betaald", reusing the exact
  // pen-mark paid flow. Still only a SUGGESTION: the human confirms, and that confirm books the
  // invoice→kasboek cash settlement — NOT a separate cash 'kosten' entry (which would drop the
  // voorbelasting and double-count). A file the AI does not recognise as an invoice is untouched
  // (stays in documents) — we never force-mark an unrecognised file as paid.
  const forcedMethodRaw = formData.get("paid_method");
  const forcedMethod =
    forcedMethodRaw === "kas" || forcedMethodRaw === "bank" || forcedMethodRaw === "pin" ? forcedMethodRaw : null;
  if (forcedMethod && (decision.destination === "invoice" || decision.destination === "receipt")) {
    decision.suggestPaid = true;
    decision.paidMethod = forcedMethod;
    const forcedDateRaw = formData.get("paid_date");
    if (typeof forcedDateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(forcedDateRaw)) {
      decision.paidDate = forcedDateRaw;
    }
    // else: keep any AI-read date (or null) — the verify modal lets the human pick before confirming.
  }

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
        if (q.tier === "vendor" && q.vendor) {
          // [L2] Escape LIKE wildcards — an AI/OCR-parsed vendor containing `%`/`_`
          // would otherwise act as a wildcard and broaden this dedup match.
          query = query.ilike("client_name", escapeLikeValue(q.vendor))
        }
        if (q.dateIso) query = query.eq("invoice_date", q.dateIso)
        // [DEDUP-NUMBER-NORM] The candidate set is already pinned by total (+date); for the
        // number tier compare the number WHITESPACE-NORMALIZED in JS, so "26 / 3958" is
        // caught as a duplicate of "26/3958" (an exact .eq missed it → double booking).
        // [DEDUP-WINDOW] Deterministic order + a wide cap so the number match never falls
        // outside the window (dropping the .eq removed the natural bound); 200 far exceeds
        // any realistic count of same-total invoices sharing one date.
        const { data } = await query.order("id", { ascending: false }).limit(200)
        const rows = data ?? []
        const hit =
          q.tier === "number" && q.invoiceNumber
            ? rows.find((r) => normalizeInvoiceNumber(r.invoice_number) === normalizeInvoiceNumber(q.invoiceNumber))
            : rows[0]
        return hit ? { id: hit.id, invoice_number: hit.invoice_number, client_name: hit.client_name } : null
      }
    )

    if (dup.duplicate && dup.match && force) {
      // [INTAKE-FORCE] The owner already saw "bestaat al" and chose to add anyway. Record
      // the override so a deliberate double-add is fully traceable, then fall through to
      // storage/insert like a normal invoice.
      await logAuditAction({
        userId: user.id,
        action: "invoice.dedup_override",
        entityType: "invoice",
        entityId: dup.match.id,
        newValue: {
          reason: "user_forced_add",
          matched_on: dup.tier,
          invoice_number: v.invoice_number ?? null,
          total_inc_btw: v.total_inc_btw ?? v.amount ?? null,
          vendor: v.vendor ?? null,
          path: "intake",
        },
        ipAddress: getClientIP(req),
      })
    } else if (dup.duplicate && dup.match) {
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
          // [INTAKE-FORCE] This is a SEMANTIC match (same invoice, different file) — it can
          // be a false positive, so the client may offer "toch toevoegen" (re-POST force=true).
          // The byte-hash 409 above (exact same file) deliberately omits this flag.
          canForce: true,
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
    // [TRUST-INTAKE] Distinguish "confidently NOT a financial doc" from "we couldn't
    // READ it" (an AI outage / unreadable scan returns confidence 0 from the fallback).
    // The old code told the owner "geen factuur of bon herkend" for BOTH — so a real
    // receipt photographed during an outage was silently filed as "overig" and booked
    // nothing behind a confident dismissal. When we couldn't actually read it, we store
    // the file (never lose it) but say so honestly and tell the owner to check/retry —
    // we never assert it isn't an invoice when we simply didn't manage to read it.
    const couldNotRead = !(v.confidence > 0)
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
        // Only claim we processed it when we actually read it.
        ai_processed: !couldNotRead,
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
      could_not_read: couldNotRead,
      document_id: doc?.id ?? null,
      folder_id: folderId,
      folder_name: docFolderPath.length ? docFolderPath[docFolderPath.length - 1] : null,
      message: couldNotRead
        ? "We konden dit document niet lezen. Het staat veilig in je bestanden — controleer het, of upload een duidelijkere foto als het een factuur of bon is."
        : "Opgeslagen in je bestanden (geen factuur of bon herkend).",
    })
  }

  // ── Destination: invoice or receipt → documents + invoices (verify queue) ───
  // [DATE-GATE] Honest date: null when the AI could not read one. Never
  // substitute today — a fabricated date would look confident and land the
  // expense in the wrong quarter. The verify queue forces the human to enter it
  // before confirming (the confirm route blocks a null date).
  // [DATE-ISO-SAFE / I6] Tolerant + never-throw (a DD-MM-YYYY used to 500 intake).
  const invoiceDate = normalizeToIso(v.invoice_date)

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
    // [DEDUP-ATOMIC] A concurrent double-submit that raced past the byte-hash SELECT above trips the
    // (user_id, content_hash) UNIQUE index here (23505). Treat it like the SELECT-found duplicate —
    // the other request already stored the document + created its invoice, so returning a duplicate
    // (not a 500) stops a second invoice from being created and double-counting the cost.
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, folder_id").eq("user_id", user.id).eq("content_hash", contentHash).limit(1).maybeSingle()
      const folderPath = dup ? await buildFolderBreadcrumb(supabase, user.id, dup.folder_id ?? null) : []
      const where = folderPath.length ? `Dit bestand staat al in: ${folderPath.join(" / ")}` : "Dit bestand is al toegevoegd"
      return NextResponse.json({
        error: where, duplicate: true,
        existing: dup ? { id: dup.id, folder_id: dup.folder_id ?? null, folder_name: folderPath.length ? folderPath[folderPath.length - 1] : null } : undefined,
      }, { status: 409 })
    }
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
  // [PEN-MARK] A paid suggestion — from a receipt OR an invoice the owner marked paid by
  // hand/stamp — carries HOW and WHEN so the verify queue can pre-fill method + date. Still a
  // SUGGESTION: the human confirms, we never write status='paid' here.
  if (decision.suggestPaid) {
    fieldConfidence._intake_suggest = "paid"
    if (decision.paidMethod) fieldConfidence._intake_paid_method = decision.paidMethod
    if (decision.paidDate) fieldConfidence._intake_paid_date = decision.paidDate
  }

  // [AUTO-ADVANCE] A confident, clean, ORDINARY invoice may skip the manual verify tap and land
  // directly as 'received' (booked, UNPAID, reversible). Never for a receipt (its "probably paid"
  // suggestion needs a human pay-confirm), never for a pen-mark paid suggestion, never for a
  // statement/reminder/creditnota/low-confidence read. The decision reads the REAL AI number
  // (v.invoice_number) — not the CAMERA- fallback — so a numberless invoice stays in the queue.
  const autoAdv =
    decision.destination === "invoice" && !decision.suggestPaid
      ? shouldAutoAdvanceInvoice({
          is_invoice: v.is_invoice,
          is_statement: v.is_statement,
          is_reminder: v.is_reminder,
          is_credit_note: v.is_credit_note,
          document_kind: v.document_kind ?? null,
          invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
          confidence: v.confidence,
          // Raw gross only (no amount-fallback), and never auto-book a forced-through duplicate.
          totalIncBtw: v.total_inc_btw ?? null,
          forcedDuplicate: force === true,
          health: {
            total_ex_btw: v.total_ex_btw ?? 0,
            btw_amount: v.btw_amount ?? 0,
            total_inc_btw: v.total_inc_btw ?? v.amount ?? 0,
            invoice_date: invoiceDate,
            invoice_number: v.invoice_number ?? null,
            invoice_type: v.is_credit_note === true ? "creditnota" : "factuur",
            field_confidence: fieldConfidence,
          },
        })
      : { advance: false, reason: "not_eligible" };
  if (autoAdv.advance) {
    fieldConfidence._auto_verified = { at: new Date().toISOString(), reason: autoAdv.reason };
  }

  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: user.id,
      direction: "incoming",
      // [AUTO-ADVANCE] clean+confident → 'received' (booked, unpaid, reversible); else the queue.
      status: autoAdv.advance ? "received" : "processing",
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

  // [AUTO-ADVANCE] Side-effects of a clean auto-verify — mirror the confirm route, best-effort:
  // audit the automatic booking (legal trail), settle any cash link + book a bank line that
  // already paid it, and tell the owner what the app did (so the double-check stays available).
  if (autoAdv.advance && invoice?.id) {
    await logAuditAction({
      userId: user.id,
      action: "invoice.auto_verified",
      entityType: "invoice",
      entityId: invoice.id,
      oldValue: { status: "processing" },
      newValue: { status: "received", reason: autoAdv.reason, source: "intake_auto_advance" },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    try { await reconcileCashSettlements(pipeline, user.id) } catch { /* non-fatal */ }
    try { await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: user.id }) } catch { /* non-fatal */ }
    try {
      await pipeline.from("notifications").insert({
        user_id: user.id,
        title: "Factuur automatisch verwerkt",
        body: `${v.vendor || "Een leverancier"} — factuur ${v.invoice_number ?? ""} is automatisch geverifieerd en klaargezet voor de boekhouder. Controleer indien nodig.`.replace("  ", " "),
        type: "invoice",
      })
    } catch { /* non-essential */ }
  }

  return NextResponse.json({
    ok: true,
    destination: decision.destination, // 'invoice' | 'receipt'
    invoice_id: invoice?.id,
    suggest_paid: decision.suggestPaid,
    auto_verified: autoAdv.advance,
    // [UPLOAD-HUB] Echo the key extracted fields so the upload page can show WHAT each file is
    // (leverancier · bedrag · nummer) at a glance — the owner verifies without opening every file.
    vendor: v.vendor ?? null,
    invoice_number: v.invoice_number ?? null,
    total_inc_btw: v.total_inc_btw ?? v.amount ?? null,
    message:
      decision.destination === "receipt"
        ? "Bon herkend — controleer en bevestig (waarschijnlijk al betaald)."
        : autoAdv.advance
          ? "Factuur herkend en automatisch verwerkt ✓ — klaar voor de boekhouder."
          : "Factuur herkend — controleer en bevestig.",
  })
}

// ── Shared helpers for the sheet/daily-report booking paths ──────────────────────────────────
// Dedup + store the raw incoming file in bestanden (best-effort); returns the documentId, or null
// if it is a fresh file whose store failed. Skips storage when this exact file (byte-hash) already
// exists, so a corrected re-upload never piles up document rows. Rolls back the storage blob if the
// documents row fails, so a failed store never leaks an orphan.
async function storeRawIncoming(
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  aiDocType: string,
): Promise<string | null> {
  const hash = computeContentHash(buffer)
  try {
    const { data: existing } = await supabase
      .from("documents").select("id").eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
    if (existing?.id) return existing.id
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage
      .from("documents").upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false })
    if (upErr) return null
    const folderId = await ensureImportedFolder(userId, "pipeline")
    const pipelineDoc = createPipelineClient()
    const { data: doc, error: docErr } = await pipelineDoc.from("documents").insert({
      user_id: userId, file_name: file.name, file_url: storagePath,
      file_size: buffer.length, file_type: file.type || "application/octet-stream",
      doc_type: "overig", folder_id: folderId, source: "camera",
      ai_processed: true, ai_doc_type: aiDocType, content_hash: hash,
    }).select("id").single()
    if (docErr || !doc) {
      await supabase.storage.from("documents").remove([storagePath]).catch(() => {})
      return null
    }
    return doc.id
  } catch {
    return null // storage is a convenience; the booking is the money-truth
  }
}

// Upsert DailyTurnover rows into daily_turnover (source distinguishes provenance). Idempotent on
// (user, turnover_date) → a re-import of the same day corrects, never doubles. Returns ok + a summary.
async function bookTurnoverRows(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  rows: DailyTurnover[],
  source: string,
  opts?: { preserveSplit?: boolean },
): Promise<{ ok: boolean; days: number; span: string; total_incl: number }> {
  const records = rows.map((r) => {
    const base = {
      user_id: userId,
      turnover_date: r.turnover_date,
      base_0: r.base_0 ?? 0, base_9: r.base_9 ?? 0, base_21: r.base_21 ?? 0,
      btw_9: r.btw_9 ?? 0, btw_21: r.btw_21 ?? 0,
      total_incl: r.total_incl ?? null,
      source,
    }
    // [DAGVERKOPEN-PDF] A daily-sales PDF carries no payment split. OMITTING pin/cash/other from the
    // payload means an ON CONFLICT upsert leaves those columns UNTOUCHED — so a later PDF never nulls
    // a richer Excel-sourced pin/cash for that day (which would wrongly widen the covered-day
    // suppression budget and could drop same-day webshop omzet). On a fresh day they default to null.
    if (opts?.preserveSplit) return base
    return { ...base, pin_amount: r.pin_amount ?? null, cash_amount: r.cash_amount ?? null, other_amount: r.other_amount ?? null }
  })
  const { error } = await supabase.from("daily_turnover").upsert(records, { onConflict: "user_id,turnover_date" })
  const dates = rows.map((r) => r.turnover_date).sort()
  const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : ""
  const total_incl = Math.round(records.reduce((s, r) => s + (r.total_incl ?? 0), 0) * 100) / 100
  return { ok: !error, days: records.length, span, total_incl }
}

// ── Daily-sales report handler — a "OMZET VAN DD/MM/YYYY" PDF is one day of turnover ─────────
// Returns a NextResponse when the PDF IS a daily-sales report (booked or stored-for-review), or
// null when it isn't (the caller then runs the normal invoice extractor). The per-day report is the
// sibling of the monthly kassa Excel; it lands in the SAME daily_turnover table via bookTurnoverRows,
// so uploading the month's Excel later simply upserts the same days (idempotent — never doubles).
async function handleDailySalesPdf(
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  req: NextRequest,
): Promise<NextResponse | null> {
  // Extract the text layer (fail-safe: any trouble → null → the invoice extractor still runs).
  let text: string
  try {
    const unpdf = await import("unpdf")
    const doc = await unpdf.getDocumentProxy(new Uint8Array(buffer))
    const { text: t } = await unpdf.extractText(doc, { mergePages: true })
    text = (t ?? "").trim()
  } catch {
    return null
  }
  if (!looksLikeDailySalesReport(text)) return null

  const { row, warnings } = parseDailySalesReport(text)
  if (!row) return null // looked like a report but unreadable → let the AI path try instead

  const documentId = await storeRawIncoming(buffer, file, userId, supabase, "dagverkopen_pdf")

  if (warnings.length > 0) {
    // A per-rate/TOTAAL mismatch → do NOT auto-book omzet into the VAT picture; store + send to review.
    return NextResponse.json({
      ok: true, destination: "document", document_id: documentId, sheet_kind: "turnover_review",
      message: `Dagomzet herkend (${row.turnover_date}) — maar de bedragen kloppen niet helemaal (${warnings.length} controle). Controleer en boek in Dagomzet.`,
    })
  }

  const booked = await bookTurnoverRows(supabase, userId, [row], "z_report_pdf", { preserveSplit: true })
  if (!booked.ok) {
    return NextResponse.json({
      ok: true, destination: "document", document_id: documentId, sheet_kind: "turnover_review",
      message: "Dagomzet gelezen, maar opslaan is mislukt — probeer het in Dagomzet opnieuw.",
    })
  }
  await logAuditAction({
    userId, action: "turnover.auto_imported", entityType: "daily_turnover", entityId: documentId ?? userId,
    newValue: { days: 1, span: row.turnover_date, total_incl: booked.total_incl, file_name: file.name, path: "intake_pdf" },
    ipAddress: getClientIP(req),
  }).catch(() => {})
  return NextResponse.json({
    ok: true, destination: "turnover", document_id: documentId,
    days: 1, span: row.turnover_date, total_incl: booked.total_incl,
    message: `Dagomzet geboekt ✓ — ${row.turnover_date} (€${booked.total_incl.toFixed(2)}). Controleer in Dagomzet.`,
  })
}

// ── Spreadsheet handler — kassa Z-report → daily_turnover, grootboek → ledger_daily ─────────
// Returns a NextResponse when the file IS a recognised turnover/ledger sheet (booked), or null
// when it is neither (the caller then stores it in bestanden like any other document). Reuses the
// SAME pure normalizers and the SAME tables as the manual /api/turnover/import + /api/ledger/import
// paths — this only changes WHERE the parse is triggered, never the numbers it produces.
//
// Money-truth: turnover feeds the VAT return, so it is auto-booked ONLY when the normalizer's own
// per-row cross-checks pass with zero warnings (commitSafe); a flagged sheet is stored and the owner
// is sent to Dagomzet to review. Ledger is a reconciliation witness (never the P&L), so it is always
// safe to store. Both upserts are keyed on (user, day[, kind]) → re-uploading a month corrects it,
// never doubles it. Everything is audited and reversible (re-import a corrected file, or clear the day).
async function handleSpreadsheet(
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  req: NextRequest,
): Promise<NextResponse | null> {
  let matrix
  try {
    matrix = sheetBytesToMatrix(new Uint8Array(buffer))
  } catch {
    return null // not readable as a spreadsheet → let the caller store the raw file
  }
  const plan = planSpreadsheetIngest(matrix)
  if (plan.kind === "unknown") return null

  // Store the raw file (best-effort) so the accountant has the source and the owner can open it.
  const documentId = await storeRawIncoming(
    buffer, file, userId, supabase, plan.kind === "turnover" ? "kassa_zrapport" : "grootboek_export",
  )

  // ── TURNOVER: authoritative omzet + BTW → daily_turnover ──────────────────────────────────
  if (plan.kind === "turnover" && plan.turnover) {
    const { rows, warnings, commitSafe } = plan.turnover
    const dates = rows.map((r) => r.turnover_date).sort()
    const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : ""

    if (!commitSafe) {
      // Flagged (arithmetic/payment mismatch) OR nothing parsed → do NOT auto-book omzet into the
      // VAT picture. The file is stored; the owner reviews + books in Dagomzet.
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId,
        sheet_kind: "turnover_review",
        message: rows.length === 0
          ? "Dit lijkt een kassa-bestand, maar er zijn geen dag-omzetregels gelezen — controleer het in Dagomzet."
          : `Kassa-omzet herkend (${rows.length} dagen, ${span}) — maar ${warnings.length} regel(s) hebben aandacht nodig. Controleer en boek in Dagomzet.`,
      })
    }

    const booked = await bookTurnoverRows(supabase, userId, rows, "z_report")
    if (!booked.ok) {
      // Never claim a booking that didn't happen. Store stays; tell the owner to retry via Dagomzet.
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId, sheet_kind: "turnover_review",
        message: "Kassa-omzet gelezen, maar opslaan is mislukt — probeer het in Dagomzet opnieuw.",
      })
    }
    await logAuditAction({
      userId, action: "turnover.auto_imported", entityType: "daily_turnover", entityId: documentId ?? userId,
      newValue: { days: booked.days, span: booked.span, total_incl: booked.total_incl, file_name: file.name, path: "intake_xlsx" },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    return NextResponse.json({
      ok: true, destination: "turnover", document_id: documentId,
      days: booked.days, span: booked.span, total_incl: booked.total_incl,
      message: `Kassa-omzet geboekt ✓ — ${booked.days} dagen (${booked.span}). Controleer in Dagomzet.`,
    })
  }

  // ── LEDGER: reconciliation witness (never money) → ledger_daily ───────────────────────────
  if (plan.kind === "ledger" && plan.ledger) {
    const { kind, accountNr, rows } = plan.ledger
    const records = rows.slice(0, 1000).map((r) => ({
      user_id: userId,
      ledger_date: r.ledger_date,
      kind,
      received: r.received > 0 ? r.received : 0,
      spent: r.spent > 0 ? r.spent : 0,
      account_nr: accountNr,
      source: "ledger_xlsx",
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from("ledger_daily").upsert(records, { onConflict: "user_id,ledger_date,kind" })
    if (error) {
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId, sheet_kind: "ledger_review",
        message: "Grootboek-overzicht gelezen, maar opslaan is mislukt — probeer het opnieuw.",
      })
    }
    const dates = records.map((r) => r.ledger_date).sort()
    const span = dates.length ? `${dates[0]} t/m ${dates[dates.length - 1]}` : ""
    await logAuditAction({
      userId, action: "ledger.auto_imported", entityType: "ledger_daily", entityId: documentId ?? userId,
      newValue: { kind, account_nr: accountNr, days: records.length, span, file_name: file.name, path: "intake" },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    return NextResponse.json({
      ok: true, destination: "ledger", document_id: documentId, ledger_kind: kind,
      days: records.length, span,
      message: `${ledgerKindLabel(kind)} ingelezen ✓ — ${records.length} dagen (${span}) als controle-check. Verschijnt in de reconciliatie, niet dubbel in je omzet.`,
    })
  }

  return null
}

// ── Bank statement handler — mirrors /api/bank/upload (text/xml only) ─────────
async function handleBankStatement(buffer: Buffer, filename: string, userId: string, fileType: string) {
  const pipeline = createPipelineClient()
  const result = await importBankStatement({ buffer, filename, fileType, userId, pipeline })

  // A bank-shaped file the parser couldn't read yields 0 transactions — but the raw file
  // is still stored for the accountant (importBankStatement), so this is NOT an error:
  // report it honestly rather than 422-ing (which would trap the file behind byte-hash
  // dedup on retry). Aligns the intake path with /api/bank/upload's lenient behavior.
  const unreadable = result.parseWarnings.length
  const msg =
    result.parsed === 0
      ? "Bankafschrift opgeslagen, maar er zijn geen transacties gelezen — controleer het bestand."
      : unreadable > 0
        ? `Bankafschrift verwerkt — ${result.inserted} transactie(s) toegevoegd. Let op: ${unreadable} regel(s) konden niet gelezen worden en staan niet in je overzicht — controleer het originele bestand.`
        : `Bankafschrift verwerkt — ${result.inserted} transactie(s) toegevoegd.`
  return NextResponse.json({
    ok: true,
    destination: "bank",
    format: result.format,
    parsed: result.parsed,
    inserted: result.inserted,
    skipped: result.skipped,
    statementStored: result.statementStored,
    parseWarnings: result.parseWarnings,
    message: msg,
  })
}