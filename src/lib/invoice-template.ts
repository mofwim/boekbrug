// src/lib/invoice-template.ts
// [FACTUUR-B] Invoice-number template extraction + formatting — June 2026
// =====================================================================
// Pure, dependency-free, safe on BOTH client and server. The onboarding
// wizard uses it for the live "your first number will be..." confirmation;
// the server (POST /api/invoice/numbering) re-runs it as the AUTHORITATIVE
// parse (never trust the client). invoice-numbering.ts imports the formatter
// so there is a SINGLE source of truth for how {seq}/{year} render.
//
// THE MODEL (decided with M): the customer types the number they want on
// their FIRST real invoice. We extract a TEMPLATE from it — we never ask for
// prefix / padding / year separately.
//
// EXTRACTION RULES (A/B/C, confirmed):
//   A. year vs counter:
//      - a numeric run is a YEAR only if it is exactly 4 digits in 1900-2099
//        AND it is NOT the only numeric run in the string.
//      - the COUNTER is the (single) numeric run that is not the year.
//      - a SOLE numeric run is ALWAYS the counter, even if it looks like a
//        year (so "2024" alone => counter 2024, continuous).
//   B. literal prefixes / separators: everything that is neither the counter
//      nor the year is kept verbatim in the template (so "INV-045-2026" =>
//      "INV-{seq}-{year}", "F2026-045" => "F{year}-{seq}").
//   C. the stored template uses a {year} TOKEN, never the literal year, so a
//      yearly-reset series rolls to "001-2027" next January. The typed year
//      is used only to seed the current-year counter context (done server-side).
//
//   AMBIGUITY GUARD (safety over guessing — this is legal numbering): reject
//   (ask the customer to simplify) when:
//      - there is no numeric run at all,
//      - two or more numeric runs look like a year (e.g. "2026-2024"),
//      - two or more non-year numeric runs exist (e.g. "12-045", "12-045-2026")
//        -- which one is the counter is genuinely unclear.
//
//   Yearly reset is DERIVED: a template containing {year} resets yearly;
//   without {year} it is continuous (no reset).
//
// Worked cases:
//   "045-2026"     -> {seq}-{year}      seq 45     pad 3  reset
//   "2026-045"     -> {year}-{seq}      seq 45     pad 3  reset
//   "045/2026"     -> {seq}/{year}      seq 45     pad 3  reset
//   "INV-045-2026" -> INV-{seq}-{year}  seq 45     pad 3  reset
//   "F2026-045"    -> F{year}-{seq}     seq 45     pad 3  reset
//   "2764283"      -> {seq}             seq 2764283 pad 7 continuous
//   "2024"         -> {seq}             seq 2024   pad 4  continuous
//   "2026-2024"    -> reject (ambiguous_year)
//   "12-045-2026"  -> reject (ambiguous_counter)
//   ""             -> reject (empty)  == caller defaults to 001-{year}
// =====================================================================

const YEAR_MIN = 1900
const YEAR_MAX = 2099
const SEQ_MIN = 1
const SEQ_MAX = 2_000_000_000 // safe within Postgres int4 (invoice_counters.last_seq)
const MAX_INPUT_LEN = 64

export type ExtractReason =
  | 'empty'             // nothing typed -> caller treats as "start at 1" default
  | 'no_counter'        // no digits at all
  | 'too_long'          // absurdly long input
  | 'ambiguous_year'    // >= 2 year-looking runs (e.g. "2026-2024")
  | 'ambiguous_counter' // >= 2 non-year numeric runs (e.g. "12-045")
  | 'out_of_range'      // counter < 1 or too large for int4

export interface ExtractOk {
  ok: true
  template: string    // e.g. "{seq}-{year}", "{year}-{seq}", "{seq}", "INV-{seq}-{year}"
  padding: number     // digit width of the counter as typed ("045" => 3)
  startSeq: number    // value the FIRST invoice should carry (45, 2764283, ...)
  yearlyReset: boolean
}
export interface ExtractErr {
  ok: false
  reason: ExtractReason
}
export type ExtractResult = ExtractOk | ExtractErr

interface Tok { kind: 'num' | 'lit'; text: string }

