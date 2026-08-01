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

// [BTW-RIJM] Alleen om de MELDING bruikbaar te maken. Deze import verandert geen enkel oordeel:
// de poort hieronder vlagt precies dezelfde gevallen als voorheen, ze zegt er alleen bij welk van
// de drie bedragen de vreemde eend is. reconcile* rekent en schrijft niets.
import { reconcileBtw, reconcileHint, rateHint } from './btw-reconcile'

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
    const sumOk = Math.abs(ex + btw - incl) <= 0.02
    if (!sumOk) {
      flags.push('sum_mismatch')
      // [BREAKDOWN-MISSING] Distinguish "the split couldn't be READ" (both ex and BTW absent,
      // only the printed total came through — the common email case that showed a confusing
      // "excl + BTW ≠ totaal") from a genuine arithmetic contradiction (a split that IS present
      // but doesn't add up). Same flag, clearer owner-facing reason. The total is still the money;
      // the invoice is held either way until the human supplies the breakdown.
      const breakdownMissing = c.totalExBtw == null && c.btwAmount == null
      // [BTW-RIJM] "excl + BTW ≠ totaal" is waar en onbruikbaar: de ondernemer ziet drie getallen,
      // weet dat er één fout is, en mag zelf de pdf induiken om uit te zoeken welke. Terwijl de
      // rekensom dat vaak al kan aanwijzen — en waar zij dat niet kan, kan zij tenminste het
      // VERSCHIL noemen, dat op groothandelsfacturen meestal letterlijk de statiegeld- of
      // kratten-regel is. Zie btw-reconcile.ts: dat bestand rekent alleen, het repareert niets.
      const hint = breakdownMissing ? null : reconcileHint(reconcileBtw(ex, btw, incl))
      reasons.push(
        breakdownMissing
          ? 'de BTW-uitsplitsing (excl + BTW) ontbreekt — vul deze aan'
          : hint
            ? `excl + BTW ≠ totaal. ${hint}`
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
        // [BTW-RIJM] Een onmogelijk tarief betekent dat één van de twee bedragen niet klopt, en de
        // som kan hier niets aanwijzen: die klopt vaak gewoon (het echte geval: 26,00 + 13,42 =
        // 39,42, keurig, en toch alle drie fout). De BTW zelf wijst dan wél de weg — bij een bekend
        // tarief hoort er precies één grondslag bij. Zie btw-reconcile.ts.
        //
        // ALLEEN wanneer de som WEL klopt. Anders spreken de twee tips elkaar tegen: bij de
        // horecafactuur zei de somtip terecht "de BTW hoort € 405,90 te zijn", waarna deze tip
        // vrolijk verder rekende mét die € 995,90 en een grondslag van € 11.065,56 voorstelde —
        // redeneren vanuit het getal dat we net fout hadden verklaard. Klopt de som niet, dan is
        // die tip de baas en zwijgt deze.
        const rh = sumOk ? rateHint(btw, ex) : null
        reasons.push(rh ? `ongeldig BTW-tarief (${rate}%). ${rh}` : `ongeldig BTW-tarief (${rate}%)`)
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
    const sumOk = Math.abs(ex + btw - incl) <= 0.02
    if (!sumOk) {
      flags.push('sum_mismatch')
      // [BREAKDOWN-MISSING] Same clarification as the standard gate: an unreadable split
      // (both absent) reads clearer than a false "≠ totaal".
      const breakdownMissing = c.totalExBtw == null && c.btwAmount == null
      // [BTW-RIJM] "excl + BTW ≠ totaal" is waar en onbruikbaar: de ondernemer ziet drie getallen,
      // weet dat er één fout is, en mag zelf de pdf induiken om uit te zoeken welke. Terwijl de
      // rekensom dat vaak al kan aanwijzen — en waar zij dat niet kan, kan zij tenminste het
      // VERSCHIL noemen, dat op groothandelsfacturen meestal letterlijk de statiegeld- of
      // kratten-regel is. Zie btw-reconcile.ts: dat bestand rekent alleen, het repareert niets.
      const hint = breakdownMissing ? null : reconcileHint(reconcileBtw(ex, btw, incl))
      reasons.push(
        breakdownMissing
          ? 'de BTW-uitsplitsing (excl + BTW) ontbreekt — vul deze aan'
          : hint
            ? `excl + BTW ≠ totaal. ${hint}`
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
        // [BTW-RIJM] Een onmogelijk tarief betekent dat één van de twee bedragen niet klopt, en de
        // som kan hier niets aanwijzen: die klopt vaak gewoon (het echte geval: 26,00 + 13,42 =
        // 39,42, keurig, en toch alle drie fout). De BTW zelf wijst dan wél de weg — bij een bekend
        // tarief hoort er precies één grondslag bij. Zie btw-reconcile.ts.
        //
        // ALLEEN wanneer de som WEL klopt. Anders spreken de twee tips elkaar tegen: bij de
        // horecafactuur zei de somtip terecht "de BTW hoort € 405,90 te zijn", waarna deze tip
        // vrolijk verder rekende mét die € 995,90 en een grondslag van € 11.065,56 voorstelde —
        // redeneren vanuit het getal dat we net fout hadden verklaard. Klopt de som niet, dan is
        // die tip de baas en zwijgt deze.
        const rh = sumOk ? rateHint(btw, ex) : null
        reasons.push(rh ? `ongeldig BTW-tarief (${rate}%). ${rh}` : `ongeldig BTW-tarief (${rate}%)`)
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
  // Fold diacritics so "Café de Kroon" ≡ "Cafe de Kroon" — without this, an accent variant
  // between two reads made the two vendors look "provably different" and suppressed a real
  // duplicate flag (NFKD splits é into e + combining mark, which the range then strips).
  return (v ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
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

/**
 * [DEDUP-VENDOR-NORM] Kies uit een opgehaalde kandidatenlijst de rij die ECHT bij `q` hoort.
 *
 * De aanroeper haalt kandidaten op met een query die al vastzit op totaal (+ datum); deze functie
 * doet de laatste vergelijking. Dat die vergelijking hier staat en niet in de SQL is een bewuste
 * keuze, en ze is twee keer met schade betaald:
 *
 *  1. Het factuurnummer stond ooit als `.eq(...)` in de query. "26 / 3958" en "26/3958" zijn dan
 *     twee verschillende facturen, dus de dubbele boeking ging er gewoon langs.
 *  2. De leverancier stond als `.ilike(client_name, escapeLikeValue(...))`. Die escape dekt `%` en
 *     `_`, maar niet `*` — en PostgREST VERTAALT `*` naar `%` in like/ilike, in zijn eigen parser,
 *     nog voordat de waarde SQL bereikt. Een backslash helpt daar niet tegen; je kunt via ilike
 *     eenvoudigweg niet op een letterlijke `*` matchen. Dat is geen randgeval: kassabonnen dragen
 *     standaard de prefix van hun acquirer — "SUMUP *CAFE", "SQ *KAPSALON", "PAYPAL *ADOBE". Zo'n
 *     naam werd een patroon, en déze tier blokkeert: een willekeurige andere factuur met hetzelfde
 *     totaal en dezelfde datum kon een geldige upload weigeren. Een ten onrechte geweigerde factuur
 *     is precies wat hierboven bij isReliableVendor "een missende crediteur" heet — de zwaardere
 *     fout van de twee, want een dubbele ziet een mens nog in zijn lijst staan.
 *
 * Vandaar: de database levert een SUPERset, de regel staat in code, en beide velden gebruiken de
 * normalizer die deze module zelf al hanteert (dezelfde normalizeVendor waarmee isReliableVendor
 * bepaalt of deze tier überhaupt mag draaien).
 *
 * Zonder bruikbare sleutel is er GEEN match — nooit een terugval op "dan maar de eerste rij". Die
 * terugval stond er ooit en betekende blokkeren op totaal + datum alleen: precies de combinatie die
 * findSemanticDuplicate hieronder "te los om veilig te blokkeren" noemt.
 *
 * Puur en zonder I/O, zoals de rest van deze module.
 */
export function pickDedupMatch<T extends SemanticDedupMatch>(
  rows: readonly T[],
  q: SemanticDedupQuery
): T | null {
  const hit = rows.find((r) =>
    q.tier === 'number'
      ? !!q.invoiceNumber &&
        normalizeInvoiceNumber(r.invoice_number) === normalizeInvoiceNumber(q.invoiceNumber)
      : !!q.vendor && normalizeVendor(r.client_name) === normalizeVendor(q.vendor)
  )
  return hit ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFECORE Rule 2b — POSSIBLE (soft) duplicate signal
// ─────────────────────────────────────────────────────────────────────────────
//
// findSemanticDuplicate above is BINARY: a confident block (number/vendor+total+date
// tie) or nothing. But there is a middle ground it stays silent on — a re-arrival the
// hard key can't prove: same amount + same DATE but the number differs (OCR misread a
// digit) or the sender is unknown; or same amount + same vendor a few days apart. Those
// slipped through and DOUBLE-BOOKED the cost with no trace.
//
// This is NEVER a block — blocking on a loose signal would reject a legitimate invoice
// (a missing crediteur, its own serious error). Instead it is a SOFT flag: the invoice
// still imports, carrying "mogelijk dubbel met X" so the human eyeballs it in the verify
// queue. Never silently dropped (it imports), never silently accepted (it is flagged) —
// the human decides at exactly the point of maximum ambiguity. Pure; the caller fetches
// the same-total candidates and passes them in.

export interface PossibleDupCandidate {
  id: string
  invoice_number: string | null
  client_name: string | null
  invoice_date: string | null   // ISO as stored
  total_inc_btw: number | null
}

export interface PossibleDuplicate {
  match: SemanticDedupMatch
  reason: string // short Dutch, owner-facing (e.g. "zelfde bedrag en datum")
}

// A re-import usually arrives close to the original; a monthly RECURRING bill (same
// vendor + same amount) is ~a month apart. Keep the vendor-near-date window short so
// recurring invoices are NOT flagged as possible duplicates.
//
// [ABONNEMENT] Die redenering dekt MAANDELIJKS, en daar houdt ze op. Een leverancier die ELKE
// WEEK hetzelfde bedrag factureert valt met een tussenpoos van 7 dagen precies BINNEN dit venster,
// en werd dus elke week opnieuw als "mogelijk dubbel" gevlagd — met een ander factuurnummer erop.
// Dat is geen dubbele boeking, dat is een abonnement. Zie looksLikeRecurringSeries hieronder: het
// venster blijft 14 dagen (dat hek is goed), maar een aantoonbaar ritme mag eronder uit.
export const POSSIBLE_DUP_WINDOW_DAYS = 14

// [DEDUP-CORRECTED] How far apart two invoices sharing ONE number may sit before we stop reading
// them as a correction. Generous — a supplier can correct a bill the owner never noticed for
// weeks — but far below a year, because a yearly numbering restart ("001" in 2025 and in 2026) is
// the one legitimate way two different bills share a number, and that pair is ~365 days apart.
export const CORRECTED_REISSUE_WINDOW_DAYS = 180

// [ABONNEMENT] Hoeveel EERDERE facturen van dezelfde leverancier met hetzelfde bedrag er moeten
// zijn voordat we van een ritme spreken. Drie, dus met de nieuwe erbij vier momenten en drie
// tussenpozen. Een eerste per ongeluk dubbel verstuurde factuur wordt hierdoor NOOIT onderdrukt:
// daarvoor is er simpelweg geen reeks.
const RECURRING_MIN_PRIORS = 3

// Een reeks met tussenpozen van één of twee dagen is geen factureerritme maar een uitbarsting
// (iemand die zijn mailbox leegtrekt, een leverancier die drie keer hetzelfde stuurt).
const RECURRING_MIN_GAP_DAYS = 3

/**
 * [ABONNEMENT] Factureert deze leverancier hetzelfde bedrag op een AANTOONBAAR ritme, met steeds
 * een ANDER factuurnummer? Dan is een nieuwe factuur op de verwachte tussenpoos geen duplicaat maar
 * de volgende termijn — en die hoort niet in de controlewachtrij te belanden met "mogelijk dubbel".
 *
 * Onderdrukken is de GEVAARLIJKE richting (een echte dubbele boeking zou erdoorheen glippen), dus
 * elk hek hieronder staat streng:
 *   1. De nieuwe factuur heeft een ECHT nummer (geen placeholder) dat in de reeks nog niet voorkomt.
 *      Zonder eigen nummer kunnen we niet zeggen dat het een ander stuk is.
 *   2. Minstens drie eerdere facturen, allemaal met een eigen, ONDERLING VERSCHILLEND nummer.
 *      Herhaalde nummers betekenen juist dat er iets dubbel is.
 *   3. Alle tussenpozen — inclusief die van de nieuwe factuur — liggen dicht bij de mediaan.
 *   4. Het ritme is minstens drie dagen. Een burst is geen abonnement.
 *
 * Puur; `priors` zijn de kandidaten die al op leverancier + bedrag zijn gefilterd.
 */
function looksLikeRecurringSeries(
  newDateIso: string | null,
  newNumberKey: string,
  priors: { dateIso: string | null; numberKey: string }[],
): boolean {
  if (!newDateIso || !newNumberKey) return false // hek 1

  // Alleen priors met een echte datum én een echt nummer dragen bewijs.
  const usable = priors.filter((p) => p.dateIso !== null && p.numberKey !== '')
  if (usable.length < RECURRING_MIN_PRIORS) return false // hek 2

  const numbers = new Set(usable.map((p) => p.numberKey))
  if (numbers.size !== usable.length) return false // een nummer komt dubbel voor → geen reeks
  if (numbers.has(newNumberKey)) return false // de nieuwe deelt een nummer → nooit onderdrukken

  // Alle momenten op één rij, oplopend. Ontdubbeld: twee facturen op dezelfde dag zijn één moment
  // en zouden als tussenpoos van nul dagen de mediaan omlaag trekken.
  const days = Array.from(
    new Set([...usable.map((p) => Date.parse(p.dateIso as string)), Date.parse(newDateIso)])
  )
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)
  if (days.length < RECURRING_MIN_PRIORS + 1) return false

  const gaps: number[] = []
  for (let i = 1; i < days.length; i++) gaps.push(Math.round((days[i] - days[i - 1]) / 86_400_000))
  if (gaps.some((g) => g < RECURRING_MIN_GAP_DAYS)) return false // hek 4

  const sorted = [...gaps].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  if (median < RECURRING_MIN_GAP_DAYS) return false

  // Hek 3 — elke tussenpoos dicht bij de mediaan. Ruim genoeg voor een factuur die van vrijdag
  // naar maandag schuift, streng genoeg om een willekeurige verzameling eruit te houden.
  const slack = Math.max(2, median * 0.35)
  return gaps.every((g) => Math.abs(g - median) <= slack)
}

// Legal-suffix noise stripped for a format-insensitive vendor comparison (mirrors
// supplier-registry / email-integration vendorCoreKey — kept local so safecore stays
// dependency-free and never imports the email layer).
const VENDOR_CORE_NOISE = new Set(['bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'bvba', 'holding', 'maatschap', 'inc', 'llc'])
function vendorCore(v: string | null | undefined): string {
  return normalizeVendor(v)
    .replace(/\./g, '')            // collapse dotted acronyms first: "b.v." → "bv"
    .replace(/[^a-z0-9\s]/g, ' ')  // other punctuation → separator
    .split(/\s+/)
    .filter((t) => t.length > 0 && !VENDOR_CORE_NOISE.has(t))
    .join(' ')
}

function isoDay(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? normalizeToIso(raw) : null
}
function daysApart(aIso: string, bIso: string): number | null {
  const a = Date.parse(aIso), b = Date.parse(bIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.abs(a - b) / 86_400_000
}

/**
 * Assess whether this invoice is a POSSIBLE (not confident) duplicate of one already in
 * the system, given the candidates the caller fetched. Returns the best soft match
 * + a short reason, or null. Pure. Signals, strongest first:
 *   • same total + same DATE + same vendor
 *   • same total + same DATE (vendor not provably different)
 *   • same total + same VENDOR within POSSIBLE_DUP_WINDOW_DAYS (a near-date re-import)
 *   • [DEDUP-CORRECTED] same invoice NUMBER, DIFFERENT total — a corrected re-issue
 * A provably-different reliable vendor is never a duplicate (a coincidental same-amount
 * same-day bill from another supplier), and an exact invoice-number match is a HARD
 * duplicate handled by findSemanticDuplicate, so it is skipped here.
 */
export function assessPossibleDuplicate(
  input: SemanticDedupInput,
  candidates: PossibleDupCandidate[],
): PossibleDuplicate | null {
  if (typeof input.totalIncBtw !== 'number' || !Number.isFinite(input.totalIncBtw)) return null
  const totalCents = Math.round(input.totalIncBtw * 100)
  const inDate = isoDay(input.invoiceDate)
  const inVendorReliable = isReliableVendor(input.vendor)
  const inCore = inVendorReliable ? vendorCore(input.vendor) : ''
  const inNum = normalizeInvoiceNumber(input.invoiceNumber)

  // [ABONNEMENT] Eén keer vooraf, niet per kandidaat: factureert deze leverancier hetzelfde bedrag
  // op een ritme? De reeks bestaat uit ALLE kandidaten met dit bedrag én deze leverancier, dus die
  // vraag is niet te beantwoorden binnen de lus die er één tegelijk bekijkt.
  const recurringSeries = inNum
    ? looksLikeRecurringSeries(
        inDate,
        inNum,
        candidates
          .filter((c) => {
            if (typeof c.total_inc_btw !== 'number' || Math.round(c.total_inc_btw * 100) !== totalCents) return false
            // Dezelfde leverancier, en dat moet aan BEIDE kanten betrouwbaar vast te stellen zijn —
            // anders zou een reeks van een andere leverancier het bewijs kunnen leveren.
            return inVendorReliable && isReliableVendor(c.client_name) && vendorCore(c.client_name) === inCore && inCore !== ''
          })
          .map((c) => ({ dateIso: isoDay(c.invoice_date), numberKey: normalizeInvoiceNumber(c.invoice_number) })),
      )
    : false

  // [DEDUP-CORRECTED] Is our own number a REAL one? A placeholder ("UPLOAD-17") is minted per
  // import and can never legitimately repeat, so it must not anchor the corrected-re-issue tier.
  const inNumIsReal = inNum !== '' && !isPlaceholderInvoiceNumber(input.invoiceNumber)

  let best: PossibleDuplicate | null = null
  let bestRank = 0
  for (const c of candidates) {
    if (typeof c.total_inc_btw !== 'number' || Math.round(c.total_inc_btw * 100) !== totalCents) {
      // [DEDUP-CORRECTED] The one signal that is NOT anchored on the amount — and the only reason
      // this branch exists at all. A supplier who invoices the wrong amount and then re-sends the
      // SAME invoice number with the corrected total slips through EVERY other gate in this file:
      // the hard key (findSemanticDuplicate) matches number + total, and every soft tier above
      // starts by requiring cent-equal totals. So both copies imported, both counted as cost, both
      // claimed voorbelasting — and the owner discovered it only when a payment had already landed
      // on the wrong one. An invoice number is unique per supplier by construction: seeing it twice
      // with two different amounts is a correction, a credit, or a re-issue — never two bills.
      //
      // It is a FLAG, never a block, like every tier here: a supplier whose number our OCR
      // shortened to something collision-prone would otherwise have a legitimate invoice
      // rejected. The human decides in the verify queue.
      if (!inNumIsReal) continue
      if (normalizeInvoiceNumber(c.invoice_number) !== inNum) continue
      // Provably a DIFFERENT supplier that happens to reuse the number → not the same document.
      // (Numbers are unique per supplier, not across them.)
      if (
        inVendorReliable &&
        isReliableVendor(c.client_name) &&
        vendorCore(c.client_name) !== '' &&
        vendorCore(c.client_name) !== inCore
      ) {
        continue
      }
      // [DEDUP-CORRECTED] A supplier who RESTARTS numbering each year is the one honest way for
      // two different bills to share a number: "001" in 2025 and "001" in 2026. Those sit ~a year
      // apart, and a correction never does — it follows the invoice it corrects within days or
      // weeks. So the tier is bounded in time, well below a year. Without this fence, a yearly
      // restart would put a legitimate invoice in the verify queue every single January, and a
      // warning that cries wolf is one the owner learns to tap past.
      // A MISSING date on either side cannot be fenced, and there we keep the flag: a same-number
      // pair from one supplier is worth a glance, and an invoice we could not read a date off
      // needs a human anyway.
      {
        const cDateForGap = isoDay(c.invoice_date)
        const gapDays = inDate && cDateForGap ? daysApart(inDate, cDateForGap) : null
        if (gapDays != null && gapDays > CORRECTED_REISSUE_WINDOW_DAYS) continue
      }
      if (bestRank < 1) {
        bestRank = 1
        best = {
          match: { id: c.id, invoice_number: c.invoice_number, client_name: c.client_name },
          reason: 'zelfde factuurnummer, ander bedrag — mogelijk een gecorrigeerde versie',
        }
      }
      continue
    }

    const cVendorReliable = isReliableVendor(c.client_name)
    const cCore = cVendorReliable ? vendorCore(c.client_name) : ''
    const bothVendorsReliable = inVendorReliable && cVendorReliable && inCore !== '' && cCore !== ''
    if (bothVendorsReliable && inCore !== cCore) continue // provably a different supplier → not a dup
    const sameVendor = bothVendorsReliable && inCore === cCore

    const cDate = isoDay(c.invoice_date)
    const sameDate = !!(inDate && cDate && inDate === cDate)
    const gap = inDate && cDate ? daysApart(inDate, cDate) : null
    const nearDate = gap != null && gap > 0 && gap <= POSSIBLE_DUP_WINDOW_DAYS
    const sameNumber = !!(inNum && normalizeInvoiceNumber(c.invoice_number) === inNum)

    // The hard gate (findSemanticDuplicate) matches the total with EXACT float equality; this soft
    // detector matches on cent-rounded equality. So a sub-cent total drift (100.004 vs 100.00, both
    // one cent) is CENT-equal here but the hard gate's exact .eq misses it. Only treat a same-number
    // pair as "already hard-blocked" when the totals are exactly equal — otherwise the hard gate
    // could not have caught it and we must flag it, or it double-books silently.
    const exactSameTotal = c.total_inc_btw === input.totalIncBtw
    let rank = 0, reason = ''
    if (sameNumber && sameDate && exactSameTotal) {
      // Same number + EXACT total + date IS a hard duplicate (findSemanticDuplicate blocks it before
      // we run) — don't downgrade it to a mere "possible". Skip.
      continue
    } else if (sameNumber) {
      // [DEDUP-SOFT-CRITICAL] Same invoice number + (cent-)equal total, but the hard number-tier key
      // missed it — because the DATE drifted (OCR misread / null date), OR the total is only cent-
      // equal not exactly equal (sub-cent float the hard exact-.eq can't match). Either way it would
      // otherwise import + auto-book a SECOND cost silently. A per-vendor number repeating with the
      // same amount is all but certainly the same bill → flag it (strongest signal).
      rank = 5
      reason = sameDate ? 'zelfde factuurnummer en bedrag' : 'zelfde factuurnummer en bedrag, andere datum'
    }
    else if (sameDate && sameVendor) { rank = 4; reason = 'zelfde bedrag, datum en afzender' }
    else if (sameDate) { rank = 3; reason = 'zelfde bedrag en datum' }
    else if (sameVendor && nearDate) {
      // [ABONNEMENT] Dit is de enige rang die een terugkerende factuur raakt: zelfde leverancier,
      // zelfde bedrag, datum dichtbij — maar met een ANDER factuurnummer. Bij een aantoonbaar ritme
      // is dat de volgende termijn, geen dubbele boeking, en dan hoort er geen vlag op.
      //
      // Alleen HIER onderdrukken. Rang 4 (zelfde DATUM én leverancier) blijft staan: een
      // weekabonnement factureert niet twee keer op dezelfde dag, dus dat is nog steeds een echt
      // signaal. En rang 5 (zelfde factuurnummer) al helemaal — dat is per definitie hetzelfde stuk.
      if (recurringSeries) continue
      rank = 2
      reason = 'zelfde bedrag en afzender, datum dichtbij'
    }
    else continue

    if (rank > bestRank) {
      bestRank = rank
      best = { match: { id: c.id, invoice_number: c.invoice_number, client_name: c.client_name }, reason }
    }
  }
  return best
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