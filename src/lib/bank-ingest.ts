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
import { looksLikeSpreadsheetBinary, detectSheetKind } from "./detect-file";
import { sheetBytesToMatrix } from "./xlsx-adapter";
import { dedupTransactions, mapToRows, dateRange, type ExistingTxKey } from "./bank-import";
import { computeContentHash } from "./content-hash";
import { resolveImportTarget } from "./bestanden";
import { runBankAutoConfirm } from "./bank-auto-confirm";

export interface BankImportResult {
  format: string | null;
  accountIban: string | null;
  parsed: number;            // transactions the parser could read
  inserted: number;          // new rows written
  skipped: number;           // duplicates skipped (already stored)
  parseWarnings: string[];   // lines the parser could NOT read (each = a dropped tx)
  statementStored: boolean;  // raw passthrough copy stored (or already present)
  minDate: string | null;    // earliest tx date (for period tagging / folder)
  // [DETECT] The upload is a spreadsheet (xlsx/xls), not a bank statement (MT940/CAMT).
  // Set so the caller tells the owner the truth ("geen banktransacties geïmporteerd")
  // instead of the old silent 0-transaction passthrough that LOOKED ingested.
  nonBankSpreadsheet: boolean;
}

export async function importBankStatement(args: {
  buffer: Buffer;
  filename: string;
  fileType: string;
  userId: string;
  pipeline: PipelineClient;
}): Promise<BankImportResult> {
  const { buffer, filename, fileType, userId, pipeline } = args;

  // [DETECT] A bank statement is MT940 (text) or CAMT.053 (XML). A spreadsheet (xlsx/xls)
  // is a binary ZIP/OLE2 container — decoding it as UTF-8 and running parseBankFile yields
  // ZERO transactions while looking successful (the old false-green trap). Detect the
  // binary up front, skip the fake parse, and tell the caller the truth. The raw file is
  // still stored below so the accountant always has it.
  let parsed: ReturnType<typeof parseBankFile> | null = null;
  let nonBankSpreadsheet = false;
  const extraWarnings: string[] = [];
  if (looksLikeSpreadsheetBinary(buffer)) {
    nonBankSpreadsheet = true;
    let hint = "Dit bestand is een spreadsheet (xlsx/xls), geen bankafschrift (MT940/CAMT). Er zijn GEEN banktransacties geïmporteerd.";
    try {
      const kind = detectSheetKind(sheetBytesToMatrix(new Uint8Array(buffer)));
      if (kind === "ledger") hint += " Het lijkt een grootboek/kas-export — importeer het via de dagomzet/kas-kant, niet als bankafschrift.";
      else if (kind === "turnover") hint += " Het lijkt een kassa-omzetbestand (Z-rapport) — importeer het via Dagomzet.";
      else hint += " Upload een MT940- of CAMT.053-bestand van je bank voor de banktransacties.";
    } catch { /* detection is best-effort */ }
    extraWarnings.push(hint);
  } else {
    const content = buffer.toString("utf8");
    try {
      parsed = parseBankFile(content, filename);
    } catch {
      parsed = null; // unparseable format — still stored as passthrough below
    }
  }

  const transactions = parsed?.transactions ?? [];
  const { min } = dateRange(transactions);

  // ── dedup + insert transactions (only when the parse yielded some) ──
  let inserted = 0;
  let skipped = 0;
  let insertedIds: string[] = [];      // [BANK-TX-STATEMENT-LINK] the rows THIS import created
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
      const { data: insData, error } = await pipeline.from("bank_transactions").insert(rows).select("id");
      if (!error) { inserted = rows.length; insertedIds = (insData ?? []).map((r) => r.id as string); }
    }
  }

  // [BANK-CIRCLE-SERVER] Close the circle on the SERVER the moment new transactions land —
  // book the near-certain payments (reference printed + amount to the cent) without waiting
  // for the owner to open /dashboard/bank. No session here, so the pay write uses the
  // service-role pipeline; the isEligible guard inside is authoritative. Best-effort: a
  // reconcile hiccup must never fail the import (the /bank load pass remains the backstop).
  if (inserted > 0) {
    try {
      await runBankAutoConfirm({ payClient: pipeline, pipeline, userId });
    } catch (e) {
      console.error("[BANK-INGEST] auto-confirm after import failed (non-fatal)", e);
    }
  }

  // ── raw passthrough store (best-effort — the transactions above are unaffected) ──
  let statementStored = false;
  let statementDocId: string | null = null; // [BANK-TX-STATEMENT-LINK] the statement this import created/reused
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
      statementDocId = existingDoc.id as string;
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
        statementDocId = (sdoc?.id as string | undefined) ?? null;
      }
    }
  } catch {
    // best-effort — the transactions are stored regardless; only the passthrough is missing
  }

  // [BANK-TX-STATEMENT-LINK] Stamp the statement onto the rows THIS import created, so deleting
  // the statement can later reverse exactly its own bookings (and re-import can't double). Only
  // the freshly-inserted rows — never rows a prior import already owns. Best-effort.
  if (statementDocId && insertedIds.length > 0) {
    try {
      await pipeline
        .from("bank_transactions")
        .update({ statement_document_id: statementDocId })
        .in("id", insertedIds)
        .eq("user_id", userId);
    } catch {
      /* non-fatal — the link is a convenience for reversal, not a money figure */
    }
  }

  return {
    format: parsed?.format ?? null,
    accountIban: parsed?.accountIban ?? null,
    parsed: transactions.length,
    inserted,
    skipped,
    parseWarnings: [...extraWarnings, ...(parsed?.parseErrors ?? [])],
    statementStored,
    minDate: min,
    nonBankSpreadsheet,
  };
}
