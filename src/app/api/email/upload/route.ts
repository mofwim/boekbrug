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
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import { resolveImportTarget } from "@/lib/bestanden";
// [BRIDGE-EXTRACT] byte-hash dedup — één bestand → één hash → één record
import { computeContentHash } from "@/lib/content-hash";
import { findSemanticDuplicate, normalizeInvoiceNumber, normalizeToIso } from "@/lib/safecore";
import { buildFolderBreadcrumb } from "@/lib/documents";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [COST] Per-user ceiling on the AI/OCR upload pipeline (Claude calls).
  const rl = await checkRateLimit({ userId: user.id, endpoint: "/api/email/upload", ...RATE_LIMITS.AI_OCR });
  if (!rl.allowed) return rateLimitResponse(rl);

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

  // [BRIDGE-EXTRACT] Byte-hash dedup gate — BEFORE AI verify, Storage, and BOTH
  // inserts (documents + invoices). Hash the raw bytes (deterministic). A rejected
  // duplicate must never reach the invoice insert, or we'd block the document but
  // still create an orphan invoice. Cross-path: same hash as email / Mijn bestanden.
  // Reject (Layer 1) — references are Layer 2. Also saves an AI call on duplicates.
  const contentHash = computeContentHash(buffer);

  const { data: existingDoc } = await supabase
    .from("documents")
    .select("id, file_name, folder_id")
    .eq("user_id", user.id)
    .eq("content_hash", contentHash)
    .limit(1)
    .maybeSingle();

  if (existingDoc) {
    // [BRIDGE-EXTRACT] Full folder path (root→leaf) — folders nest, leaf name
    // alone is ambiguous. Walk parent_id up the chain.
    const folderPath = await buildFolderBreadcrumb(
      supabase,
      user.id,
      existingDoc.folder_id ?? null
    );
    const folderName = folderPath.length ? folderPath[folderPath.length - 1] : null;

    await logAuditAction({
      userId: user.id,
      action: "document.duplicate_blocked",
      entityType: "document",
      entityId: existingDoc.id,
      newValue: { file_name: file.name, content_hash: contentHash, path: "manual_upload" },
      ipAddress: getClientIP(req),
    });

    const where = folderPath.length
      ? `Dit bestand staat al in: ${folderPath.join(" / ")}`
      : "Dit bestand is al toegevoegd";

    return NextResponse.json(
      {
        error: where,
        duplicate: true,
        existing: {
          id: existingDoc.id,
          file_name: existingDoc.file_name,
          folder_name: folderName,
          folder_path: folderPath,
        },
      },
      { status: 409 }
    );
  }

  // [BRIDGE-EXTRACT] Tell the AI who WE are (the receiver) so it never returns
  // our own company as the vendor. Falls back to full_name, then null.
  const { data: me } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const receiverName = me?.company_name || me?.full_name || null;

  // [BOEK-011] Claude verifies the actual file
  const verification = await verifyInvoiceFromPdf(base64, file.type, file.name, receiverName);

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

  // [DEDUP-SEMANTIC / I2] The byte-hash gate above only blocks an IDENTICAL file. A
  // re-photographed paper invoice or a re-generated PDF (different bytes, same bill)
  // slipped past and DOUBLE-BOOKED the cost — intake and email-sync run a graded semantic
  // dedup, but manual upload did not. Run the same check here, with a "toch toevoegen"
  // (force) escape so a genuine second document is never permanently blocked.
  const force = formData.get("force") === "true";
  const dup = await findSemanticDuplicate(
    {
      invoiceNumber: verification.invoice_number,
      vendor: verification.vendor,
      totalIncBtw: verification.total_inc_btw ?? verification.amount,
      invoiceDate: verification.invoice_date,
    },
    async (q) => {
      let query = supabase
        .from("invoices")
        .select("id, invoice_number, client_name")
        .eq("receiver_id", user.id)
        .eq("direction", "incoming")
        .eq("total_inc_btw", q.total);
      if (q.tier === "vendor" && q.vendor) query = query.ilike("client_name", q.vendor);
      if (q.dateIso) query = query.eq("invoice_date", q.dateIso);
      // [DEDUP-NUMBER-NORM] Compare the number whitespace-normalized in code (an exact .eq
      // missed "26 / 3958" vs "26/3958"); the candidate set is already pinned by total(+date).
      // [DEDUP-WINDOW] Deterministic order + a wide cap so the number match never falls
      // outside the window (dropping the .eq removed the natural bound).
      const { data } = await query.order("id", { ascending: false }).limit(200);
      const rows = data ?? [];
      const hit =
        q.tier === "number" && q.invoiceNumber
          ? rows.find((r) => normalizeInvoiceNumber(r.invoice_number) === normalizeInvoiceNumber(q.invoiceNumber))
          : rows[0];
      return hit ? { id: hit.id, invoice_number: hit.invoice_number, client_name: hit.client_name } : null;
    }
  );
  if (dup.duplicate && dup.match && !force) {
    return NextResponse.json(
      {
        error: `Deze factuur (${verification.invoice_number ?? "onbekend nummer"}) lijkt al toegevoegd.`,
        duplicate: true,
        semantic: true,
        matchedOn: dup.tier,
        existing: { id: dup.match.id, invoice_number: dup.match.invoice_number },
      },
      { status: 409 }
    );
  }
  if (dup.duplicate && dup.match && force) {
    // The owner already saw "bestaat al" and chose to add anyway — record the override.
    await logAuditAction({
      userId: user.id,
      action: "invoice.dedup_override",
      entityType: "invoice",
      entityId: dup.match.id,
      newValue: { reason: "user_forced_add", matched_on: dup.tier, invoice_number: verification.invoice_number ?? null, path: "manual_upload" },
      ipAddress: getClientIP(req),
    });
  }

  // Store the file in Supabase Storage
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/incoming/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  // [R7] A swallowed upload error used to let the flow insert an invoice with
  // pdf_url/document_id = null — a counted invoice whose evidence is UNRETRIEVABLE (the
  // closing package resolves an incoming invoice's PDF via document_id). Fail loudly so
  // the owner retries, instead of reporting "ok" over lost evidence. (Mirrors intake R1.)
  if (uploadError) {
    return NextResponse.json(
      { error: "Bestand kon niet worden opgeslagen — probeer het opnieuw." },
      { status: 502 }
    );
  }
  const pdfUrl = storagePath;

  // [DATE-GATE] Honest date: null when none was extracted — no today fallback.
  // The confirm route blocks a null date until the reviewer enters it.
  // [DATE-ISO-SAFE / I6] Tolerant + never-throw (a DD-MM-YYYY used to 500 the upload).
  const invoiceDate = normalizeToIso(verification.invoice_date);

  // [BOEK-011] Resolve correct folder via BOEK-033's function
  // ctx='user' — manual upload, user is logged in (RLS session active)
  const folderId = await resolveImportTarget(
    user.id,
    verification.invoice_date ?? null,
    "facturen",
    "user"
  );

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      file_name: file.name,
      file_url: storagePath,
      file_size: file.size,
      file_type: file.type,
      doc_type: "factuur",
      folder_id: folderId,
      year: invoiceDate ? new Date(invoiceDate).getFullYear() : null,
      source: "upload",
      ai_processed: true,
      ai_doc_type: "invoice",
      content_hash: contentHash,               // [BRIDGE-EXTRACT] byte-hash for cross-path dedup
    })
    .select("id")
    .single();
  // [R7] The document row IS the evidence link. If it fails to write, roll back the
  // stored file and stop — never create an evidence-less invoice.
  if (docErr || !doc) {
    await supabase.storage.from("documents").remove([storagePath]);
    // [DEDUP-ATOMIC] A concurrent double-submit that raced past the byte-hash SELECT above trips the
    // (user_id, content_hash) UNIQUE index here (23505). Treat it like the SELECT-found duplicate so
    // no second invoice is created — return a duplicate, not a 500 that invites a retry.
    if (docErr && (docErr as { code?: string }).code === "23505") {
      const { data: dup } = await supabase
        .from("documents").select("id, file_name, folder_id").eq("user_id", user.id).eq("content_hash", contentHash).limit(1).maybeSingle();
      const folderPath = dup ? await buildFolderBreadcrumb(supabase, user.id, dup.folder_id ?? null) : [];
      const where = folderPath.length ? `Dit bestand staat al in: ${folderPath.join(" / ")}` : "Dit bestand is al toegevoegd";
      return NextResponse.json({
        error: where, duplicate: true,
        existing: dup ? { id: dup.id, file_name: dup.file_name, folder_name: folderPath.length ? folderPath[folderPath.length - 1] : null, folder_path: folderPath } : undefined,
      }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Opslaan van de factuur is mislukt — probeer het opnieuw." },
      { status: 500 }
    );
  }
  const documentId = doc.id;

  // Save the invoice — status 'received', awaiting confirmation
  // [BOEK-011 + BOEK-SECURITY] Incoming invoice: receiver_id = user, sender_id = null.
  // Must use service_role: invoices_zzp_insert RLS requires sender_id = auth.uid(),
  // which fails for incoming (sender_id is null — vendor isn't a BoekBrug user).
  const pipeline = createPipelineClient();

  // [SUPPLIER-REGISTRY] Same canonical-supplier resolution as the email-sync path, so a manually
  // uploaded invoice unifies under the same supplier (and adopts its canonical name) instead of
  // creating yet another name variant. Best-effort: null → raw name + null supplier_id.
  const uploadedSupplier = await resolveSupplierForImport(pipeline, user.id, {
    name: verification.vendor,
    iban: verification.vendor_iban ?? null,
    kvk: verification.vendor_kvk ?? null,
    btw: verification.vendor_btw ?? null,
  });

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
      supplier_id: uploadedSupplier?.id ?? null,
      client_name: uploadedSupplier?.name || verification.vendor || "Onbekende afzender",
      invoice_date: invoiceDate,
      invoice_number: verification.invoice_number || `UPLOAD-${Date.now()}`,
      total_ex_btw: verification.total_ex_btw ?? 0,
      btw_amount: verification.btw_amount ?? 0,
      total_inc_btw: verification.total_inc_btw ?? verification.amount ?? 0,
      pdf_url: pdfUrl,
      document_id: documentId,
      // [PAY-SAFE-EXTRACT] vendor payment details — null when absent. Prepares
      // a future payment (EPC QR / pre-filled); BoekBrug never processes money.
      vendor_iban: verification.vendor_iban ?? null,
      payment_reference: verification.payment_reference ?? null,
      // [BRIDGE-EXTRACT] per-field AI confidence → the modal flags weak fields
      field_confidence: verification.field_confidence ?? null,
      // [DEDUP-CREDITNOTA / I3] A creditnota keeps NEGATIVE amounts (numSigned) and must be
      // TYPED as one, exactly like the email-sync and intake paths — otherwise the read-time
      // health classifier picks the positive-expecting arithmetic gate and a legitimately
      // negative credit reads as an error / aggregates with the wrong sign.
      invoice_type: verification.is_credit_note === true ? "creditnota" : "factuur",
    })
    .select("id")
    .single();

  if (dbError) {
    // [R7/M4] Roll back the document row + stored file so the evidence isn't orphaned —
    // its content_hash would otherwise make the byte-hash dedup BLOCK a re-upload (409),
    // trapping the owner with a file they can neither re-add nor see as an invoice.
    await pipeline.from("documents").delete().eq("id", documentId);
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // [BOEK-011] Link document back to invoice (bidirectional) — same pipeline
  if (invoice?.id) {
    await pipeline
      .from("documents")
      .update({ invoice_id: invoice.id })
      .eq("id", documentId);
  }

  return NextResponse.json({ ok: true, invoice_id: invoice?.id });
}