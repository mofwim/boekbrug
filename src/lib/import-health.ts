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
// [IBAN-WISSEL] Eén formulering voor "dit rekeningnummer is veranderd", gedeeld met het importpad.
import { ibanChangeReason } from '@/lib/iban-change'

// Confidence below this → ask the owner to confirm the field (BRIDGE-EXTRACT's
// modal uses the same 0.7 threshold; kept identical so the surface and the modal
// agree on what "uncertain" means).
const LOW_CONFIDENCE = 0.7

/** Dutch money formatting for an owner-facing reason. Local so this module stays dependency-free. */
function formatEuro(v: number): string {
  const [whole, cents] = Math.abs(v).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '− ' : ''}€ ${grouped},${cents}`
}

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
    reminder: boolean // [REMINDER] a payment reminder — check the original isn't already booked
    possibleDuplicate: boolean // [DEDUP-SOFT] a look-alike of an invoice already imported — human glance
    // [IBAN-WISSEL] A supplier we already know arrived with a DIFFERENT bank account. The
    // signature of invoice fraud — and the one axis every other gate here reads as clean.
    ibanChanged: boolean
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
  // [BTW-SUM-FIX] Present when the printed BTW total could not be read from a mixed-rate summary
  // block and was derived from excl + the paid total (see fixMisSummedBtw in @/lib/ai). The
  // amounts add up again, so every other axis goes quiet — which is exactly why this needs its
  // own reason: the figure is OUR arithmetic, and BTW is deductible money in the aangifte.
  _btw_derived?: { read?: number | null; used?: number | null }
  // [BON-NUMMER] Wat voor document dit is, gezet door /api/intake. 'receipt' = kassabon.
  // Een kassabon draagt geen factuurnummer en hoeft dat ook niet: hij is een vereenvoudigde
  // factuur, geen art. 35-factuur. De nummer-as hieronder wordt daarom voor een bon
  // overgeslagen — anders krijgt élke bon een amberen "Aandacht nodig" voor iets wat er niet
  // hoort te staan, en verdrinkt het echte signaal in ruis waar niemand meer naar kijkt.
  _intake_kind?: string
  _safecore?: {
    arithmetic_ok?: boolean
    reason?: string
    flags?: string[]
    held_at?: string
    dedup?: string
    dedup_reason?: string
    // [REMINDER] This invoice was read as a payment reminder — the original may already be
    // booked, so it needs a human check (never bulk-confirmed as a second cost).
    reminder?: boolean
    reminder_of?: string
    // [DEDUP-SOFT] This invoice looked like a POSSIBLE (not confident) duplicate at import — same
    // amount + date, or same amount + vendor a few days apart. It was NOT blocked (too uncertain to
    // reject), but the human should check it isn't a double booking. `_of` names the look-alike.
    possible_duplicate?: boolean
    possible_duplicate_of?: string
    // [SUPERSEDE] The id of the look-alike, so the queue can offer "Deze vervangt factuur X" and
    // the server can act on an exact row rather than on a display string. Absent on rows imported
    // before this existed — the flag still shows, only the one-tap button does not.
    possible_duplicate_id?: string
    possible_duplicate_reason?: string
    // [IBAN-WISSEL] Written at import time when a supplier we already hold under one bank account
    // sends an invoice with another one. `_from` / `_to` carry both numbers so the read-time reason
    // can show them side by side — comparing them IS the check the owner has to make.
    iban_changed?: boolean
    iban_changed_from?: string
    iban_changed_to?: string
  }
}

/**
 * [IMPORT-MONITOR] Classify one incoming invoice's import health.
 *
 * Pure: no DB, no I/O. Reads stored signals; recomputes arithmetic only when the
 * stored _safecore is absent (the upload-path compensation). Never mutates input.
 */
/**
 * [BON-NUMMER] Is dit een kassabon?
 *
 * Alleen de nummer-as hangt hiervan af — een bon draagt geen factuurnummer en hoeft dat niet.
 * Alle andere assen (rekenwerk, bedragen, datum, dubbel) blijven onverkort gelden: die gaan
 * over geld, en geld is op een bon net zo hard als op een factuur.
 *
 * De bron is _intake_kind uit field_confidence, gezet door /api/intake. Dat is een jsonb-veld
 * en dus niet als SQL te bevragen; voor een WEERGAVE-beslissing als deze is dat aanvaardbaar.
 * Zou er ooit een FISCALE regel aan bonnen worden opgehangen, dan hoort daar eerst een echte
 * kolom bij (invoice_type = 'bon'), niet dit veld.
 */
function isKassabon(fc: FieldConfidence | null | undefined): boolean {
  return fc?._intake_kind === 'receipt'
}

export function classifyImportHealth(inv: HealthInput): ImportHealth {
  const reasons: string[] = []
  const flags = {
    arithmetic: false,
    vendor: false,
    invoiceNumber: false,
    invoiceDate: false,
    reminder: false,
    possibleDuplicate: false,
    ibanChanged: false,
  }

  const fc = inv.field_confidence

  // ── Arithmetic axis ──────────────────────────────────────────────────────
  // Prefer the STORED reason (email path wrote it at import time). If absent,
  // recompute over the stored amounts (upload path never ran the gate). Either
  // way the source of truth is the same evaluateArithmetic logic.
  const storedSafecore = fc?._safecore
  // ── Reminder axis ────────────────────────────────────────────────────────
  // [REMINDER] A payment reminder is a real single invoice, but the original was very likely
  // already received — so this needs a human check before it's confirmed, to avoid booking the
  // same debt twice. Flag it (→ needs-review, excluded from bulk-confirm) with a clear reason.
  if (storedSafecore?.reminder === true) {
    flags.reminder = true
    reasons.push(
      storedSafecore.reminder_of
        ? `dit lijkt een herinnering voor factuur ${storedSafecore.reminder_of} — controleer of die al geboekt is`
        : 'dit lijkt een betalingsherinnering — controleer of de originele factuur al geboekt is'
    )
  }
  // [DEDUP-SOFT] A POSSIBLE (not confident) duplicate — same amount + date, or same amount +
  // vendor a few days apart. It was allowed in (too uncertain to block), but must never be
  // bulk-confirmed as a second cost without a human glance. → needs-review with a clear "mogelijk
  // dubbel met X" reason.
  if (storedSafecore?.possible_duplicate === true) {
    flags.possibleDuplicate = true
    const of = storedSafecore.possible_duplicate_of
    const why = storedSafecore.possible_duplicate_reason
    reasons.push(
      `mogelijk dubbel${of ? ` met factuur ${of}` : ''}${why ? ` (${why})` : ''} — controleer of dit geen dubbele boeking is`
    )
  }
  // [IBAN-WISSEL] Een bekende leverancier met een ander rekeningnummer. Dit staat bewust boven de
  // rekenkundige as: bij factuurfraude klopt de rekensom juist wél — het bedrag is overgenomen van
  // een echte factuur. Elke andere poort hier geeft groen, dus als deze zwijgt, zwijgt alles.
  if (storedSafecore?.iban_changed === true) {
    flags.ibanChanged = true
    const from = storedSafecore.iban_changed_from
    const to = storedSafecore.iban_changed_to
    reasons.push(
      from && to
        ? ibanChangeReason({ from, to })
        : 'het rekeningnummer van deze leverancier is veranderd — controleer dit vóór je betaalt, ' +
          'en bel de leverancier op een nummer dat je zelf opzoekt (niet het nummer op deze factuur)'
    )
  }
  if (storedSafecore && storedSafecore.arithmetic_ok === false) {
    flags.arithmetic = true
    // The stored reason is already owner-facing Dutch (e.g. "excl + BTW ≠ totaal").
    if (storedSafecore.reason) reasons.push(storedSafecore.reason)
    else reasons.push('mogelijke rekenfout in de bedragen')
  } else if (!storedSafecore || storedSafecore.arithmetic_ok === undefined) {
    // No stored arithmetic verdict → recompute. Covers the upload path, legacy rows, AND a
    // _safecore that carries ONLY a non-arithmetic flag (e.g. the intake path writes
    // possible_duplicate without ever running the arithmetic gate) — without this, an invoice
    // that is BOTH a possible-duplicate and arithmetically inconsistent would hide the math error.
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

  // [BTW-SUM-FIX] The reader could not sum the mixed-rate BTW block, so the BTW was derived from
  // the two printed anchors (excl + the paid total). The identity holds again — which means the
  // arithmetic gate above is now SILENT and nothing else would ever mention it. Say it out loud:
  // the total is still the invoice's, but this BTW is ours, and it is the voorbelasting the owner
  // will deduct. Always a human check, so a derived figure can never auto-book.
  if (fc?._btw_derived) {
    flags.arithmetic = true
    const used = fc._btw_derived.used
    reasons.push(
      typeof used === 'number'
        ? `de BTW-uitsplitsing was niet leesbaar — de BTW is afgeleid uit excl. en totaal (${formatEuro(used)}); controleer dit bedrag`
        : 'de BTW-uitsplitsing was niet leesbaar — de BTW is afgeleid uit excl. en totaal; controleer dit bedrag'
    )
  }

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
  // [BON-NUMMER] Een KASSABON is hiervan uitgezonderd — zie isKassabon().
  if (inv.invoice_number !== undefined && !isKassabon(fc)) {
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
    if ((fc.invoice_number ?? 1) < LOW_CONFIDENCE && !isKassabon(fc)) {
      flags.invoiceNumber = true
      reasons.push('het factuurnummer is onzeker')
    }
    if ((fc.invoice_date ?? 1) < LOW_CONFIDENCE) {
      flags.invoiceDate = true
      reasons.push('de factuurdatum is onzeker')
    }
  }

  const level: HealthLevel =
    flags.arithmetic || flags.vendor || flags.invoiceNumber || flags.invoiceDate || flags.reminder || flags.possibleDuplicate || flags.ibanChanged
      ? 'needs-review'
      : 'clean'

  return { level, reasons, flags }
}