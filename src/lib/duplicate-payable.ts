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
}

/** Cent tolerance, matching the rest of the money line. */
const CENT = 0.005

/**
 * Legal-suffix-insensitive supplier key. "Enka Horeca B.V." and "Enka Horeca bv" are one supplier;
 * folding them is what makes the pairing work across two imports that read the name differently.
 */
function supplierKey(name: string | null | undefined): string {
  return normalizeVendor(name)
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['bv', 'nv', 'vof', 'cv', 'ltd', 'gmbh', 'bvba', 'holding', 'inc', 'llc'].includes(t))
    .join(' ')
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
    if (!num || isPlaceholderInvoiceNumber(r.invoice_number)) continue
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
      })
    }
  }
  return out
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
