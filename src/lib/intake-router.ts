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

// [BON-BETAALWIJZE] De vertaling van de afgedrukte tenderregel naar bank|kas. Pure module,
// getest tegen echte kassabonnen, zodat deze beslissing niet met het model meebeweegt.
import { gokBetaalwijze, normaliseerBetaalwijze } from "./bon-betaalwijze"

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
  // [PEN-MARK] Payment hints read from a handwritten note or a shop stamp on a PAPER invoice.
  paid_method?: "bank" | "kas" | "pin" | null
  paid_date?: string | null
  // [BON-BETAALWIJZE] De tenderregel die een kassabon AFDRUKT, letterlijk overgenomen
  // ("Bankpas 70,29", "KONTANT 120,00 Afronding 0,02 Wisselgeld 7,10"). Bewust ruwe tekst:
  // het classificeren gebeurt in bon-betaalwijze.ts, die puur en getest is.
  paid_evidence?: string | null
  paid_card_last4?: string | null
  confidence?: number
}

export type IntakeDestination = "bank" | "invoice" | "receipt" | "document"

export interface IntakeDecision {
  destination: IntakeDestination
  // For 'receipt', or an invoice marked paid by a pen/stamp: suggest 'paid' in the verify
  // queue (the human still confirms — never auto-booked).
  suggestPaid: boolean
  // [PEN-MARK] When the paid suggestion comes from a written/stamped mark, carry HOW and WHEN
  // so the verify modal can pre-fill method + date. Null when unknown.
  // [BON-BETAALWIJZE] Normalised to the two values the rest of the app knows — 'pin' collapses
  // to 'bank' here, so no downstream writer can ever put a third value in payment_method.
  paidMethod?: "bank" | "kas" | null
  paidDate?: string | null
  // [BON-BETAALWIJZE] True only when the PAPER itself says how it was settled ("Bankpas",
  // "Kontant", "Wisselgeld"). That is the difference between writing payment_method without
  // asking and asking the owner one question: gok slim, vraag alleen als we het niet weten.
  paidMethodZeker?: boolean
  /** Het woord op de bon waar de gok op rust — naleesbaar bij een geschil. */
  paidEvidence?: string | null
  /** Laatste 4 cijfers van de pas, als de bon ze afdrukt. Maakt de bankmatch betrouwbaar. */
  paidCardLast4?: string | null
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
  // [BON-BETAALWIJZE] De betaalwijze komt van het PAPIER, niet van de interpretatie: de
  // afgedrukte tenderregel wint van ai.paid_method (zie bon-betaalwijze.ts). Staat er niets,
  // dan valt hij terug op het model — maar dan met zeker=false, zodat het scherm het vraagt
  // in plaats van het te beweren.
  if (ai.document_kind === "receipt") {
    const gok = gokBetaalwijze(ai.paid_evidence, ai.paid_method)
    return {
      destination: "receipt",
      suggestPaid: ai.is_paid === true,
      paidMethod: ai.is_paid ? gok.method : null,
      paidMethodZeker: ai.is_paid ? gok.zeker : false,
      paidEvidence: gok.bewijs ?? ai.paid_evidence ?? null,
      paidCardLast4: gok.kaartLaatste4 ?? ai.paid_card_last4 ?? null,
      paidDate: ai.is_paid ? (ai.paid_date ?? null) : null,
      reason: ai.is_paid ? "ai_receipt_paid" : "ai_receipt_unpaid",
    }
  }

  // [PEN-MARK] An INVOICE the owner marked paid by hand or a stamp ("betaald · kas · 16-2") →
  // still the verify queue, but pre-suggest paid + how + when so a snapped-and-thrown paper
  // invoice is one confirming tap, not manual entry. Never auto-booked — the human confirms.
  if (ai.is_paid === true) {
    return {
      destination: "invoice",
      suggestPaid: true,
      // [BON-BETAALWIJZE] Ook hier genormaliseerd: een pen-streep "pin" is een bankbetaling.
      // Een handgeschreven merk is nooit "zeker" in de zin van deze vlag — het is een lezing
      // van iemands pen, niet van een kassaregel.
      paidMethod: normaliseerBetaalwijze(ai.paid_method),
      paidMethodZeker: false,
      paidDate: ai.paid_date ?? null,
      reason: "ai_invoice_pen_paid",
    }
  }

  // Default: an invoice (or anything unclear that the AI still called an
  // invoice) → the normal verify queue, unpaid. Safe default.
  return { destination: "invoice", suggestPaid: false, reason: "ai_invoice" }
}