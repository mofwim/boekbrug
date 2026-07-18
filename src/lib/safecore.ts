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
/**
 * [BRIDGE-CREDITNOTA-SIGN] Options for the arithmetic gate.
 * `isCreditNote` routes to the creditnota branch, where amounts must be
 * NEGATIVE and consistent. Optional — every existing call site keeps its
 * exact current behaviour (additive, never permissive).
 */
export interface ArithmeticOptions {
  isCreditNote?: boolean
}

export function evaluateArithmetic(
  c: ArithmeticInput,
  opts?: ArithmeticOptions
): ArithmeticVerdict {
  // [BRIDGE-CREDITNOTA-SIGN] Creditnota → its own explicit branch. The standard
  // path below is UNCHANGED (additive, not permissive): we never relax the
  // positive-amount guards for normal invoices; a creditnota simply takes a
  // parallel gate where the sign expectation is inverted.
  if (opts?.isCreditNote === true) {
    return evaluateCreditnotaArithmetic(c)
  }

  const flags: string[] = []
  const reasons: string[] = []

  const ex = c.totalExBtw ?? 0
  const btw = c.btwAmount ?? 0
  const incl = c.totalIncBtw ?? c.amount ?? 0

  // ── Structural: impossible numbers ──
  const finiteNonNeg = (v: number) => Number.isFinite(v) && v >= 0
  if (!finiteNonNeg(ex) || !finiteNonNeg(btw) || !finiteNonNeg(incl)) {
    flags.push('non_finite_or_negative')
    // [BRIDGE-CREDITNOTA-SIGN] Smarter reason: when the numbers are FINITE but
    // negative, the document is very likely a creditnota that the AI labelled
    // as a normal invoice. Hint the owner instead of a generic error, so the
    // verify queue tells them WHAT to fix. Flag unchanged (consumers keep
    // matching 'non_finite_or_negative'); only the human-readable reason improves.
    const allFinite =
      Number.isFinite(ex) && Number.isFinite(btw) && Number.isFinite(incl)
    const anyNegative = ex < 0 || btw < 0 || incl < 0
    reasons.push(
      allFinite && anyNegative
        ? 'bedragen zijn negatief — is dit een creditnota?'
        : 'ongeldige bedragen (NaN/∞/negatief)'
    )
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
      // [BREAKDOWN-MISSING] Distinguish "the split couldn't be READ" (both ex and BTW absent,
      // only the printed total came through — the common email case that showed a confusing
      // "excl + BTW ≠ totaal") from a genuine arithmetic contradiction (a split that IS present
      // but doesn't add up). Same flag, clearer owner-facing reason. The total is still the money;
      // the invoice is held either way until the human supplies the breakdown.
      const breakdownMissing = c.totalExBtw == null && c.btwAmount == null
      reasons.push(
        breakdownMissing
          ? 'de BTW-uitsplitsing (excl + BTW) ontbreekt — vul deze aan'
          : 'excl + BTW ≠ totaal'
      )
    }
    // Legal BTW rate: computed (btw_rate is NOT stored). Guard division by zero;
    // when ex=0 we can't derive a rate, so we skip the rate check (the sum check
    // above already covers ex=0 cases meaningfully).
    if (ex > 0) {
      const rate = Math.round((btw / ex) * 100)
      // [BTW-MIXED-RATE] Any rate between 0 and 21 can be a legal blend of NL
      // rates (0/9/21) — a food invoice mixing 9% and 21% blends to a value
      // between them (e.g. 11%), which is valid. Only a rate below 0 or above
      // 21 is truly impossible (no NL rate exceeds 21, so no blend can either).
      if (rate < 0 || rate > 21) {
        flags.push('illegal_btw_rate')
        reasons.push(`ongeldig BTW-tarief (${rate}%)`)
      }
    }
  }

  if (flags.length === 0) return { ok: true }
  return { ok: false, reason: reasons.join('; '), flags }
}

/**
 * [BRIDGE-CREDITNOTA-SIGN] Arithmetic gate for a CREDITNOTA / NET-CREDIT document.
 *
 * The one hard rule is a NEGATIVE net total (they owe you). Everything else is consistency:
 *   Structural → blocked:
 *     - any of ex/btw/incl is NaN or ±Infinity
 *     - incl >= 0 (a credit with no negative total is not bookable)
 *     - invoice year outside 2020–2030 (same business range)
 *   Consistency (internally wrong) → blocked:
 *     - |ex + btw − incl| > 0.02 (the sum identity, sign-agnostic on ex/BTW)
 *     - |btw / ex| ∉ [0..21] (a legal blended NL rate)
 *
 * [NET-CREDIT] The individual signs of ex and BTW are deliberately NOT constrained. A pure
 * creditnota has all three negative; a NET-CREDIT invoice (returns/emballage exceed goods) can
 * have a POSITIVE BTW on its goods while 0%-BTW container returns drive the net excl/total
 * negative (real Altena case: ex -123, BTW +13,42, totaal -109,58). The identity + rate catch the
 * genuinely-broken reads; the mixed signs are legitimate. btw = 0 is allowed (a 0%-BTW credit).
 */
