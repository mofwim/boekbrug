// src/lib/document-verify.ts
// [DOCCHECK] The full independent verification of a read, against the document's own text. Pure.
//
// ── WHERE THIS PICKS UP ──
// [GEGROND] answers "is this number printed on the paper?" — mechanically, with no model. That
// closed the worst hole: a figure the reader INVENTED or COMPUTED, internally consistent, which
// every other gate waved through (the € 0,46 error).
//
// It does not close the next one, and measurement says so plainly. On a real layout:
//
//     read 2.265,41 (the total)        → found      — correct
//     read 1.872,24 (the SUBTOTAL)     → found      — wrong, and waved through
//     read   573,24 (a LINE ITEM)      → found      — wrong, and waved through
//     read   393,17 (the BTW)          → found      — wrong, and waved through
//
// All three wrong reads are printed on the paper, so "is it printed?" cannot tell them apart. The
// question has to become sharper: is it printed IN THE PLACE A TOTAL IS PRINTED?
//
// ── WHAT MAKES THAT ANSWERABLE WITHOUT A MODEL ──
// An invoice says where its total is, in words. "Totaal", "Te betalen", "Totaalbedrag", "Eindtotaal"
// — and the amount that follows one of those is the total, by the document's own labelling. A
// subtotal sits behind "Subtotaal" or "Totaal excl. btw", which are DIFFERENT words, and a line item
// sits behind no word at all.
//
// Two independent tests, and either one is enough:
//   · ANCHORED — the amount follows a total-word that is not an excl-word. The document said so.
//   · LARGEST  — it is the largest amount on the page. A subtotal is smaller than its total by the
//                BTW, a line item is smaller again, and the BTW is smaller than both.
//
// Both are mechanical, and the wrong picks above fail both. That is the whole idea.
//
// ── AND THE FIELDS THAT HAD NO WITNESS AT ALL ──
// The date decides which quarter the BTW lands in, and nothing has ever checked it against the
// document. Same for the invoice number, which is what makes a duplicate detectable. Both are
// verifiable the same way: does the stored value occur in the text, in any form the paper might
// print it?
//
// ── THE HONESTY RULE, EVERYWHERE ──
// Three states, never two. A check that could not RUN (no text layer) is its own answer and may
// never read as passed OR as failed. That rule is why this is worth trusting at all.

import { groundAmount, type GroundingVerdict } from './amount-grounding'

/**
 * How well the read total is supported by the document.
 *
 * Ordered strongest first, and the order is the point: 'present' is the verdict that did not exist
 * before, and it is exactly the subtotal-picked-as-total case.
 */
export type TotalVerdict =
  | 'anchored'    // follows a total-word the document itself printed
  | 'largest'     // the biggest amount on the page — a subtotal never is
  | 'present'     // printed somewhere, but neither of those. THIS is the wrong-number shape.
  | 'absent'      // not printed at all — invented or computed
  | 'unreadable'  // no text to search

/** Whether a non-money field was found in the document. */
export type FieldVerdict = 'found' | 'absent' | 'unreadable'

export interface DocumentCheck {
  total: TotalVerdict
  /** The invoice date, checked against every way a Dutch document might print it. */
  date: FieldVerdict
  /** The invoice number — what makes a duplicate detectable. */
  invoiceNumber: FieldVerdict
  /** The BTW amount, by the same grounding rule as before. */
  btw: GroundingVerdict
}

// ── Anchors ───────────────────────────────────────────────────────────────────

/**
 * Words a document uses to label its final amount. Dutch first, then the languages a Dutch
 * administration actually receives invoices in.
 *
 * `totaal` is in here even though `subtotaal` contains it — the boundary check below is what tells
 * them apart, and dropping `totaal` to avoid the collision would lose the single most common label
 * on a Dutch invoice.
 */
const TOTAL_WORDS = [
  'totaal te betalen', 'te betalen', 'totaalbedrag', 'eindtotaal', 'totaal incl', 'totaal',
  'factuurbedrag', 'openstaand bedrag',
  'total amount', 'amount due', 'grand total', 'total',
  'gesamtbetrag', 'gesamtsumme', 'zu zahlen',
]

/**
 * Words that make a nearby total-word mean something else.
 *
 * "Totaal excl. btw" is not the total, and neither is "Subtotaal". Getting this list wrong in the
 * permissive direction is the failure that matters: it would anchor a SUBTOTAL and bless exactly the
 * read this module exists to catch.
 */
