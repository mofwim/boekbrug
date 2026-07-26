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
import { looksLikeSpreadsheetBinary, sniffReadableMime } from "@/lib/detect-file"
import { planSpreadsheetIngest, ledgerKindLabel } from "@/lib/spreadsheet-ingest"
import { looksLikeDailySalesReport, parseDailySalesReport } from "@/lib/daily-sales-report"
import { bookTurnoverRows, bookLedgerRows } from "@/lib/turnover-book"
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
import { findSemanticDuplicate, normalizeInvoiceNumber, normalizeToIso, type PossibleDuplicate } from "@/lib/safecore"
import { collectPossibleDuplicate, mergePossibleDuplicate } from "@/lib/possible-duplicate-collect"
// [EXTRACT-DUE-DATE] shared due-date derivation (explicit → invoice_date+term →
// null). Same single source of truth as the email path; never duplicated.
import { deriveDueDate } from "@/lib/safecore"
// [SMART-INTAKE] jsonb column type for invoices.field_confidence — same pattern
// as email-integration.ts / audit.ts: derive the Json type, cast at write.
import type { Database } from "@/types/database.types"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { gateFairUse } from "@/lib/fair-use-gate";
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

  // [COST] The per-user AI/OCR ceiling is enforced LATER — right before the Claude call — NOT here.
  // A bank statement, a kassa/grootboek spreadsheet, and a daily-sales PDF are all parsed LOCALLY
  // (no Claude call, no spend), so they must never consume the AI budget: counting them here made a
  // shop uploading a month of till/bank files burn its whole allowance and then hit "te veel
  // verzoeken" on the real receipts. The gate now sits at the single verifyInvoiceFromPdf call.

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

  // ── [UBL-INTAKE] XML e-invoice (UBL / Peppol) → the invoice pipeline, not the opaque document
  //    bin. A B2B/overheid supplier's factuur.xml was being filed as 'unsupported_type' with NO
  //    invoice row, so its voorbelasting silently never reached the aangifte (a missing invoice).
  //    We parse the standard UBL leaf elements and create a verify-queue invoice (status
  //    'processing') so the human confirms it into Crediteuren exactly like a PDF invoice. A CAMT
  //    bank statement is excluded (looksLikeUblInvoice returns false) and still falls to the bank
  //    handler / document store below. ──
  if (/\.xml$/i.test(file.name) || file.type === "text/xml" || file.type === "application/xml") {
    const xmlText = buffer.toString("utf8")
    const { looksLikeUblInvoice } = await import("@/lib/ubl-invoice")
    if (looksLikeUblInvoice(xmlText)) {
      const ublResp = await handleUblInvoice(xmlText, buffer, file, user.id, supabase, force, req)
      if (ublResp) return ublResp
      // null → couldn't extract anything usable; fall through to the safe document store.
    }
  }

  // [MIME-SNIFF] A phone/webview upload can arrive with an EMPTY or generic MIME (file.type === ""
  // or "application/octet-stream") even for a perfectly readable JPEG/PNG/PDF — Android share-sheets
  // and some mobile WebViews do this. The extractor picks its branch by MIME, so without this an
  // IMG_1234.jpg with no type dead-ends in the opaque document bin and its voorbelasting is never
  // read (and the owner is told, dishonestly, that we "couldn't read this file type"). Sniff the
  // leading magic bytes and use that as the effective type for BOTH the okForAi guard and the reader.
  const effectiveType = sniffReadableMime(buffer) ?? file.type

  // ── Type guard for the AI path: only pdf/image go to the extractor ──────────
  const okForAi =
    effectiveType === "application/pdf" ||
    effectiveType.startsWith("image/") ||
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
    // The byte-hash gate is NEVER forceable (route contract): identical bytes are
    // the same file, and an unreadable file carries no invoice to "add again", so
    // `force` has nothing to override here. Short-circuiting regardless of force
    // returns the honest duplicate message instead of letting the re-insert trip
    // the (user_id, content_hash) unique index and surface a generic 500.
    if (dupDoc) {
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
  if (effectiveType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const dailyResp = await handleDailySalesPdf(buffer, file, user.id, supabase, req)
    if (dailyResp) return dailyResp
  }

  // ── Stage 2: AI verify + classify ───────────────────────────────────────────
  // [COST] The AI/OCR ceiling applies ONLY here — the single Claude call. Bank/spreadsheet/daily-PDF
  // files returned above without ever reaching this point, so they never counted against the budget.
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/intake", ...RATE_LIMITS.AI_OCR })
  if (!rl.allowed) return rateLimitResponse(rl)

  // [FAIR-USE] Het tweede hek: de gepubliceerde maandgrens. Het hek hierboven gaat over
  // snelheid, dit over hoeveel er gratis in een maand past. Faalt open, en een weigering
  // pauzeert alleen dit ene automatische uitlezen — het bestand zelf wordt gewoon bewaard.
  const gate = await gateFairUse({ client: supabase, userId: user.id, metric: "aiDocuments" });
  if (!gate.allowed) return gate.response!;

  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name, kvk_number, btw_number, iban")
    .eq("id", user.id)
    .maybeSingle()
  const receiverName = me?.company_name || me?.full_name || null

  const base64 = buffer.toString("base64")
  // [AI-CONFIG-SAFE] Opt into throwOnTransient so a CONFIG/AUTH/transient reader failure (missing or
  // rotated ANTHROPIC_API_KEY, 401/403/5xx, network) is NOT swallowed into the confidence-0 FALLBACK.
  // Without this, such a failure returns is_invoice:false and a REAL invoice the owner just uploaded
  // gets filed as a plain 'document' — its cost + voorbelasting silently lost. A genuine "not an
  // invoice" is still a normal parsed return (never an exception), so only true infra failures throw.
  // Nothing is stored for the image/PDF path until AFTER this call, so returning here files nothing.
  let v: Awaited<ReturnType<typeof verifyInvoiceFromPdf>>
  try {
    // [RECEIVER-IDENTITY] Pass our own KVK/BTW/IBAN (as email-sync/upload/reimport do) so the
    // extractor drops any vendor_kvk/btw/iban equal to the owner's own — otherwise a camera/file
    // upload could store the OWNER'S OWN IBAN as vendor_iban on a self-referencing document, which
    // later feeds the IBAN+amount bank auto-match tier.
    v = await verifyInvoiceFromPdf(base64, effectiveType, file.name, receiverName, {
      throwOnTransient: true,
      receiverKvk: me?.kvk_number || null,
      receiverBtw: me?.btw_number || null,
      receiverIban: me?.iban || null,
    })
  } catch (aiErr) {
    console.error("[AI-CONFIG-SAFE] intake AI read failed — filing nothing, asking for retry", aiErr)
    // [FAIR-USE] Mislukt = niet gelezen = niet geteld. /eerlijk-gebruik §3 belooft dat
    // letterlijk, en het is ook gewoon eerlijk: een storing van ons mag de gebruiker geen
    // document van zijn maandtegoed kosten.
    await gate.release()
    return NextResponse.json(
      { error: "We konden dit bestand nu niet lezen. Probeer het zo meteen opnieuw." },
      { status: 503 },
    )
  }

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
  // [DEDUP-SOFT] Carries a POSSIBLE (not confident) duplicate across to the insert, where it is
  // merged into field_confidence so the verify queue shows "mogelijk dubbel met X" and the invoice
  // is held out of auto-confirm. Never blocks — assigned only when NOT a hard duplicate.
  let possibleDup: PossibleDuplicate | null = null
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

    // [DEDUP-SOFT] Not a CONFIDENT duplicate (or none) — is it a POSSIBLE one? (same amount +
    // date, or same amount + vendor a few days apart). Never blocks; it imports flagged for a
    // human glance and held out of auto-confirm. Skipped when a hard duplicate was found/forced.
    if (!(dup.duplicate && dup.match)) {
      possibleDup = await collectPossibleDuplicate(
        {
          invoiceNumber: v.invoice_number,
          vendor: v.vendor,
          totalIncBtw: v.total_inc_btw ?? v.amount,
          invoiceDate: v.invoice_date,
        },
        async (total) => {
          const { data } = await supabase
            .from("invoices")
            .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
            .eq("receiver_id", user.id)
            .eq("direction", "incoming")
            // A full-cent band (±0.01), not exact float equality: two totals that ROUND to the same
            // cent can differ by just under 0.01 (e.g. incoming 43.004 vs a legacy 42.997 — both
            // "43,00"). A ±0.005 band could drop such a cent-equal row before the cent-precise
            // in-code compare (assessPossibleDuplicate) ever sees it. ±0.01 guarantees it is fetched.
            .gte("total_inc_btw", total - 0.01)
            .lte("total_inc_btw", total + 0.01)
            .order("id", { ascending: false })
            .limit(200)
          return data ?? []
        }
      )
    }
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
  // [DEDUP-SOFT] Merge the possible-duplicate signal into _safecore BEFORE the auto-advance check
  // below, so classifyImportHealth reads it → needs-review → the invoice can NEVER auto-book as a
  // second cost. The verify queue then shows "mogelijk dubbel met X".
  if (possibleDup) {
    const merged = mergePossibleDuplicate(fieldConfidence, possibleDup) as Record<string, unknown>
    fieldConfidence._safecore = merged._safecore
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
          // [BTW-GATE] a zero btw_amount only auto-books when the read is explicitly a 0% invoice.
          btwRate: v.btw_rate ?? null,
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
    // [DEDUP-SOFT] A soft, non-blocking heads-up so the intake UI can flag "mogelijk dubbel".
    ...(possibleDup
      ? { possibleDuplicate: { invoice_number: possibleDup.match.invoice_number, client_name: possibleDup.match.client_name, reason: possibleDup.reason } }
      : {}),
    message:
      decision.destination === "receipt"
        ? "Bon herkend — controleer en bevestig (waarschijnlijk al betaald)."
        : possibleDup
          ? `Factuur herkend — let op: mogelijk dubbel${possibleDup.match.invoice_number ? ` met ${possibleDup.match.invoice_number}` : ""} (${possibleDup.reason}). Controleer voor je bevestigt.`
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

// ── [UBL-INTAKE] UBL / Peppol XML e-invoice handler ─────────────────────────────────────────
// Parses the standard UBL leaf elements and creates a verify-queue invoice (status 'processing')
// so an e-invoice's BTW/voorbelasting flows into Crediteuren + the aangifte like a PDF invoice,
// instead of being filed as an opaque 'unsupported_type' document. Returns a NextResponse on
// success, or null when nothing usable could be extracted (caller then falls to the document store).
async function handleUblInvoice(
  xmlText: string,
  buffer: Buffer,
  file: File,
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  force: boolean,
  req: NextRequest,
): Promise<NextResponse | null> {
  const { parseUblInvoice } = await import("@/lib/ubl-invoice")
  const v = parseUblInvoice(xmlText)
  // Need at least a number OR a gross total to be worth booking as an invoice; else it's not a
  // recognisable e-invoice → let the safe document store keep it.
  if (!v.invoiceNumber && v.totalIncBtw == null) return null

  const hash = computeContentHash(buffer)
  // Byte-hash dedup (same file re-uploaded) — surface the existing one instead of a second row.
  // [FORCE-INVARIANT] NEVER forceable: the exact same bytes can't be added twice, matching the
  // camera path's byte-hash gate (route contract lines 92-96). "toch toevoegen" only overrides the
  // SEMANTIC gate below — the old `&& !force` here let a re-upload of the identical XML double-book.
  const { data: dupDoc } = await supabase
    .from("documents").select("id, folder_id, invoice_id")
    .eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
  if (dupDoc) {
    return NextResponse.json({
      duplicate: true, destination: dupDoc.invoice_id ? "invoice" : "document",
      error: "Deze e-factuur is al geïmporteerd.",
      existing: { id: dupDoc.id, folder_id: dupDoc.folder_id ?? null },
    }, { status: 409 })
  }

  // For a creditnota the extracted totals are positive in UBL; store them NEGATIVE to match the
  // app's one-sign convention ([BOEK-031] / camera path). Compute the SIGNED gross first so the
  // dedup gate below matches against the same signed value the invoices table stores.
  const sign = v.isCreditNote ? -1 : 1
  const totalExBtw = v.totalExBtw != null ? sign * Math.abs(v.totalExBtw) : 0
  const btwAmount = v.btwAmount != null ? sign * Math.abs(v.btwAmount) : 0
  const totalIncBtw = v.totalIncBtw != null ? sign * Math.abs(v.totalIncBtw) : null

  // ── [SAFECORE Rule 2] Semantic duplicate gate — the SAME graded logic the camera/PDF path uses,
  //    which the UBL path was missing entirely. Without it, a supplier's PDF + their Peppol XML for
  //    ONE bill (different bytes, so byte-hash misses) both booked → voorbelasting counted twice,
  //    unflagged. Runs BEFORE any storage/insert so a duplicate costs nothing. ──
  let possibleDup: PossibleDuplicate | null = null
  if (totalIncBtw != null) {
    const dup = await findSemanticDuplicate(
      { invoiceNumber: v.invoiceNumber, vendor: v.supplierName, totalIncBtw, invoiceDate: v.invoiceDate },
      async (q) => {
        let query = supabase
          .from("invoices")
          .select("id, invoice_number, client_name")
          .eq("receiver_id", userId)
          .eq("direction", "incoming")
          .eq("total_inc_btw", q.total)
        if (q.tier === "vendor" && q.vendor) query = query.ilike("client_name", escapeLikeValue(q.vendor))
        if (q.dateIso) query = query.eq("invoice_date", q.dateIso)
        const { data } = await query.order("id", { ascending: false }).limit(200)
        const rows = data ?? []
        const hit =
          q.tier === "number" && q.invoiceNumber
            ? rows.find((r) => normalizeInvoiceNumber(r.invoice_number) === normalizeInvoiceNumber(q.invoiceNumber))
            : rows[0]
        return hit ? { id: hit.id, invoice_number: hit.invoice_number, client_name: hit.client_name } : null
      },
    )

    if (dup.duplicate && dup.match && force) {
      // Owner already saw "bestaat al" and chose to add anyway — record the deliberate override.
      await logAuditAction({
        userId, action: "invoice.dedup_override", entityType: "invoice", entityId: dup.match.id,
        newValue: { reason: "user_forced_add", matched_on: dup.tier, invoice_number: v.invoiceNumber ?? null, total_inc_btw: totalIncBtw, vendor: v.supplierName ?? null, path: "intake_ubl" },
        ipAddress: getClientIP(req),
      }).catch(() => {})
    } else if (dup.duplicate && dup.match) {
      await logAuditAction({
        userId, action: "invoice.duplicated", entityType: "invoice", entityId: dup.match.id,
        newValue: { reason: "semantic_duplicate_blocked", matched_on: dup.tier, invoice_number: v.invoiceNumber ?? null, total_inc_btw: totalIncBtw, rejected_vendor: v.supplierName ?? null, path: "intake_ubl" },
        ipAddress: getClientIP(req),
      }).catch(() => {})
      const nr = dup.match.invoice_number ? `factuur ${dup.match.invoice_number}` : "deze factuur"
      return NextResponse.json({
        error: `Deze factuur bestaat al — ${nr}${dup.match.client_name ? ` van ${dup.match.client_name}` : ""} is al toegevoegd.`,
        duplicate: true, original_id: dup.match.id, canForce: true,
      }, { status: 409 })
    } else {
      // Not a confident duplicate — is it a POSSIBLE one? (soft flag, never blocks; held from auto-confirm)
      possibleDup = await collectPossibleDuplicate(
        { invoiceNumber: v.invoiceNumber, vendor: v.supplierName, totalIncBtw, invoiceDate: v.invoiceDate },
        async (total) => {
          const { data } = await supabase
            .from("invoices")
            .select("id, invoice_number, client_name, invoice_date, total_inc_btw")
            .eq("receiver_id", userId).eq("direction", "incoming")
            .gte("total_inc_btw", total - 0.01).lte("total_inc_btw", total + 0.01)
            .order("id", { ascending: false }).limit(200)
          return data ?? []
        },
      )
    }
  }

  // ── Store the XML — FATAL if it fails. The document row IS the evidence link for an e-invoice
  //    (invoices.document_id → documents.file_url, the 7-year bewaarplicht source). The old path
  //    used best-effort storeRawIncoming and booked the invoice even when the store returned null →
  //    an invoice whose voorbelasting reached the aangifte while its XML was silently lost. We now
  //    mirror the camera path: a failed store/row is fatal (roll back, surface an error), never a
  //    phantom-evidence success. Because the byte-hash gate above already 409'd an existing file,
  //    this is guaranteed a FRESH file — so we create our OWN row and only ever roll back that one
  //    (the old code could destructively delete a pre-existing row on a forced re-upload). ──
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${userId}/incoming/${Date.now()}-${safeName}`
  const contentType = file.type || "application/xml"
  const { error: upErr } = await supabase.storage
    .from("documents").upload(storagePath, buffer, { contentType, upsert: false })
  if (upErr) {
    return NextResponse.json({ error: "E-factuur kon niet worden opgeslagen — probeer het opnieuw." }, { status: 502 })
  }

  const folderId = await resolveImportTarget(userId, v.invoiceDate ?? null, "facturen", "pipeline")
  const pipeline = createPipelineClient()
  const { data: doc, error: docErr } = await pipeline
    .from("documents")
    .insert({
      user_id: userId, file_name: file.name, file_url: storagePath,
      file_size: buffer.length, file_type: contentType,
      doc_type: "factuur", folder_id: folderId,
      year: v.invoiceDate ? new Date(v.invoiceDate).getFullYear() : null,
      source: "upload", ai_processed: true, ai_doc_type: "ubl_invoice", content_hash: hash,
    })
    .select("id").single()
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath])
    // [DEDUP-ATOMIC] A concurrent double-submit racing past the byte-hash SELECT trips the
    // (user_id, content_hash) UNIQUE index (23505) — treat it as the duplicate it is, not a 500,
    // so a second invoice is never created for the same file (the race the old path allowed).
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, folder_id").eq("user_id", userId).eq("content_hash", hash).limit(1).maybeSingle()
      return NextResponse.json({
        duplicate: true, error: "Deze e-factuur is al geïmporteerd.",
        existing: dup ? { id: dup.id, folder_id: dup.folder_id ?? null } : undefined,
      }, { status: 409 })
    }
    return NextResponse.json({ error: "Opslaan van de e-factuur is mislukt — probeer het opnieuw." }, { status: 500 })
  }
  const documentId = doc.id

  const fieldConfidence: Record<string, unknown> = {
    // A structured e-invoice is high-confidence per field where present; flag any missing field so
    // the verify queue's health badge asks the human to complete it (never a silent wrong number).
    vendor: v.supplierName ? 0.95 : 0.2,
    invoice_number: v.invoiceNumber ? 0.98 : 0.2,
    invoice_date: v.invoiceDate ? 0.98 : 0.2,
    _source: "ubl_xml",
  }
  // [DEDUP-SOFT] Merge a possible-duplicate signal into _safecore so classifyImportHealth reads it →
  // needs-review → the e-invoice is held out of auto-confirm and the queue shows "mogelijk dubbel".
  if (possibleDup) {
    const merged = mergePossibleDuplicate(fieldConfidence, possibleDup) as Record<string, unknown>
    fieldConfidence._safecore = merged._safecore
  }

  const { data: invoice, error: dbError } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null,
      receiver_id: userId,
      direction: "incoming",
      status: "processing", // always human-verified — a machine-read path stays gated (no auto-advance)
      source: "upload",
      client_name: v.supplierName || "Onbekende afzender",
      invoice_date: v.invoiceDate,
      due_date: v.dueDate,
      invoice_number: v.invoiceNumber || `UBL-${Date.now()}`,
      invoice_type: v.isCreditNote ? "creditnota" : "factuur",
      total_ex_btw: totalExBtw,
      btw_amount: btwAmount,
      total_inc_btw: totalIncBtw ?? 0,
      pdf_url: storagePath,
      document_id: documentId,
      vendor_iban: v.vendorIban ?? null,
      field_confidence: fieldConfidence as InvoiceFieldConfidence,
    })
    .select("id")
    .single()

  if (dbError) {
    // Roll back OUR document row + stored blob (never a pre-existing row — this file was fresh).
    await pipeline.from("documents").delete().eq("id", documentId)
    await supabase.storage.from("documents").remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }
  if (invoice?.id) {
    await pipeline.from("documents").update({ invoice_id: invoice.id }).eq("id", documentId)
  }

  return NextResponse.json({
    ok: true,
    destination: "invoice",
    invoice_id: invoice?.id ?? null,
    document_id: documentId,
    ...(possibleDup
      ? { possibleDuplicate: { invoice_number: possibleDup.match.invoice_number, client_name: possibleDup.match.client_name, reason: possibleDup.reason } }
      : {}),
    message: possibleDup
      ? `E-factuur (UBL) ingelezen — let op: mogelijk dubbel${possibleDup.match.invoice_number ? ` met ${possibleDup.match.invoice_number}` : ""} (${possibleDup.reason}). Controleer voor je bevestigt.`
      : "E-factuur (UBL) ingelezen — controleer de gegevens in de verificatierij.",
  })
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

  // source MUST be an allowed daily_turnover.source value ('z_report' | 'manual') — the DB CHECK
  // rejects anything else, which would silently fail the whole booking. Provenance (PDF vs Excel)
  // lives in the audit log below (path: intake_pdf), not in this constrained column.
  const booked = await bookTurnoverRows(supabase, userId, [row], "z_report", { preserveSplit: true })
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
    const booked = await bookLedgerRows(supabase, userId, kind, accountNr, rows)
    if (!booked.ok) {
      return NextResponse.json({
        ok: true, destination: "document", document_id: documentId, sheet_kind: "ledger_review",
        message: "Grootboek-overzicht gelezen, maar opslaan is mislukt — probeer het opnieuw.",
      })
    }
    await logAuditAction({
      userId, action: "ledger.auto_imported", entityType: "ledger_daily", entityId: documentId ?? userId,
      newValue: { kind, account_nr: accountNr, days: booked.days, span: booked.span, file_name: file.name, path: "intake" },
      ipAddress: getClientIP(req),
    }).catch(() => {})
    return NextResponse.json({
      ok: true, destination: "ledger", document_id: documentId, ledger_kind: kind,
      days: booked.days, span: booked.span,
      message: `${ledgerKindLabel(kind)} ingelezen ✓ — ${booked.days} dagen (${booked.span}) als controle-check. Verschijnt in de reconciliatie, niet dubbel in je omzet.`,
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
  let msg =
    result.parsed === 0
      ? "Bankafschrift opgeslagen, maar er zijn geen transacties gelezen — controleer het bestand."
      : unreadable > 0
        ? `Bankafschrift verwerkt — ${result.inserted} transactie(s) toegevoegd. Let op: ${unreadable} regel(s) konden niet gelezen worden en staan niet in je overzicht — controleer het originele bestand.`
        : `Bankafschrift verwerkt — ${result.inserted} transactie(s) toegevoegd.`
  // [BANK-BALANCE §2.6] A statement whose begin/eindsaldo doesn't tie out to its own transactions
  // is INCOMPLETE — surface it prominently (this is exactly the "missing bank line" the owner can't
  // otherwise see), appended to the honest message and returned structured for the caller.
  if (result.balanceWarning) msg += ` ${result.balanceWarning}`
  return NextResponse.json({
    ok: true,
    destination: "bank",
    format: result.format,
    parsed: result.parsed,
    inserted: result.inserted,
    skipped: result.skipped,
    statementStored: result.statementStored,
    parseWarnings: result.parseWarnings,
    balanceWarning: result.balanceWarning,
    message: msg,
  })
}