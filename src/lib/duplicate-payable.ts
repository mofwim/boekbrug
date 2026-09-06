// src/lib/duplicate-payable.ts
// [DUP-ON-PAY] Two rows, one invoice number, both waiting to be paid. Pure.
//
// ── WHY THE IMPORT-TIME FLAG IS NOT ENOUGH ──
// safecore's [DEDUP-CORRECTED] tier already recognises this shape: a supplier who invoices the
// wrong amount and re-sends the SAME number with a corrected total. It is deliberately a FLAG and
// not a block — an invoice number our OCR shortened could otherwise reject a legitimate bill, and
// a missing crediteur is the worse of the two errors.
//
// The flag lives in the verify queue. The moment it matters is later and on another screen: once
// both copies are confirmed they sit side by side on the pay list, wearing "Te betalen", counted
// twice in the total at the top, each with its own Betalen button — and nothing anywhere says they
// are the same document. Three real pairs in one week:
//
//     26701681  Enka Horeca       € 1.348,14  and  € 1.335,68   → "€ 2.683,82 nog te betalen"
//     2601291   Al-Malika Bakkerij € 128,40   and  € 155,43
//
// An invoice number is unique per supplier by construction. Seeing one twice from the same
// supplier is a correction, a re-issue or a double import — never two bills. So the pay screen can
// say so with certainty, and the owner stops discovering it by adding up their own list.
//
// ── [BON-DUBBEL] AND THE DOCUMENTS THAT HAVE NO NUMBER ──
// Everything above rests on the invoice number, and a photographed kassabon does not have one we
// can read. Both intake paths mint a stand-in instead — `CAMERA-1784373753563`, one per import —
// so two photographs of ONE receipt produce two numbers that can never match. The rule below used
// to skip those rows entirely, which meant the intake path most likely to duplicate a document
// (photograph it again; it is one tap) was the one path with no duplicate protection at all.
//
// It was not theoretical. In the live administration, Nettorama Huizen € 10,74 stands twice: two
// rows created thirty-five seconds apart in one upload, one carrying CAMERA-1784373753563 and
// dated 22 April, the other carrying 631394 and dated 1 June with a payment date of 1 May — a
// payment before its own invoice date, so one of the two readings is wrong about something. € 0,89
// of voorbelasting counted twice, and neither row ever said a word.
//
// So a second pass pairs on the AMOUNT, and the whole design is in what it demands beside it:
//
//   · at least one of the two must have NO usable number. This is what makes the rule quiet, and
//     the difference was measured by running this function over all 497 live incoming invoices:
//     without the clause it reports 54 groups covering 84 rows — the monthly rent, KPN, the
//     bookkeeper, the waste collection, a bakery on a standing order. Every one of those is an
//     honest recurring invoice, and every one carries a real number on BOTH sides. With the
//     clause: one group, two rows, and it is the Nettorama pair.
//   · the amounts must be equal to the CENT. A resemblance is not this rule's business.
//   · the invoice dates must be within AMOUNT_MATCH_WINDOW_DAYS of each other, or one of them must
//     be missing — see the constant for why the window is as wide as it is.
//
// And it is reported as a different KIND of match (`matchedOn`), because it is weaker evidence and
// the owner must be told which of the two they are reading. A number match is proof: a supplier
// issues a number once. An amount match is a resemblance, and the sentence for it says so and does
// not tell anyone to delete a row.
//
// ── WHAT THIS DOES NOT DO ──
// It does not delete, merge or hide anything. Which of the two is right is a question about paper
// — the owner has it, we do not, and on the Enka pair the CORRECT copy was the one our reader got
// wrong. Removing a row here would be guessing with a bill.
//
// It also does not group across suppliers. Numbers are unique per supplier, not across them, so
// two unrelated companies sharing "0714" is a coincidence and grouping them would put a false
// warning on an honest invoice.
//
// Pure: no I/O, no clock.

import { normalizeInvoiceNumber, isPlaceholderInvoiceNumber, normalizeVendor } from '@/lib/safecore'

/** The row fields this reads. A structural subset of the pay screen's list. */
export interface DuplicateCandidateRow {
  id: string
  invoice_number: string | null
  client_name: string | null
  /**
   * [BON-DUBBEL] Required, not optional, and that is the point: the amount pass needs it, and an
   * optional field a caller forgets to select does not fail — it silently switches half of this
   * rule off, on the screen where nobody would notice. A caller that genuinely does not know the
   * date passes null and says so.
   */
  invoice_date: string | null
  total_inc_btw: number | null
  status: string | null
  amount_paid?: number | null
}