const NOT_TOTAL = ['sub', 'excl', 'exclusief', 'ex.', 'netto', 'zonder btw', 'before tax', 'net ']

/** Every amount-shaped token in the text, as numbers. */
export function amountsIn(text: string): number[] {
  const out: number[] = []
  // A money token: digits, optional grouping, and a 2-digit decimal part. Requiring the decimals is
  // what keeps order numbers, postcodes and article codes out of the comparison.
  const re = /\d{1,3}(?:[.,    ]\d{3})*[.,]\d{2}(?![\d])|\d+[.,]\d{2}(?![\d])/g
  for (const m of text.match(re) ?? []) {
    const t = m.trim()
    // Decide which separator is the decimal one: it is the LAST of the two, always.
    const lastComma = t.lastIndexOf(',')
    const lastDot = t.lastIndexOf('.')
    const decAt = Math.max(lastComma, lastDot)
    if (decAt < 0) continue
    const whole = t.slice(0, decAt).replace(/[^0-9]/g, '')
    const frac = t.slice(decAt + 1).replace(/[^0-9]/g, '')
    const n = Number(`${whole || '0'}.${frac.padEnd(2, '0').slice(0, 2)}`)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * The amounts that follow a total-word, as numbers.
 *
 * "Follows" means within a short window after the word — a label and its amount sit on one line, and
 * a wide window would reach the next row and anchor whatever happens to be there.
 */
export function anchoredAmounts(text: string): number[] {
  const lower = text.toLowerCase()
  const out: number[] = []
  for (const word of TOTAL_WORDS) {
    let from = 0
    for (;;) {
      const i = lower.indexOf(word, from)
      if (i === -1) break
      from = i + 1
      // The 12 characters before decide whether this occurrence means the total at all: "subtotaal"
      // and "totaal excl." both contain a total-word and neither IS one.
      const before = lower.slice(Math.max(0, i - 12), i)
      const after = lower.slice(i + word.length, i + word.length + 14)
      if (NOT_TOTAL.some((n) => before.includes(n) || after.includes(n))) continue
      // 60 characters: enough for "Totaal te betalen .......... € 2.265,41", short enough that the
      // next line's amount is out of reach.
      out.push(...amountsIn(text.slice(i + word.length, i + word.length + 60)))
    }
  }
  return out
}

const CENT = 0.005

/** Is `a` the same amount as `b`, to the cent? */
function same(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) < CENT
}

/**
 * How well the document supports this total.
 *
 * The ORDER of the tests is the design. Anchored is the document's own statement and outranks
 * everything; largest is a structural fact about invoices; and only when both fail does 'present'
 * become the answer — which is not "fine", it is "printed, but not where a total is printed".
 */
export function verifyTotal(amount: number | null | undefined, text: string | null | undefined): TotalVerdict {
  const ground = groundAmount(amount, text)
  if (ground !== 'found') return ground === 'absent' ? 'absent' : 'unreadable'
  const n = amount as number
  const t = text as string

  if (anchoredAmounts(t).some((a) => same(a, n))) return 'anchored'

  const all = amountsIn(t)
  if (all.length === 0) return 'present'
  const max = Math.max(...all.map((a) => Math.abs(a)))
  if (same(max, n)) return 'largest'

  return 'present'
}

// ── Date ──────────────────────────────────────────────────────────────────────

const MONTHS_NL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]

/**
 * Does the stored invoice date occur in the document?
 *
 * The date is the field with the most consequence and the least scrutiny: under the kasstelsel it is
 * the payment date that picks the quarter, but the INVOICE date picks it under factuurstelsel, and
 * a date read a month wrong moves BTW between two filings. Nothing has ever checked it against the
 * paper.
 *
 * Every form a Dutch document might print it in, because a missed format is a false alarm on a
 * correct invoice — and those are what teach people to ignore warnings.
 */
