// src/lib/numbering-lock.ts
// [NUMMER-SLOT] When is an owner's invoice numbering frozen?
// =====================================================================
// Article 35 Wet OB 1968 wants a sequential, gapless, forward-only series. /api/invoice/numbering
// enforces that by REFUSING to rewrite the template, the padding or the start sequence once a
// number has gone out. That refusal is only as good as the question it asks.
//
// ── THE QUESTION IT ASKED, AND WHY IT WAS THE WRONG ONE ──
//
// The lock counted issued facturen whose `invoice_date` falls inside the current year:
//
//     .gte('invoice_date', `${year}-01-01`).lte('invoice_date', `${year}-12-31`)
//
// while the COUNTER those numbers come from is keyed by the clock at the moment of allocation
// (invoice-numbering.ts). Those are two different quantities. `invoice_date` is a field the owner
// fills in — send/route.ts validates its SHAPE (Art. 35a sub e) and nothing else, and checkInvoiceDates
// only asks that the due date is not before it. Back-dating is ordinary: December work invoiced on
// 4 January is dated 28 December.
//
// So an invoice numbered from the 2027 counter can carry invoice_date 2026-12-28. The 2027 lock
// counts invoices dated in 2027, does not see it, reports "nothing issued yet" — and the owner may
// then rewrite the template and re-seed a sequence that has already put a number on a document in a
// customer's inbox. That is precisely the retroactive reshape the lock exists to refuse, and the
// audit row that proves the platform refused it is never written either.
//
// ── THE QUESTION IT ASKS NOW ──
//
// "Was a number drawn from the counter I am about to re-seed?" Two independent witnesses, either of
// which locks:
//
//   1. invoice_date inside the year — what it always checked. Kept: for the ordinary invoice, dated
//      the day it is sent, this is true and cheap.
//   2. the invoice NUMBER contains the year. When a template yields a yearly reset it contains
//      {year} by definition (invoice-template.ts derives the reset FROM that token), so
//      formatInvoiceNumber writes the counter year into every number it produces. The number is the
//      only column that records which counter a document came from.
//
// UNION, never intersection. This can only ever lock MORE than before, and that asymmetry is the
// whole design: over-locking asks an owner to wait or to write to support, and is undone in one
// row; under-locking reshapes a legal series after issuance and is undone by nothing.
//
// The known over-match is deliberate: an owner whose SEQUENCE happens to read like another year
// ("2026-2027" — invoice 2027 of the year 2026) locks 2027's numbering too. Rare, harmless,
// recoverable, and on the safe side of the asymmetry.
//
// Continuous numbering (no {year} token) draws from the single year=0 counter, so its lock has no
// year window at all and never had this problem — counterYearFor returns 0 and the caller applies
// no filter.
// =====================================================================

/**
 * The counter row a template draws from.
 *
 * `{year}` present ⇒ yearly reset, keyed by the calendar year.
 * `{year}` absent  ⇒ continuous, keyed by the 0 sentinel.
 *
 * This is the same derivation invoice-numbering.ts makes; it lives here so the LOCK and the
 * ALLOCATOR cannot drift into two different answers, which is the class of bug this file exists for.
 */
export function counterYearFor(template: string, year: number): number {
  return template.includes('{year}') ? year : 0
}

/** The inclusive ISO window for one calendar year, as the invoice_date filter needs it. */
export function invoiceDateWindow(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/**
 * The pattern that matches an invoice number minted from year `year`'s counter.
 *
 * SQL LIKE with `%` on both sides: the year token can sit anywhere a template puts it —
 * "20270001", "045-2027", "F2027-045", "INV-045-2027" all contain it.
 */
export function invoiceNumberYearPattern(year: number): string {
  return `%${year}%`
}

/**
 * Is this issued factuur a witness that year `year`'s counter has been drawn from?
 *
 * The single rule both halves of the database lock implement. The route runs the two halves as two
 * counts (a union is cheaper and far more readable as two ordinary filters than as one nested
 * PostgREST `or(and(…),…)` string), and this function is what says they agree.
 *
 * A row with no number is not a witness: a draft has consumed nothing.
 */
export function issuedInCounterYear(
  invoiceDate: string | null | undefined,
  invoiceNumber: string | null | undefined,
  year: number,
): boolean {
  const number = typeof invoiceNumber === 'string' ? invoiceNumber.trim() : ''
  if (number === '') return false

  const { from, to } = invoiceDateWindow(year)
  const date = typeof invoiceDate === 'string' ? invoiceDate.slice(0, 10) : ''
  // String comparison is exact on ISO dates and needs no Date object — no timezone can enter here.
  if (date >= from && date <= to) return true

  return number.includes(String(year))
}
