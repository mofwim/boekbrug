// src/lib/safecore.ts
// [IMPORT-MONITOR] Part 0 — shared SAFECORE primitives.
//
// These pure functions were ORIGINALLY defined privately inside
// email-integration.ts (BOEK-SAFECORE Rule 1 + SAFECORE-GAP). They are moved
// here UNCHANGED so that more than one path can use the SAME logic:
//   - the email import path (write-time arithmetic gate — unchanged behaviour)
//   - the IMPORT-MONITOR read-time health classifier (computes the WHY for
//     held invoices that never got a stored _safecore — e.g. the upload path,
//     which holds everything in 'processing' but never ran the gate)
//
// 🔴 MOVE-ONLY: no logic changed. Every function below is a verbatim copy of
// the original private version. They are PURE — no DB, no I/O, no side effects —
// so relocating them cannot change any outcome. email-integration.ts now
// imports these instead of defining them.
//
// Out of scope (logged as SAFECORE-UPLOAD-1): making the upload WRITE path
// call evaluateArithmetic and persist _safecore. This module only makes the
// shared logic available; it does not change any write path.

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — arithmetic safety (no silent arithmetic error)
// ─────────────────────────────────────────────────────────────────────────────

export interface ArithmeticVerdict {
  ok: boolean
  // Human-readable Dutch reason (for field_confidence._safecore + audit).
  reason?: string
  // Machine flags for the audit trail / future UI.
  flags?: string[]
}

/**
 * [BOEK-SAFECORE] Minimal structural input for the arithmetic gate.
 *
 * The original gate took an `AttachmentClassification` (email-pipeline type).
 * To keep this module dependency-free AND callable at read-time over stored
 * DB amounts, it accepts only the fields it actually reads. The email path
 * passes its AttachmentClassification (structurally compatible); the read-time
 * classifier passes the stored invoice amounts. Identical fields, identical
 * arithmetic — no behavioural difference.
 */
export interface ArithmeticInput {
  totalExBtw?: number | null
  btwAmount?: number | null
  totalIncBtw?: number | null
  amount?: number | null // legacy alias for incl. BTW
  invoiceDate?: string | null
}

/**
 * [BOEK-SAFECORE] Pure arithmetic gate for an incoming invoice's numbers.
 * No DB, no side effects — just a verdict on the numbers.
 *
 * Structural (impossible values) → blocked:
 *   - any of ex/btw/incl is NaN, ±Infinity, or < 0
 *   - invoice year outside 2020–2030 (a plausible business range)
 * Consistency (internally wrong) → blocked:
 *   - |ex + btw − incl| > 0.02  (Excl/Incl mix-ups, dropped lines)
 *   - rate ∉ {0, 9, 21}  (legal NL BTW rates; computed, since btw_rate is
 *     not stored — Math.round((btw/ex)*100), guarded against ex=0)
 *
 * Note: a zero/empty invoice (all three 0) is treated as a structural problem
 * (incl ≤ 0) — an incoming invoice with no amount is not a valid financial
 * record and must not reach the accountant unreviewed.
 */