export interface DuplicateWarning {
  /** The other rows carrying this same supplier + number. */
  others: DuplicateCandidateRow[]
  /** True when at least one of the others is already settled — the expensive case. */
  anyPaid: boolean
  /** True when the amounts differ, i.e. a corrected re-issue rather than a plain double import. */
  amountsDiffer: boolean
  /**
   * [BON-DUBBEL] What paired these rows, because they are not equally strong.
   *
   * 'number' is proof — a supplier issues a number once, so the same one twice is a correction, a
   * re-issue or a double import, never two bills. 'amount' is a resemblance: two documents from
   * one supplier for the same cent amount, at least one of which has no number we can read. The
   * screen must not print the same sentence for both.
   */
  matchedOn: 'number' | 'amount'
}

/** Cent tolerance, matching the rest of the money line. */
const CENT = 0.005

/**
 * [BON-DUBBEL] How far apart two invoice dates may stand and still be one document read twice.
 *
 * Wide on purpose, and the reason is the case this exists for: on the Nettorama pair the two dates
 * are forty days apart, because one of the two readings got the date wrong — and a document whose
 * number could not be read is exactly the document whose date is also uncertain. A tight window
 * would let precisely the badly-read pairs through, which are the ones nothing else catches.
 *
 * The cost of being wide is bounded by what this rule DOES: on the pay list it puts a sentence on
 * a row, and at the pay route it asks a question the owner can answer with "toch afboeken"
 * ([HAND-DUBBEL]). It never blocks and never deletes. So a false pair costs one extra look at two
 * pieces of paper, while a missed pair costs a payment made twice.
 *
 * Two months also happens to be the horizon within which a shop uploads a backlog of bonnen.
 */
export const AMOUNT_MATCH_WINDOW_DAYS = 62

/**
 * Legal-suffix-insensitive supplier key. "Enka Horeca B.V." and "Enka Horeca bv" are one supplier;
 * folding them is what makes the pairing work across two imports that read the name differently.
 */
export function supplierKey(name: string | null | undefined): string {
  return normalizeVendor(name)
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'bvba', 'holding', 'inc', 'llc'].includes(t))
    .join(' ')
}

/**
 * [BON-DUBBEL] Is there a number on this row we can compare at all?
 *
 * One definition, used by BOTH passes — which is the point. The first pass skips these rows and
 * the second pass exists for them, so if the two answered this question differently there would be
 * documents that fall between: paired by nothing, warned about by nobody.
 *
 * Two ways to have no number: nothing readable at all, and a minted stand-in ("CAMERA-17843…",
 * "UPLOAD-…", "EMAIL-…") that every intake path generates per import. The second is the dangerous
 * one, because it LOOKS like a number and made the row read as fully identified.
 */
function hasNoUsableNumber(r: DuplicateCandidateRow): boolean {
  return !normalizeInvoiceNumber(r.invoice_number) || isPlaceholderInvoiceNumber(r.invoice_number)
}

/**
 * Which rows in this list share a supplier + invoice number with another row?
 *
 * Returns a map from row id to what to say about it. Rows with no real invoice number are never
 * grouped: a placeholder ("UPLOAD-17…") is minted per import and can only ever collide by
 * accident, which is precisely a warning on an honest invoice.
 */
