// src/lib/bank-ingest.ts
// [BANK-INGEST] Single source of truth for turning an uploaded bank statement into
// stored transactions + a passthrough copy of the original file. BOTH /api/bank/upload
// and the intake bank branch call this, so the parse → dedup → insert → raw-store
// pipeline can never diverge between the two entry points. (They previously kept two
// copies, and the intake copy had drifted: no passthrough, swallowed parse warnings.)
//
// Discipline preserved from /api/bank/upload:
//   - Parsing is BEST-EFFORT. An unparseable format (bank CSV/PDF) yields 0 transactions
//     but the raw file is STILL stored for the accountant — never rejected.
//   - The raw passthrough copy is stored regardless of the transaction count, deduped by
//     byte-hash so the same file is never stored twice.
//   - Transaction insert is best-effort (the raw file is the safety net); parseWarnings
//     (lines the parser could not read) travel back so the caller can surface them.

import type { PipelineClient } from "./supabase-pipeline";
import { parseBankFile } from "./bank-parser";
import { dedupTransactions, mapToRows, dateRange, type ExistingTxKey } from "./bank-import";
import { computeContentHash } from "./content-hash";
import { resolveImportTarget } from "./bestanden";

export interface BankImportResult {
  format: string | null;
  accountIban: string | null;
  parsed: number;            // transactions the parser could read
  inserted: number;          // new rows written
  skipped: number;           // duplicates skipped (already stored)
  parseWarnings: string[];   // lines the parser could NOT read (each = a dropped tx)
  statementStored: boolean;  // raw passthrough copy stored (or already present)
  minDate: string | null;    // earliest tx date (for period tagging / folder)
}

export async function importBankStatement(args: {
  buffer: Buffer;
  filename: string;
  fileType: string;
  userId: string;
  pipeline: PipelineClient;
}): Promise<BankImportResult> {
  const { buffer, filename, fileType, userId, pipeline } = args;
  const content = buffer.toString("utf8");

  let parsed: ReturnType<typeof parseBankFile> | null = null;
  try {
    parsed = parseBankFile(content, filename);
  } catch {
    parsed = null; // unparseable format — still stored as passthrough below
  }

  const transactions = parsed?.transactions ?? [];
  const { min } = dateRange(transactions);

  // ── dedup + insert transactions (only when the parse yielded some) ──
  let inserted = 0;
  let skipped = 0;
  if (transactions.length > 0) {
    let existing: ExistingTxKey[] = [];
    const { max } = dateRange(transactions);
    if (min && max) {
      const { data } = await pipeline
        .from("bank_transactions")
        .select("date, amount, description, counterpart_name, reference")
        .eq("user_id", userId)
        .gte("date", min)
        .lte("date", max);
      existing = (data ?? []) as ExistingTxKey[];
    }
    const dd = dedupTransactions(transactions, existing);
    skipped = dd.skipped;
    if (dd.toInsert.length > 0) {
      const rows = mapToRows(dd.toInsert, userId);
      const { error } = await pipeline.from("bank_transactions").insert(rows);
      if (!error) inserted = rows.length;
    }
  }

  // ── raw passthrough store (best-effort — the transactions above are unaffected) ──
  let statementStored = false;
  try {
    const contentHash = computeContentHash(buffer);
    const { data: existingDoc } = await pipeline
      .from("documents")
      .select("id")
      .eq("user_id", userId)
      .eq("content_hash", contentHash)
      .limit(1)
      .maybeSingle();
    if (existingDoc) {
      statementStored = true;
    } else {
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${userId}/bank/${Date.now()}-${safeName}`;
      const { error: upErr } = await pipeline.storage
        .from("documents")
        .upload(storagePath, buffer, { contentType: fileType, upsert: false });
      if (!upErr) {
        const folderId = await resolveImportTarget(userId, min ?? null, "bank", "pipeline");
        const stmtYear = min ? Number(min.slice(0, 4)) : null;
        const stmtPeriod = min ? `${min.slice(0, 4)}-Q${Math.ceil(Number(min.slice(5, 7)) / 3)}` : null;
        const { data: sdoc } = await pipeline
          .from("documents")
          .insert({
            user_id: userId,
            file_name: filename,
            file_url: storagePath,
            file_size: buffer.length,
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
        statementStored = sdoc?.id != null;
      }
    }
  } catch {
    // best-effort — the transactions are stored regardless; only the passthrough is missing
  }

  return {
    format: parsed?.format ?? null,
    accountIban: parsed?.accountIban ?? null,
    parsed: transactions.length,
    inserted,
    skipped,
    parseWarnings: parsed?.parseErrors ?? [],
    statementStored,
    minDate: min,
  };
}