export function evaluateArithmetic(c: ArithmeticInput): ArithmeticVerdict {
  const flags: string[] = []
  const reasons: string[] = []

  const ex = c.totalExBtw ?? 0
  const btw = c.btwAmount ?? 0
  const incl = c.totalIncBtw ?? c.amount ?? 0

  // ── Structural: impossible numbers ──
  const finiteNonNeg = (v: number) => Number.isFinite(v) && v >= 0
  if (!finiteNonNeg(ex) || !finiteNonNeg(btw) || !finiteNonNeg(incl)) {
    flags.push('non_finite_or_negative')
    reasons.push('ongeldige bedragen (NaN/∞/negatief)')
  }

  // incl must be a real positive total — a 0/blank invoice is not bookable.
  if (Number.isFinite(incl) && incl <= 0) {
    flags.push('non_positive_total')
    reasons.push('totaalbedrag ontbreekt of is 0')
  }

  // ── Structural: date sanity (year 2020–2030) ──
  if (typeof c.invoiceDate === 'string' && c.invoiceDate.trim()) {
    const d = new Date(c.invoiceDate)
    const year = d.getFullYear()
    if (Number.isNaN(d.getTime()) || year < 2020 || year > 2030) {
      flags.push('date_out_of_range')
      reasons.push('factuurdatum buiten geldig bereik (2020–2030)')
    }
  }

  // ── Consistency checks only run when the numbers are at least finite. ──
  // (No point checking ex+btw=incl when one of them is already NaN/∞.)
  if (finiteNonNeg(ex) && finiteNonNeg(btw) && finiteNonNeg(incl) && incl > 0) {
    // excl + BTW must equal incl (tolerance 0.02 for rounding)
    if (Math.abs(ex + btw - incl) > 0.02) {
      flags.push('sum_mismatch')
      reasons.push('excl + BTW ≠ totaal')
    }
    // Legal BTW rate: computed (btw_rate is NOT stored). Guard division by zero;
    // when ex=0 we can't derive a rate, so we skip the rate check (the sum check
    // above already covers ex=0 cases meaningfully).
    if (ex > 0) {
      const rate = Math.round((btw / ex) * 100)
      if (rate !== 0 && rate !== 9 && rate !== 21) {
        flags.push('illegal_btw_rate')
        reasons.push(`ongeldig BTW-tarief (${rate}%)`)
      }
    }
  }

  if (flags.length === 0) return { ok: true }
  return { ok: false, reason: reasons.join('; '), flags }
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFECORE-GAP — placeholder-aware dedup helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// When AI extraction fails to find a real invoice number, both the upload and
// email paths substitute a UNIQUE placeholder — `UPLOAD-<ts>` or `EMAIL-<ts>`.
// SAFECORE Rule 2's key trusts invoice_number, so a unique placeholder makes
// the key differ on every arrival → duplicate detection is silently defeated →
// double-pay risk. These helpers let the dedup logic detect a placeholder and
// fall back to the next reliable anchor.

/**
 * A placeholder invoice number is a generated stand-in, not a real number.
 * Prefix-agnostic across both ingestion paths (UPLOAD-/EMAIL- + timestamp).
 */
export function isPlaceholderInvoiceNumber(n: string | null | undefined): boolean {
  if (!n) return true // null/empty is itself "no real number"
  return /^(UPLOAD|EMAIL)-\d+$/.test(n.trim())
}

/**
 * Normalize a vendor name for use as a dedup anchor: trim, lowercase, collapse
 * whitespace. NOT a full alias map (that's BRIDGE-ALIAS) — just formatting
 * normalization so "Atapack  B.V." and "atapack b.v." match.
 */
export function normalizeVendor(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Is the vendor name reliable enough to anchor a fallback dedup key?
 * Rejects empty and the known "unknown sender" placeholders. A junk vendor
 * must NOT be used as a key — matching on vendor+total+date with a junk vendor
 * (or worse, total+date alone) could wrongly block a LEGITIMATE invoice, which
 * in a financial-truth system is its own serious error (a missing crediteur).
 */
export function isReliableVendor(v: string | null | undefined): boolean {
  const n = normalizeVendor(v)
  if (n.length < 2) return false
  const junk = new Set(['onbekende afzender', 'onbekend', 'unknown', '-', '—'])
  return !junk.has(n)
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFECORE Rule 2 — shared semantic-duplicate detection (graded key)
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the SAME graded logic the email path runs inline (BOEK-SAFECORE Rule 2
// + SAFECORE-GAP), extracted so OTHER ingestion paths (the /api/intake camera +
// file path) catch the same "same invoice, different file" duplicate. Without
// this, byte-hash alone misses a re-photographed / re-generated invoice → the
// same invoice enters twice → double-pay risk.
//
// The decision logic is pure; the DB read is injected as `findMatch` so this
// module stays dependency-free (no Supabase import). The caller passes a small
// query function. Returns the matched original (block) or null (allow).

export interface SemanticDedupInput {
  invoiceNumber: string | null | undefined
  vendor: string | null | undefined       // client_name on an incoming invoice
  totalIncBtw: number | null | undefined
  invoiceDate: string | null | undefined  // ISO or DD-MM; we re-derive ISO
}

export interface SemanticDedupMatch {
  id: string
  invoice_number: string | null
  client_name: string | null
}

/** Anchor used for the match — for audit/telemetry. */
export type DedupTierKind = 'number' | 'vendor' | 'none'

export interface SemanticDedupQuery {
  // tier: 'number' → match on invoice_number + total (+ date). 'vendor' → match
  // on vendor(client_name, case-insensitive) + total + date. The caller runs the
  // scoped DB query (receiver_id + direction='incoming') and returns the first
  // match or null.
  tier: 'number' | 'vendor'
  total: number
  invoiceNumber?: string
  vendor?: string
  dateIso?: string | null
}

export interface SemanticDedupResult {
  duplicate: boolean
  tier: DedupTierKind
  match?: SemanticDedupMatch
  // when tier='none' — recorded for the audit trail; the invoice is NOT blocked
  // (too loose to safely block), it is allowed through for human review.
  undedupableReason?: string
}

/**
 * Decide-then-query semantic duplicate check, mirroring the email path exactly:
 *   1. real invoice number → key = number + total (+ date)
 *   2. placeholder/empty number + reliable vendor → key = vendor + total + date
 *   3. placeholder/empty number + unreliable vendor → un-dedupable (allow, log)
 *
 * `findMatch` performs the scoped DB read for a given tier and returns the first
 * matching original (or null). Kept injectable so safecore stays I/O-free.
 */
export async function findSemanticDuplicate(
  input: SemanticDedupInput,
  findMatch: (q: SemanticDedupQuery) => Promise<SemanticDedupMatch | null>
): Promise<SemanticDedupResult> {
  // No usable total → cannot form any safe key. Allow (human reviews).
  if (typeof input.totalIncBtw !== 'number' || !Number.isFinite(input.totalIncBtw)) {
    return { duplicate: false, tier: 'none', undedupableReason: 'geen bruikbaar totaalbedrag' }
  }

  const numberIsReal = !isPlaceholderInvoiceNumber(input.invoiceNumber)

  const hasRealDate =
    typeof input.invoiceDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input.invoiceDate)
  const dateIso = hasRealDate
    ? new Date(input.invoiceDate as string).toISOString().split('T')[0]
    : null

  if (numberIsReal) {
    const match = await findMatch({
      tier: 'number',
      total: input.totalIncBtw,
      invoiceNumber: (input.invoiceNumber as string).trim(),
      dateIso,
    })
    return match
      ? { duplicate: true, tier: 'number', match }
      : { duplicate: false, tier: 'number' }
  }

  if (isReliableVendor(input.vendor)) {
    const match = await findMatch({
      tier: 'vendor',
      total: input.totalIncBtw,
      vendor: (input.vendor as string).trim(),
      dateIso,
    })
    return match
      ? { duplicate: true, tier: 'vendor', match }
      : { duplicate: false, tier: 'vendor' }
  }

  // No real number AND no reliable vendor → total+date alone is too loose to
  // block safely (could reject a legitimate invoice = a missing crediteur).
  // Allow through; the caller logs it and the human reviews in the queue.
  return {
    duplicate: false,
    tier: 'none',
    undedupableReason:
      'geen betrouwbaar factuurnummer en geen betrouwbare afzender — duplicaatcontrole niet mogelijk',
  }
}