// src/lib/intake-router.ts
// [SMART-INTAKE] Pure routing logic for the unified intake point.
//
// One entry (camera/upload) → this router decides the destination. It is a PURE
// function: no I/O, no DB, no fetch — fully testable with `npx tsx`. The API
// route (/api/intake) calls this, then dispatches to the EXISTING paths
// (invoice upload / bank upload / bestanden) — it never duplicates their logic.
//
// Four destinations:
//   - 'bank'     : a bank statement (MT940 / CAMT.053 text/XML) → bank pipeline.
//   - 'invoice'  : an unpaid invoice → incoming, verify queue (current path).
//   - 'receipt'  : a PAID receipt/kassabon → incoming, verify queue, but
//                  pre-suggested as 'paid' (the human confirms — Pillar ⑤).
//   - 'document' : not an invoice/receipt → bestanden (general document store).
//
// Money-truth guardrails baked in:
//   - A receipt is NEVER auto-marked paid here. It enters as a SUGGESTION; the
//     verify queue surfaces it and the human confirms. (Decided with M.)
//   - A bank statement is detected BEFORE the AI, by file shape — it is never
//     run through the invoice extractor.
//   - When unsure, fall back to 'invoice' (enters the human-reviewed queue),
//     never to a silently-paid or silently-dropped state.

// ─── Bank-file detection (pre-AI, by shape) ───────────────────────────────────
// Mirrors parseBankFile's own detection so the router agrees with the parser.
// A photographed bank statement (an image) is NOT detectable as bank data and
// will fall through to the AI path (and be classified as document/other) — by
// design: bank statements are EXPORTED from the bank as a file, not photographed.

// [BANK-CSV] Shared content sniff — the SAME predicate parseBankFile uses to route
// CSV, so the router and the parser can never disagree about what a bank CSV is.
import { looksLikeBankCsv } from "./bank-csv"

const BANK_EXTENSIONS = [".mt940", ".sta", ".camt", ".053"]

export function looksLikeBankFile(filename: string, mimeType: string, textHead?: string): boolean {
  const lower = (filename || "").toLowerCase()

  // XML statement (CAMT.053): .xml + ISO 20022 marker in the head, or the
  // BkToCstmrStmt root. A plain .xml without those markers is NOT assumed bank.
  if (lower.endsWith(".xml") || mimeType === "application/xml" || mimeType === "text/xml") {
    if (textHead && (textHead.includes("urn:iso:std:iso:20022") || textHead.includes("<BkToCstmrStmt"))) {
      return true
    }
    // an .xml we can't confirm as a statement → not bank (let it fall through)
    return false
  }

  // MT940 / dedicated bank extensions
  if (BANK_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true

  // MT940 content marker in a .txt/.sta: starts with the :20: transaction ref tag
  if (textHead && /(^|\n):20:/.test(textHead)) return true

  // [BANK-CSV] CSV bank export (ING/Rabo/bunq/SNS/…). We do NOT route by the .csv
  // extension alone — a .csv is just as likely a turnover/product export — but by
  // the header SHAPE, exactly as parseBankFile does. looksLikeBankCsv requires a
  // header row with both a date- and an amount-column word, so a non-bank CSV
  // falls through to the AI/document path instead of the bank importer.
  if (textHead && looksLikeBankCsv(textHead)) return true

  return false
}

// ─── Result types the AI path provides (subset of VerifyInvoiceResult) ────────

export interface IntakeClassification {
  is_invoice: boolean
  document_kind?: "invoice" | "receipt" | "other"
  is_paid?: boolean
  confidence?: number
}

export type IntakeDestination = "bank" | "invoice" | "receipt" | "document"

export interface IntakeDecision {
  destination: IntakeDestination
  // For 'receipt': suggest 'paid' in the verify queue (human confirms).
  suggestPaid: boolean
  reason: string // short, for audit/debug
}

// ─── Stage 1: pre-AI decision (file shape only) ───────────────────────────────
// Called BEFORE spending an AI call. Returns 'bank' when the file is clearly a
// statement; otherwise null → caller runs the AI and then calls decideFromAi.

export function decidePreAi(
  filename: string,
  mimeType: string,
  textHead?: string
): IntakeDecision | null {
  if (looksLikeBankFile(filename, mimeType, textHead)) {
    return { destination: "bank", suggestPaid: false, reason: "bank_file_shape" }
  }
  return null
}

// ─── Stage 2: post-AI decision (image/PDF that wasn't a bank file) ────────────

export function decideFromAi(ai: IntakeClassification): IntakeDecision {
  // Not a financial doc for the pipeline → general document store.
  if (!ai.is_invoice || ai.document_kind === "other") {
    return { destination: "document", suggestPaid: false, reason: "ai_other" }
  }

  // Paid receipt/kassabon → verify queue, pre-suggest paid (human confirms).
  if (ai.document_kind === "receipt") {
    return {
      destination: "receipt",
      suggestPaid: ai.is_paid === true,
      reason: ai.is_paid ? "ai_receipt_paid" : "ai_receipt_unpaid",
    }
  }

  // Default: an invoice (or anything unclear that the AI still called an
  // invoice) → the normal verify queue, unpaid. Safe default.
  return { destination: "invoice", suggestPaid: false, reason: "ai_invoice" }
}