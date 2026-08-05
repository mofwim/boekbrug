// src/lib/payment-named-invoices.ts
// [PAYMENT-NAMES-MISSING] A payment can name an invoice you do not have yet. Pure.
//
// ── THE DEADLOCK THIS EXISTS FOR ──
// ATAPACK Cash & Carry, one debit of € 2.265,41, description:
//
//     "Tweede deel factuur 26302050 , factuur 26302362"
//
// Two invoices, plainly written. The card even said "2 facturen". And underneath it the screen
// offered ONE candidate and a "Bevestig betaling" that books the whole € 2.265,41 onto 26302050 —
// because the slot view is gated on how many of those numbers resolve to an invoice we HOLD, and
// 26302362 had never been imported.
//
// The label and the gate are computed three lines apart from the same list, and they disagreed.
//
// What it costs is not a display glitch. All € 2.265,41 lands on one invoice, so that invoice reads
// as more settled than it is; the money that belonged to the other one is spent; and when 26302362
// finally arrives it stands fully open with its payment already consumed elsewhere. From that
// screen the owner can fix none of it: there is nothing to split, and no way to say "the rest
// belongs to a bill I do not have yet".
//
// ── WHY NOT SIMPLY "TWO NUMBERS IN THE TEXT" ──
// Because the gate that is there guards something real, and its comment says so. A PSP or
// order-gateway reference (a Mollie transaction hash beside an order number) also holds several
// number-ish fragments, and forcing the slot view on those hid the amount-matched invoice behind
// rows that could never be filled. Brabant Water was worse: a customer number and a postcode
// parsed as "invoices".
//
// So an unresolved run counts as a NAMED invoice only on evidence, and there are exactly two kinds
// worth trusting:
//
//   · the supplier introduced it as one — "factuur 26302362", "factuurnr 26302362";
//   · a SIBLING number in the same text is an invoice we already hold, and this run has the same
//     number of digits. That anchor is what makes it safe: the shape is corroborated by a number
//     we can verify, in the same sentence, from the same supplier's own numbering.
//
// A customer number has neither. A Mollie hash has no bare digit run of invoice length at all.
//
// Pure: no I/O, no clock. This only says what a payment NAMED; the screen decides what to render
// and the owner decides what it means.

import { normalizeInvoiceNumber } from '@/lib/safecore'

/** A number this payment names, and whether we hold the invoice for it. */
export interface NamedInvoice {
  /** The number as printed in the payment text (or as we store it, when we hold it). */
  number: string
  /** True when an invoice with this number is in the administration. */
  known: boolean
}

/**
 * Dutch supplier invoice numbers run roughly 5–12 digits (26302050 is 8). Below five a run is a
 * quantity, a house number or a short customer code; above twelve it is an IBAN fragment, a card
 * number or a transaction id.
 */
const INVOICE_DIGITS = /(\d{5,12})/g

/** Words a supplier puts in front of an invoice number. Not "klant", not "order", not "relatie". */
const INVOICE_WORD = /(factuur|faktuur|fakt|fact|invoice)\w*\.?\s*(nr\.?|nummer|no\.?|#)?\s*[:.]?\s*$/i

/** An 8-digit run that reads as a calendar date (20260620) is not an invoice number. */
function looksLikeDate(run: string): boolean {
  if (run.length !== 8) return false
  const y = Number(run.slice(0, 4))
  const m = Number(run.slice(4, 6))
  const d = Number(run.slice(6, 8))
  return y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31
}

/**
 * Which invoices does this payment text name, and which of them do we hold?
 *
 * `knownNumbers` are the invoice numbers already in the administration (candidates, confirmed and
 * covered) — the same list the slot view builds from. Each of those the text names comes back
 * `known: true`; an unresolved run comes back only when it carries the evidence in the header.
 */
export function namedInvoiceNumbers(
  text: string | null | undefined,
  knownNumbers: Array<string | null | undefined>,
): NamedInvoice[] {
  const src = (text ?? '').trim()
  if (!src) return []
  const flat = normalizeInvoiceNumber(src)

  const out: NamedInvoice[] = []
  const seen = new Set<string>()

  // ── The ones we hold, first: they are the anchors the second rule leans on ──
  for (const raw of knownNumbers) {
    const n = (raw ?? '').trim()
    if (!n) continue
    const key = normalizeInvoiceNumber(n)
    if (!key || seen.has(key)) continue
    if (flat.includes(key)) {
      seen.add(key)
      out.push({ number: n, known: true })
    }
  }

  // The digit lengths of the numbers we DID recognise — the sibling anchor.
  const anchorLengths = new Set(
    out.map((o) => o.number.replace(/\D/g, '').length).filter((l) => l >= 5 && l <= 12),
  )

  // ── Runs the text names that we do not hold ──
  for (const m of src.matchAll(INVOICE_DIGITS)) {
    const run = m[1]
    const key = normalizeInvoiceNumber(run)
    if (seen.has(key)) continue
    // A run that is a fragment of a number already listed is not a second invoice.
    if ([...seen].some((k) => k.includes(key))) continue
    if (looksLikeDate(run)) continue

    const introduced = INVOICE_WORD.test(src.slice(0, m.index ?? 0))
    const siblingShape = anchorLengths.has(run.length)
    if (!introduced && !siblingShape) continue

    seen.add(key)
    out.push({ number: run, known: false })
  }

  return out
}

/** The numbers this payment names that we do NOT hold. */
export function missingNamedInvoices(named: readonly NamedInvoice[]): string[] {
  return named.filter((n) => !n.known).map((n) => n.number)
}

/**
 * What to tell the owner when a payment names an invoice that is not in their administration.
 *
 * It says the one thing that unblocks them: the money cannot all belong to the invoice we DO have,
 * and the missing bill has to come in before this payment can be split correctly. Dutch, per
 * AGENTS.md.
 */
export function missingInvoiceNoticeText(missing: readonly string[]): string | null {
  if (missing.length === 0) return null
  const list = missing.join(' en ')
  return missing.length === 1
    ? `Deze betaling noemt ook factuur ${list}, en die staat niet in je administratie. Voeg hem eerst toe — anders wordt het hele bedrag op de andere factuur geboekt en klopt die niet meer.`
    : `Deze betaling noemt ook de facturen ${list}, en die staan niet in je administratie. Voeg ze eerst toe — anders wordt het hele bedrag op de bekende factuur geboekt en klopt die niet meer.`
}