function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  const re = /(\d+)|(\D+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    toks.push(m[1] !== undefined ? { kind: 'num', text: m[1] } : { kind: 'lit', text: m[2] })
  }
  return toks
}

function isYearLike(text: string): boolean {
  if (text.length !== 4) return false
  const v = parseInt(text, 10)
  return v >= YEAR_MIN && v <= YEAR_MAX
}

/**
 * Extracts a numbering template from the number the customer wants on their
 * FIRST invoice. See the file header for the exact rules.
 */
export function extractInvoiceTemplate(raw: string): ExtractResult {
  const input = (raw ?? '').trim()
  if (input === '') return { ok: false, reason: 'empty' }
  if (input.length > MAX_INPUT_LEN) return { ok: false, reason: 'too_long' }

  const toks = tokenize(input)
  const numIdx = toks.map((t, i) => (t.kind === 'num' ? i : -1)).filter((i) => i >= 0)

  if (numIdx.length === 0) return { ok: false, reason: 'no_counter' }

  let counterIdx: number
  let yearIdx = -1

  if (numIdx.length === 1) {
    // A sole numeric run is always the counter (even if it looks like a year).
    counterIdx = numIdx[0]
  } else {
    const yearIdxs = numIdx.filter((i) => isYearLike(toks[i].text))
    if (yearIdxs.length >= 2) return { ok: false, reason: 'ambiguous_year' }
    const nonYearIdxs = numIdx.filter((i) => !yearIdxs.includes(i))
    // With >= 2 runs and at most one year, there is always >= 1 non-year run.
    if (nonYearIdxs.length >= 2) return { ok: false, reason: 'ambiguous_counter' }
    counterIdx = nonYearIdxs[0]
    yearIdx = yearIdxs.length === 1 ? yearIdxs[0] : -1
  }

  const counterText = toks[counterIdx].text
  const startSeq = parseInt(counterText, 10)
  if (!Number.isFinite(startSeq) || startSeq < SEQ_MIN || startSeq > SEQ_MAX) {
    return { ok: false, reason: 'out_of_range' }
  }

  const template = toks
    .map((t, i) => (i === counterIdx ? '{seq}' : i === yearIdx ? '{year}' : t.text))
    .join('')

  return {
    ok: true,
    template,
    padding: counterText.length,
    startSeq,
    yearlyReset: yearIdx !== -1,
  }
}

/** Canonical formatter — SINGLE source of truth (invoice-numbering.ts imports this). */
export function formatInvoiceNumber(
  template: string,
  seq: number,
  padding: number,
  year: number
): string {
  const seqStr = String(seq).padStart(padding, '0')
  return template.split('{seq}').join(seqStr).split('{year}').join(String(year))
}

/**
 * Convenience for the onboarding/Settings live confirmation: the first two
 * rendered numbers (first = what they typed, next = +1) so the customer sees
 * the PATTERN, not just the number.
 */
export interface PreviewOk extends ExtractOk {
  first: string
  next: string
}
export type PreviewResult = PreviewOk | ExtractErr

export function previewInvoiceStart(raw: string, year: number): PreviewResult {
  const ex = extractInvoiceTemplate(raw)
  if (!ex.ok) return ex
  return {
    ...ex,
    first: formatInvoiceNumber(ex.template, ex.startSeq, ex.padding, year),
    next: formatInvoiceNumber(ex.template, ex.startSeq + 1, ex.padding, year),
  }
}

/** Friendly Dutch copy for a rejection reason (product is Dutch-only). */
export function reasonToDutch(reason: ExtractReason): string {
  switch (reason) {
    case 'empty':
      return '' // no message -- empty input is valid (= start at 1)
    case 'no_counter':
      return 'Vul een factuurnummer in, bijv. 045-2026.'
    case 'too_long':
      return 'Dit nummer is te lang — probeer iets als 2026-001.'
    case 'ambiguous_year':
      return 'We zien twee jaartallen — welk jaar bedoel je? Probeer bijv. 2026-001.'
    case 'ambiguous_counter':
      return 'Dit nummer snappen we niet helemaal — probeer bijv. 045-2026 of 2026-045.'
    case 'out_of_range':
      return 'Begin met een nummer tussen 1 en 2.000.000.000.'
    default:
      return 'Dit nummer snappen we niet helemaal — probeer bijv. 045-2026.'
  }
}