function evaluateCreditnotaArithmetic(c: ArithmeticInput): ArithmeticVerdict {
  const flags: string[] = []
  const reasons: string[] = []

  const ex = c.totalExBtw ?? 0
  const btw = c.btwAmount ?? 0
  const incl = c.totalIncBtw ?? c.amount ?? 0

  // ── Structural: amounts must be finite ──
  const allFinite = Number.isFinite(ex) && Number.isFinite(btw) && Number.isFinite(incl)
  if (!allFinite) {
    flags.push('non_finite')
    reasons.push('ongeldige bedragen (NaN/∞)')
  }

  // [NET-CREDIT] The defining invariant of a creditnota / net-credit document is that the TOTAL is
  // strictly negative (they owe YOU). The individual ex/BTW signs are NOT constrained: a net-credit
  // invoice can carry POSITIVE BTW on its goods lines while 0%-BTW emballage/statiegeld RETURNS
  // drive the net excl (and the total) negative — the real Altena case (ex -123, BTW +13,42,
  // totaal -109,58, and -123 + 13,42 = -109,58 holds). Forcing every amount ≤ 0 (the old rule)
  // falsely flagged such a correctly-read invoice "bedragen moeten negatief zijn". The identity
  // (excl + BTW = totaal) and a legal blended rate are what actually guarantee correctness.
  if (Number.isFinite(incl) && incl >= 0) {
    flags.push('non_negative_creditnota_total')
    reasons.push('totaalbedrag van creditnota ontbreekt of is 0')
  }

  // ── Structural: date sanity (same 2020–2030 range as the standard path) ──
  if (typeof c.invoiceDate === 'string' && c.invoiceDate.trim()) {
    const d = new Date(c.invoiceDate)
    const year = d.getFullYear()
    if (Number.isNaN(d.getTime()) || year < 2020 || year > 2030) {
      flags.push('date_out_of_range')
      reasons.push('factuurdatum buiten geldig bereik (2020–2030)')
    }
  }

  // ── Consistency: sign-agnostic on ex/BTW, only the net total must be negative. ──
  if (allFinite && incl < 0) {
    // excl + BTW must equal incl — the identity holds regardless of the individual signs.
    if (Math.abs(ex + btw - incl) > 0.02) {
      flags.push('sum_mismatch')
      // [BREAKDOWN-MISSING] Same clarification as the standard gate: an unreadable split
      // (both absent) reads clearer than a false "≠ totaal".
      const breakdownMissing = c.totalExBtw == null && c.btwAmount == null
      reasons.push(
        breakdownMissing
          ? 'de BTW-uitsplitsing (excl + BTW) ontbreekt — vul deze aan'
          : 'excl + BTW ≠ totaal'
      )
    }
    // Legal blended NL rate: |BTW / excl| ∈ [0..21]. The full-ratio abs() covers a mixed-sign
    // net-credit (positive goods-BTW over a negative net excl gives a negative raw ratio that is
    // still a valid magnitude), while a pure all-negative creditnota (neg ÷ neg) is unchanged.
    if (Math.abs(ex) > 0.005) {
      const rate = Math.round(Math.abs(btw / ex) * 100)
      if (rate > 21) {
        flags.push('illegal_btw_rate')
        reasons.push(`ongeldig BTW-tarief (${rate}%)`)
      }
    } else if (Math.abs(btw) > 0.02) {
      // [NO-BASE] A non-trivial BTW on an essentially-ZERO base is physically impossible (implied
      // rate → ∞) — a mis-read. The old all-≤0 structural rule caught this by accident; keep it
      // caught now that the rate check self-disables for a near-zero base.
      flags.push('illegal_btw_rate')
      reasons.push('BTW zonder grondslag — controleer de bedragen')
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
 * Prefix-agnostic across ALL ingestion paths (UPLOAD-/EMAIL-/CAMERA- + timestamp).
 * [AUTO-ADVANCE] CAMERA- was missing here, so a photographed invoice with no readable
 * number read "clean" with a fabricated number — which would let it auto-book. Adding it
 * keeps such an invoice in the verify queue (needs a real number before it counts).
 */
export function isPlaceholderInvoiceNumber(n: string | null | undefined): boolean {
  if (!n) return true // null/empty is itself "no real number"
  return /^(UPLOAD|EMAIL|CAMERA)-\d+$/.test(n.trim())
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
/**
 * [DEDUP-NUMBER-NORM] Normalize an invoice number for DUPLICATE comparison only (never
 * for storage/display). Collapses whitespace and lowercases, so a re-generated PDF whose
 * number renders as "26 / 3958" is recognized as the already-imported "26/3958" — the
 * exact-string `.eq` missed this and inserted the bill twice (double cost, phantom
 * voorbelasting). Punctuation is kept (a "/" vs "-" separator may be a real difference),
 * so this only folds spacing, never merges genuinely different numbers.
 */
export function normalizeInvoiceNumber(n: string | null | undefined): string {
  return (n ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

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
    ? normalizeToIso(input.invoiceDate as string)
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
// ─────────────────────────────────────────────────────────────────────────────
// [EXTRACT-DUE-DATE] Shared due-date derivation (pure, no I/O)
// ─────────────────────────────────────────────────────────────────────────────
//
// due_date is the backbone of the "Vandaag" screen and every future reminder.
// Both ingestion paths (intake camera/file + email) must fill it identically,
// so the priority logic lives HERE in ONE place — never duplicated (the lesson
// from the reference-extraction duplication we paid for once).
//
// The AI extractor (ai.ts) returns TWO separate raw signals — it never computes
// the date itself (arithmetic stays in our code, per SAFECORE):
//   - dueDateRaw   : an EXPLICIT "Vervaldatum: 27-05-2026" if the invoice states one
//   - termDays     : a payment TERM ("Betaling binnen 14 dagen") as a number of days
//
// Priority (truth over invention):
//   1. explicit valid due date            → use it (normalized to ISO YYYY-MM-DD)
//   2. else invoice_date + termDays        → compute it
//   3. else                                → null (NEVER invent a date; an
//      invoice without a stated term simply has no due_date, and that is honest.
//      A fabricated 30-day default would wrongly show invoices as "overdue".)

/**
 * Derive an invoice's due_date from the AI's raw signals.
 *
 * @param invoiceDateIso  the already-normalized invoice date, ISO "YYYY-MM-DD"
 *                        (both paths compute this before insert) — or null.
 * @param dueDateRaw      explicit due date from the invoice, any of ISO
 *                        "YYYY-MM-DD" or "DD-MM-YYYY", or null/undefined.
 * @param termDays        payment term in days ("binnen X dagen"), or null/undefined.
 * @returns ISO "YYYY-MM-DD" due date, or null when nothing reliable is known.
 */
export function deriveDueDate(
  invoiceDateIso: string | null | undefined,
  dueDateRaw: string | null | undefined,
  termDays: number | null | undefined
): string | null {
  // 1. Explicit due date wins — normalize whatever shape the AI returned.
  const explicit = normalizeToIso(dueDateRaw)
  if (explicit) return explicit

  // 2. Compute from invoice_date + term when both are usable.
  const baseIso = normalizeToIso(invoiceDateIso)
  if (
    baseIso &&
    typeof termDays === 'number' &&
    Number.isFinite(termDays) &&
    termDays > 0 &&
    termDays <= 365 // sanity: a payment term beyond a year is not a real term
  ) {
    const base = new Date(`${baseIso}T00:00:00Z`)
    if (!Number.isNaN(base.getTime())) {
      base.setUTCDate(base.getUTCDate() + Math.round(termDays))
      return base.toISOString().split('T')[0]
    }
  }

  // 3. Nothing reliable → no due date. Honesty over a fabricated default.
  return null
}

/**
 * Normalize a date string to ISO "YYYY-MM-DD", accepting either ISO
 * ("2026-05-27", optionally with a time part) or Dutch "DD-MM-YYYY"
 * ("27-05-2026"). Returns null for empty/unparseable input. Pure.
 */
// [DATE-ISO-SAFE / I6] Tolerant date→ISO for STORAGE. The write paths used
// `new Date(x).toISOString()`, which THROWS on a Dutch "15-05-2026" (Invalid Date). In
// the email loop that throw is caught as a per-message error, the watermark is held, and
// the same invoice is re-fetched and re-thrown every sync forever — never imported, never
// surfaced (and re-billed each run). This returns null instead of throwing, so a mis-shaped
// date simply becomes "no date" (the verify queue then asks the human), never a stuck loop.
export function normalizeToIso(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null

  // ISO "YYYY-MM-DD" (optionally followed by time) → take the date part.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, y, m, d] = iso
    return isValidYmd(+y, +m, +d) ? `${y}-${m}-${d}` : null
  }

  // Dutch "DD-MM-YYYY" (also tolerant of "/" or "." separators).
  const nl = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (nl) {
    const d = +nl[1]
    const m = +nl[2]
    const y = +nl[3]
    if (!isValidYmd(y, m, d)) return null
    const mm = String(m).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    return `${y}-${mm}-${dd}`
  }

  return null
}

/** Calendar sanity for a Y/M/D triple (no Date roll-over surprises). */
function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 2020 || y > 2030) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  )
}