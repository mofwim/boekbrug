// src/lib/import-health.ts
// [IMPORT-MONITOR] Part 1 — read-time import-health classification.
//
// PURPOSE: turn the signals that ALREADY exist on an incoming invoice into a
// single, plain-language health verdict the owner can act on. This is VISIBILITY
// over existing validation, not new validation (§4). It writes nothing, runs no
// migration, and reuses the EXACT arithmetic gate from @/lib/safecore.
//
// Two signal sources, both already present per import:
//   1. field_confidence._safecore  — the stored arithmetic hold reason, written
//      by the EMAIL path at import time when the math failed (BOEK-SAFECORE).
//   2. field_confidence.{vendor,invoice_number,invoice_date} — the AI's per-field
//      confidence (BRIDGE-EXTRACT).
//
// 🔴 THE UPLOAD-PATH COMPENSATION: the upload path holds every invoice in
// 'processing' but NEVER runs the arithmetic gate, so it never writes _safecore.
// A manually-uploaded invoice with excl+BTW≠incl would otherwise look identical
// to a clean one. So when _safecore is ABSENT, we recompute the verdict here, at
// read-time, over the stored amounts — using the same evaluateArithmetic. This
// gives correct health for BOTH paths even before SAFECORE-UPLOAD-1 fixes the
// upload path's write-time gate.
//
// HEALTH vs FLOW (the two-axis model — see IMPORT-MONITOR Part 2):
//   - health  = "is anything WRONG?" (arithmetic / low-confidence) → this file.
//   - flow    = "is anything waiting to be SENT onward?" → simply: it's pending.
// A clean-but-unsent invoice is healthy (no warning) AND waiting-to-flow. This
// file answers ONLY the health axis; the flow axis is just "is it in the queue",
// which the page already knows. Keeping them separate is what lets a clean
// upload read "✓ ready to confirm" (calm) instead of "review this" (alarm).

import { evaluateArithmetic, isPlaceholderInvoiceNumber } from '@/lib/safecore'

// Confidence below this → ask the owner to confirm the field (BRIDGE-EXTRACT's
// modal uses the same 0.7 threshold; kept identical so the surface and the modal
// agree on what "uncertain" means).
const LOW_CONFIDENCE = 0.7

export type HealthLevel = 'clean' | 'needs-review'

export interface ImportHealth {
  level: HealthLevel
  // Plain-language Dutch reasons, owner-facing. Empty when level === 'clean'.
  reasons: string[]
  // Machine-readable detail for the card/modal to highlight the right fields.
  flags: {
    arithmetic: boolean // a math problem (stored _safecore OR recomputed)
    vendor: boolean // AI unsure about the supplier
    invoiceNumber: boolean // AI unsure about the invoice number
    invoiceDate: boolean // AI unsure about the date
  }
}

// The amounts the classifier needs — a structural subset of the invoice row.
export interface HealthInput {
  total_ex_btw: number | null
  btw_amount: number | null
  total_inc_btw: number | null
  invoice_date: string | null
  // [TRUST-NUMBER] The STORED invoice number. The email path stores a fabricated
  // placeholder (EMAIL-<ts>) when the reader returned none, and the AI's per-field
  // confidence score defaults to 1 for a missing field — so a fabricated number reads
  // "clean" with no trace. Passing the value lets health flag a missing/placeholder
  // number. Optional so existing call sites keep compiling (undefined → not checked).
  invoice_number?: string | null
  // [BRIDGE-CREDITNOTA-SIGN] 'creditnota' → the recompute below takes the
  // sign-inverted gate (amounts must be NEGATIVE + consistent). Optional so
  // existing call sites keep compiling; absent/other → the standard gate.
  invoice_type?: string | null
  // field_confidence is jsonb: AI per-field scores PLUS an optional nested
  // _safecore object (present only when the email path held the invoice).
  field_confidence: FieldConfidence | null
}

// The runtime shape of the jsonb. The AI scores are flat keys; _safecore is a
// nested object written by BOEK-SAFECORE. Both optional — a clean email import
// stores null; a clean upload stores only AI scores (or null).
export interface FieldConfidence {
  vendor?: number
  invoice_number?: number
  invoice_date?: number
  // [TRUST-AMOUNTS] The money-truth's OWN confidence channel. The AI may emit any
  // of these for the amounts it read; we take the lowest present. Before this, the
  // amounts — the one set of facts that IS the money — carried no confidence at all,
  // so a confidently-wrong read (€121 → €109, internally consistent) passed clean.
  amount?: number
  total?: number
  total_inc_btw?: number
  _safecore?: {
    arithmetic_ok?: boolean
    reason?: string
    flags?: string[]
    held_at?: string
    dedup?: string
    dedup_reason?: string
  }
}

/**
 * [IMPORT-MONITOR] Classify one incoming invoice's import health.
 *
 * Pure: no DB, no I/O. Reads stored signals; recomputes arithmetic only when the
 * stored _safecore is absent (the upload-path compensation). Never mutates input.
 */