export function findPayableDuplicates(
  rows: readonly DuplicateCandidateRow[],
): Map<string, DuplicateWarning> {
  const groups = new Map<string, DuplicateCandidateRow[]>()
  for (const r of rows) {
    const num = normalizeInvoiceNumber(r.invoice_number)
    if (hasNoUsableNumber(r)) continue
    const supplier = supplierKey(r.client_name)
    // Without a usable supplier there is no key: numbers are unique PER supplier, and grouping on
    // the number alone would pair two unrelated companies that both number from 1.
    if (!supplier) continue
    const key = `${supplier}::${num}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  const out = new Map<string, DuplicateWarning>()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const totals = list.map((r) => Math.round(Math.abs(Number(r.total_inc_btw ?? 0)) * 100))
    const amountsDiffer = new Set(totals).size > 1
    for (const r of list) {
      const others = list.filter((o) => o.id !== r.id)
      out.set(r.id, {
        others,
        anyPaid: others.some(
          (o) => (o.status ?? '') === 'paid' || Math.max(0, Number(o.amount_paid ?? 0)) > CENT,
        ),
        amountsDiffer,
        matchedOn: 'number',
      })
    }
  }

  // ── [BON-DUBBEL] Second pass: the documents the number could not pair ──────────────────────
  //
  // Runs AFTER the first and never overwrites it. A row already paired by its number keeps that
  // warning: the number is proof and the amount is a resemblance, and showing the weaker of two
  // findings would be a step backwards on exactly the rows where we know the most.
  const byAmount = new Map<string, DuplicateCandidateRow[]>()
  for (const r of rows) {
    const supplier = supplierKey(r.client_name)
    if (!supplier) continue
    const cents = Math.round(Math.abs(Number(r.total_inc_btw ?? 0)) * 100)
    // A zero-amount row resembles every other zero-amount row and means nothing here.
    if (cents === 0) continue
    const key = `${supplier}::${cents}`
    const list = byAmount.get(key)
    if (list) list.push(r)
    else byAmount.set(key, [r])
  }

  for (const list of byAmount.values()) {
    if (list.length < 2) continue
    // Cheap skip: without a single numberless row nothing in this group can pair. The real clause
    // is per PAIR, one line down — a group-level test is not the same thing, and the difference is
    // a false warning on two honest invoices. Three rows at one amount, one of them a photographed
    // bon and the other two a monthly bill in January and in April: the group qualifies because of
    // the bon, and then the two monthly invoices pair with EACH OTHER. Which is exactly the
    // recurring-supplier noise the clause exists to remove, re-entering through the side door.
    if (!list.some(hasNoUsableNumber)) continue

    for (const r of list) {
      if (out.has(r.id)) continue
      const others = list.filter((o) =>
        o.id !== r.id &&
        // At least one side of THIS pair must be the document the number could not identify.
        (hasNoUsableNumber(r) || hasNoUsableNumber(o)) &&
        withinAmountWindow(r.invoice_date, o.invoice_date))
      if (others.length === 0) continue
      out.set(r.id, {
        others,
        anyPaid: others.some(
          (o) => (o.status ?? '') === 'paid' || Math.max(0, Number(o.amount_paid ?? 0)) > CENT,
        ),
        // Equal to the cent by construction — that is what put them in this group.
        amountsDiffer: false,
        matchedOn: 'amount',
      })
    }
  }
  return out
}

/** A day number from an ISO date prefix, via UTC noon so an offset can never move the day. */
function dayNumber(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return null
  const n = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / 86_400_000)
  return Number.isFinite(n) ? n : null
}

/**
 * Are these two dates close enough to be one document?
 *
 * A MISSING date counts as yes, and that is deliberate: "we do not know when this was" is not the
 * same as "these are far apart", and answering an unknown with a silent no is how a check that
 * could not run reads as a check that passed. The pair still has to survive supplier, cent amount
 * and the numberless clause before it gets here.
 */
export function withinAmountWindow(a: string | null, b: string | null): boolean {
  const x = dayNumber(a)
  const y = dayNumber(b)
  if (x === null || y === null) return true
  return Math.abs(x - y) <= AMOUNT_MATCH_WINDOW_DAYS
}

/** € 1.234,56 — the notation the rest of the screen uses. */
function eur(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)
}

/**
 * What the owner reads on the row. Dutch, per AGENTS.md.
 *
 * It names the OTHER amounts, because that is the whole decision: on both real pairs the two
 * copies differed, and which one is right is answered by looking at the paper — not by us.
 */
export function duplicateWarningText(w: DuplicateWarning, number: string | null): string {
  const nr = (number ?? '').trim()
  const amounts = w.others
    .map((o) => eur(Math.abs(Number(o.total_inc_btw ?? 0))))
    .join(' en ')

  // [BON-DUBBEL] An amount match is a RESEMBLANCE and gets its own sentences. It may not borrow
  // the number match's, for two reasons the owner would pay for: those sentences state that the
  // rows are the same document, which here we do not know, and they end in "verwijder er één" —
  // advice that on two genuinely different receipts for the same amount destroys a real
  // voorbelasting. It says what we compared and leaves the conclusion to the paper.
  if (w.matchedOn === 'amount') {
    const leverancier = (w.others[0]?.client_name ?? '').trim()
    const van = leverancier ? ` van ${leverancier}` : ' van dezelfde leverancier'
    const kop = `Er staat nog een document${van} voor exact hetzelfde bedrag (${amounts})`
    const waarom =
      'Op één van de twee staat geen leesbaar factuurnummer, dus ze zijn alleen op het bedrag ' +
      'vergeleken — dat is een gelijkenis, geen bewijs.'
    return w.anyPaid
      ? `${kop}, en dat is al betaald. ${waarom} Leg de bonnen naast elkaar voordat je deze afboekt.`
      : `${kop}. ${waarom} Leg ze naast elkaar: zijn het twee aankopen of één bon die twee keer is ingelezen?`
  }

  const head = nr
    ? `Factuurnummer ${nr} staat ${w.others.length + 1}× in je administratie`
    : `Deze factuur staat ${w.others.length + 1}× in je administratie`

  if (w.anyPaid) {
    return `${head} — en één ervan is al betaald (${amounts}). Betaal deze niet zonder de factuur ernaast te leggen.`
  }
  return w.amountsDiffer
    ? `${head}, met een ander bedrag (${amounts}). Eén leverancier geeft een nummer maar één keer uit, dus dit is een correctie of een dubbele import — leg de factuur ernaast en verwijder de verkeerde.`
    : `${head} voor hetzelfde bedrag (${amounts}) — waarschijnlijk twee keer geïmporteerd. Verwijder er één.`
}