export function verifyDate(iso: string | null | undefined, text: string | null | undefined): FieldVerdict {
  const t = (text ?? '').trim()
  if (t.length === 0) return 'unreadable'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return 'unreadable'

  const [, y, mo, d] = m
  const yy = y.slice(2)
  const dNum = String(Number(d))
  const moNum = String(Number(mo))
  const monthName = MONTHS_NL[Number(mo) - 1] ?? ''
  const monthShort = monthName.slice(0, 3)

  const forms = new Set<string>()
  for (const sep of ['-', '/', '.', ' ']) {
    forms.add(`${d}${sep}${mo}${sep}${y}`)   // 01-06-2026
    forms.add(`${dNum}${sep}${moNum}${sep}${y}`)
    forms.add(`${d}${sep}${mo}${sep}${yy}`)  // 01-06-26
    forms.add(`${dNum}${sep}${moNum}${sep}${yy}`)
    forms.add(`${y}${sep}${mo}${sep}${d}`)   // ISO and its punctuated cousins
  }
  if (monthName) {
    for (const mn of [monthName, monthShort]) {
      forms.add(`${dNum} ${mn} ${y}`)
      forms.add(`${d} ${mn} ${y}`)
      forms.add(`${dNum} ${mn}. ${y}`)
    }
  }

  const lower = t.toLowerCase()
  for (const f of forms) {
    if (lower.includes(f.toLowerCase())) return 'found'
  }
  return 'absent'
}

// ── Invoice number ────────────────────────────────────────────────────────────

/**
 * Does the stored invoice number occur in the document?
 *
 * It is what makes a duplicate detectable and what a payment quotes, so a number that is not on the
 * paper is a number nothing else can ever reconcile against.
 *
 * Compared on alphanumerics only: a document printing "26302050" and a stored "2630-2050" are the
 * same number wearing different punctuation, and flagging that pair would be a false alarm.
 */
export function verifyInvoiceNumber(num: string | null | undefined, text: string | null | undefined): FieldVerdict {
  const t = (text ?? '').trim()
  if (t.length === 0) return 'unreadable'
  const n = (num ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  // Too short to mean anything: a two-character "number" occurs everywhere and confirming it would
  // be noise dressed as evidence. Placeholder numbers the app generates are excluded the same way.
  if (n.length < 3) return 'unreadable'
  if (/^(upload|email|intake)/.test(n)) return 'unreadable'
  return t.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(n) ? 'found' : 'absent'
}

// ── The whole check ───────────────────────────────────────────────────────────

export function verifyDocument(
  read: {
    totalIncBtw?: number | null
    btwAmount?: number | null
    invoiceDate?: string | null
    invoiceNumber?: string | null
  },
  text: string | null | undefined,
): DocumentCheck {
  return {
    total: verifyTotal(read.totalIncBtw, text),
    date: verifyDate(read.invoiceDate, text),
    invoiceNumber: verifyInvoiceNumber(read.invoiceNumber, text),
    btw: groundAmount(read.btwAmount, text),
  }
}

/**
 * May this read be booked with no human?
 *
 * Only the TOTAL decides, and only its two worst verdicts. That restraint is deliberate:
 *
 *   · 'absent'  — the figure is not on the paper. Invented or computed. Always holds.
 *   · 'present' — printed, but neither labelled as the total nor the largest amount. This is the
 *                 subtotal-read-as-total shape, and it is the whole reason this module exists.
 *
 * Everything else is REPORTED and blocks nothing. A date or an invoice number that could not be
 * found is worth telling the owner about, but holding an invoice for it would fire on the many
 * documents that print a date in a format nobody predicted — and a queue full of correct invoices is
 * how a safety feature gets switched off.
 */
export function documentCheckBlocks(c: DocumentCheck): boolean {
  return c.total === 'absent' || c.total === 'present'
}

/**
 * Read the stored placement verdict for the TOTAL out of a field_confidence blob.
 *
 * One reader for both auto-booking doors, for the same reason groundingOf has one: each door
 * reaching into the jsonb its own way is how the intake and e-mail paths came to disagree about the
 * duplicate marker, and that disagreement was invisible until it double-booked an invoice.
 *
 * Anything unrecognisable returns null, which the gate treats as "the check did not run" — a
 * malformed blob may not invent a refusal any more than it may invent an approval.
 */
export function placementOf(fieldConfidence: unknown): TotalVerdict | null {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  const c = (fieldConfidence as Record<string, unknown>)._doccheck
  if (!c || typeof c !== 'object') return null
  const v = (c as Record<string, unknown>).total
  return v === 'anchored' || v === 'largest' || v === 'present' || v === 'absent' || v === 'unreadable'
    ? v
    : null
}