export function classifyImportHealth(inv: HealthInput): ImportHealth {
  const reasons: string[] = []
  const flags = {
    arithmetic: false,
    vendor: false,
    invoiceNumber: false,
    invoiceDate: false,
  }

  const fc = inv.field_confidence

  // ── Arithmetic axis ──────────────────────────────────────────────────────
  // Prefer the STORED reason (email path wrote it at import time). If absent,
  // recompute over the stored amounts (upload path never ran the gate). Either
  // way the source of truth is the same evaluateArithmetic logic.
  const storedSafecore = fc?._safecore
  if (storedSafecore && storedSafecore.arithmetic_ok === false) {
    flags.arithmetic = true
    // The stored reason is already owner-facing Dutch (e.g. "excl + BTW ≠ totaal").
    if (storedSafecore.reason) reasons.push(storedSafecore.reason)
    else reasons.push('mogelijke rekenfout in de bedragen')
  } else if (!storedSafecore) {
    // No stored verdict → recompute (covers the upload path + any legacy row).
    // [BRIDGE-CREDITNOTA-SIGN] Same gate, same branch selection as write time:
    // a creditnota row (invoice_type) takes the sign-inverted gate, so a clean
    // negative creditnota reads "ready" here instead of a false "Aandacht nodig".
    const verdict = evaluateArithmetic(
      {
        totalExBtw: inv.total_ex_btw,
        btwAmount: inv.btw_amount,
        totalIncBtw: inv.total_inc_btw,
        invoiceDate: inv.invoice_date,
      },
      { isCreditNote: inv.invoice_type === 'creditnota' }
    )
    if (!verdict.ok) {
      flags.arithmetic = true
      if (verdict.reason) reasons.push(verdict.reason)
      else reasons.push('mogelijke rekenfout in de bedragen')
    }
  }
  // (If storedSafecore exists AND arithmetic_ok !== false, the email path held
  //  it for a dedup note only, not a math problem — not a health warning here.)

  // ── Money-truth axis (the amounts themselves) ────────────────────────────
  // [TRUST-AMOUNTS] The arithmetic gate above only runs its consistency checks
  // when incl > 0, so a MISSING or €0 total slips through as "clean" — a real
  // invoice the reader couldn't price would book as a €0 record with no warning.
  // The total is the money-truth; if it's absent or zero, that is never "clean" —
  // ask the human. (Legitimate €0 invoices effectively don't exist; a check costs
  // the owner one glance and prevents a silent €0 booking.)
  const incl = inv.total_inc_btw
  if (incl == null || Math.abs(incl) < 0.005) {
    flags.arithmetic = true
    reasons.push('het totaalbedrag ontbreekt of is € 0 — controleer de bedragen')
  }

  // [TRUST-AMOUNTS] The amounts' own confidence, when the reader provided it. A
  // low score means the reader itself was unsure about the money — surface that
  // loudly instead of presenting a confident-looking total. We under-claim: only
  // flag when a score is actually present and low (never fabricate doubt).
  if (fc) {
    const amountScores = [fc.amount, fc.total, fc.total_inc_btw].filter(
      (n): n is number => typeof n === 'number'
    )
    if (amountScores.length > 0 && Math.min(...amountScores) < LOW_CONFIDENCE) {
      flags.arithmetic = true
      reasons.push('het bedrag is onzeker gelezen — controleer de bedragen')
    }
  }

  // ── Date axis ────────────────────────────────────────────────────────────
  // [TRUST-DATE] A MISSING invoice date is not "clean": the server confirm route
  // hard-blocks a dateless invoice (the DATE-GATE), so a green "klaar" pill would
  // lie — the owner taps confirm and it fails. Flag it here so the pill and the
  // server agree, and the owner is told to add the date up front.
  if (!inv.invoice_date || !String(inv.invoice_date).trim()) {
    flags.invoiceDate = true
    reasons.push('de factuurdatum ontbreekt — vul hem aan om te kunnen bevestigen')
  }

  // ── Invoice-number axis (the value, not just the AI's confidence) ────────
  // [TRUST-NUMBER] A missing/placeholder number is never "clean": the stored
  // EMAIL-<ts> placeholder is a fabricated identifier (defeats duplicate detection
  // and is not a real Art. 35 number). Only evaluate when the caller supplied the
  // field, so legacy call sites that don't pass it keep their old behaviour.
  if (inv.invoice_number !== undefined) {
    const num = inv.invoice_number
    if (!num || !String(num).trim() || isPlaceholderInvoiceNumber(num)) {
      flags.invoiceNumber = true
      reasons.push('het factuurnummer ontbreekt of kon niet worden gelezen — controleer het')
    }
  }

  // ── Confidence axis ──────────────────────────────────────────────────────
  // The AI told us which fields it was unsure about. Mirror the modal's logic:
  // a missing score defaults to confident (1) so we never false-flag clean rows.
  if (fc) {
    if ((fc.vendor ?? 1) < LOW_CONFIDENCE) {
      flags.vendor = true
      reasons.push('de leverancier is onzeker')
    }
    if ((fc.invoice_number ?? 1) < LOW_CONFIDENCE) {
      flags.invoiceNumber = true
      reasons.push('het factuurnummer is onzeker')
    }
    if ((fc.invoice_date ?? 1) < LOW_CONFIDENCE) {
      flags.invoiceDate = true
      reasons.push('de factuurdatum is onzeker')
    }
  }

  const level: HealthLevel =
    flags.arithmetic || flags.vendor || flags.invoiceNumber || flags.invoiceDate
      ? 'needs-review'
      : 'clean'

  return { level, reasons, flags }
}