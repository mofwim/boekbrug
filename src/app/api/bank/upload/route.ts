// src/app/api/bank/upload/route.ts
// [BOEK-016] Upload + parse + store a bank statement (phase 2).
// Flow: auth → read file → parseBankFile() → content dedup → insert (status 'pending').
// NO matching here (phase 3) and NO payment side effects — this only stores raw transactions.
//
// Auth via the project's server client. Everything else (parse, dedup, insert)
// uses verified BOEK-016 helpers + the documented service_role pipeline client.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { parseBankFile } from "@/lib/bank-parser";
import { dedupTransactions, mapToRows, dateRange } from "@/lib/bank-import";
// [BANK-RAW-STORE] store the original statement file so the closing package can
// include it later (passthrough). Best-effort — never blocks the parse/insert.
import { computeContentHash } from "@/lib/content-hash";
import { resolveImportTarget } from "@/lib/bestanden";

const MAX_BYTES = 5_000_000; // 5 MB — bank statements are small text/XML

export async function POST(req: NextRequest) {
  // 1. Auth — session client (RLS). User may only upload for themselves.
  //    (await assumes the helper is async, i.e. it reads cookies() — drop await if it's sync.)
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Read the uploaded file
  let content: string;
  let filename: string;
  let fileBuffer: Buffer | null = null; // [BANK-RAW-STORE] keep raw bytes for storage
  let fileType = "text/plain";
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no_file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    content = await file.text();
    filename = file.name || "afschrift";
    fileType = file.type || "text/plain";
    // [BANK-RAW-STORE] capture bytes for the passthrough copy (best-effort use later)
    fileBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  // 3. Parse — BEST-EFFORT. The statement is delivered to the accountant via
  // passthrough (stored as-is) regardless of format. Parsing into
  // bank_transactions only matters IF we later enable invoice↔bank matching;
  // since we don't match today, an unparseable format (e.g. a bank CSV, a PDF
  // statement) must NOT be rejected — we still store it for the accountant.
  // parseBankFile understands MT940/CAMT; anything else → 0 transactions (or a
  // throw), which we swallow and continue to storage.
  let parsed: ReturnType<typeof parseBankFile> | null = null;
  try {
    parsed = parseBankFile(content, filename);
  } catch (parseErr) {
    console.error("[BANK-RAW-STORE] parse failed (non-fatal — storing anyway)", parseErr);
    parsed = null;
  }

  const pipeline = createPipelineClient();

  // 4. Insert transactions — only when parsing actually yielded some. Dedup
  // scoped to the file's date range. All best-effort: a DB hiccup here must not
  // lose the passthrough copy below.
  let inserted = 0;
  let skipped = 0;
  let min: string | null = null;
  let max: string | null = null;

  if (parsed && parsed.transactions.length > 0) {
    const range = dateRange(parsed.transactions);
    min = range.min;
    max = range.max;

    let existing: {
      date: string | null;
      amount: number | null;
      description: string | null;
      counterpart_name: string | null;
      reference: string | null;
    }[] = [];

    if (min && max) {
      const { data, error } = await pipeline
        .from("bank_transactions")
        .select("date, amount, description, counterpart_name, reference")
        .eq("user_id", user.id)
        .gte("date", min)
        .lte("date", max);
      if (!error) {
        existing = data ?? [];
      } else {
        console.error("[BANK-RAW-STORE] tx lookup failed (non-fatal)", error);
      }
    }

    const dedupResult = dedupTransactions(parsed.transactions, existing);
    skipped = dedupResult.skipped;
    if (dedupResult.toInsert.length > 0) {
      const rows = mapToRows(dedupResult.toInsert, user.id);
      const { error } = await pipeline.from("bank_transactions").insert(rows);
      if (!error) {
        inserted = rows.length;
      } else {
        console.error("[BANK-RAW-STORE] tx insert failed (non-fatal)", error);
      }
    }
  }

  // [BANK-RAW-STORE] Store the ORIGINAL statement file (passthrough) so the
  // closing package can include it later. Best-effort — a failure here NEVER
  // affects the parse/insert above (same discipline as FACTUUR-A's pdf_url).
  // Storage: documents bucket; documents row with source='upload' (CHECK allows
  // it — the statement IS uploaded) + doc_type='bankafschrift' (no CHECK on
  // doc_type → free to use as the closing-package filter key).
  let documentId: string | null = null;
  if (fileBuffer) {
    try {
      const contentHash = computeContentHash(fileBuffer);

      // Cross-path byte-hash dedup: don't store the exact same file twice.
      const { data: existingDoc } = await pipeline
        .from("documents")
        .select("id")
        .eq("user_id", user.id)
        .eq("content_hash", contentHash)
        .limit(1)
        .maybeSingle();

      if (existingDoc) {
        documentId = existingDoc.id;
      } else {
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${user.id}/bank/${Date.now()}-${safeName}`;
        const { error: uploadError } = await pipeline.storage
          .from("documents")
          .upload(storagePath, fileBuffer, { contentType: fileType, upsert: false });

        if (!uploadError) {
          // Folder: the bank folder for the statement's period (reuse existing
          // resolver; falls back to a sensible target). min = earliest tx date.
          const folderId = await resolveImportTarget(user.id, min ?? null, "bank", "pipeline");
          // [FIN-10] Tag the statement's coverage period from its earliest
          // transaction date, so the closing package can select it by quarter
          // rather than by upload time (a Q1 statement is uploaded in Q2). Null
          // when the file had no parseable dates — the package then falls back to
          // the created_at window.
          const stmtYear = min ? Number(min.slice(0, 4)) : null;
          const stmtPeriod = min
            ? `${min.slice(0, 4)}-Q${Math.ceil(Number(min.slice(5, 7)) / 3)}`
            : null;
          const { data: doc } = await pipeline
            .from("documents")
            .insert({
              user_id: user.id,
              file_name: filename,
              file_url: storagePath,
              file_size: fileBuffer.length,
              file_type: fileType,
              doc_type: "bankafschrift",
              folder_id: folderId,
              source: "upload",
              content_hash: contentHash,
              year: stmtYear,
              period: stmtPeriod,
            })
            .select("id")
            .single();
          documentId = doc?.id ?? null;
        } else {
          console.error("[BANK-RAW-STORE] statement storage upload failed", uploadError);
        }
      }
    } catch (storeErr) {
      // Best-effort — the bank statement is parsed and stored as transactions
      // regardless; only the passthrough copy is missing. Surfaced later as a
      // closing-package warning ("bankafschrift niet beschikbaar").
      console.error("[BANK-RAW-STORE] statement storage block error", storeErr);
    }
  }

  return NextResponse.json({
    ok: true,
    format: parsed?.format ?? null,
    accountIban: parsed?.accountIban ?? null,
    parsed: parsed?.transactions.length ?? 0,
    inserted,
    skipped,
    statementStored: documentId !== null, // [BANK-RAW-STORE]
    parseWarnings: parsed?.parseErrors ?? [],
  });
}