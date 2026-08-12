// src/lib/format-nl.ts
// [FACTUUR-A] Single source of truth for Dutch display formatting — June 2026
// =====================================================
// THE rule (no exceptions): every date a human sees is DD-MM-YYYY,
// every amount a human sees uses the Dutch decimal comma.
// Form pages, invoice detail, PDF, e-mail — all import from here.
//
// Storage stays ISO (YYYY-MM-DD) internally; this module is display-only.
//
// Deliberately NOT reusing lib/export.ts#fmtDateNL:
//   * fmtDateNL uses toLocaleDateString → "12-7-2026" (no leading zeros)
//     and is timezone-sensitive for date-only strings.
//   * export.ts feeds production CSV (BOEK-013/014) — frozen, not touched.
// =====================================================

/**
 * ISO date → "DD-MM-YYYY" (leading zeros, timezone-proof).
 *
 * Date-only strings ("2026-06-12") are reformatted by string surgery —
 * `new Date('2026-06-12')` parses as UTC midnight, which shifts a day
 * for users in negative-offset timezones. We never let that happen on
 * a legal document.
 *
 * Full timestamps fall back to Intl pinned to Europe/Amsterdam.
 */
export function formatDateNL(iso: string | null | undefined): string {
  if (!iso) return '—'

  // Fast path: ISO date prefix — pure string, no Date object, no timezone.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`

  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  }).format(d)
}

/**
 * Number → "€ 1.234,56" (Dutch comma, thousands dot).
 * Negative amounts (creditnota) render as "€ -201,00".
 *
 * The non-breaking space Intl inserts after € is normalized to a plain
 * space — some PDF/e-mail renderers show U+00A0 as a stray glyph.
 */
export function formatEuroNL(n: number | null | undefined): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  })
    .format(v)
    .replace(/\u00A0/g, ' ')
}

/**
 * Number → "€1,234.56" (English/EU-English formatting: comma thousands, dot
 * decimal). Additive counterpart to formatEuroNL for the public English tool
 * pages only — the Dutch app/tools keep using formatEuroNL unchanged.
 */
export function formatEuroEN(n: number | null | undefined): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  })
    .format(v)
    .replace(/ /g, ' ')
}

/**
 * btw_rate does NOT exist as a column on invoices (house rule) —
 * always derived: round(btw_amount / total_ex_btw * 100).
 * Negative pairs (creditnota) yield the correct positive rate.
 */
export function deriveBtwRate(
  btwAmount: number | null | undefined,
  totalExBtw: number | null | undefined
): number {
  const ex = Number(totalExBtw ?? 0)
  if (!ex) return 0
  return Math.round((Number(btwAmount ?? 0) / ex) * 100)
}
/**
 * Today's date in Europe/Amsterdam as ISO 'YYYY-MM-DD'.
 *
 * [TZ] `new Date().toISOString().slice(0, 10)` is UTC, and the Netherlands is
 * UTC+1/+2 — so between midnight and 01:00 (02:00 in summer) local time it
 * returns YESTERDAY. In a bookkeeping app that is not cosmetic:
 *
 *   · an invoice created just after midnight on 1 January gets dated 31 December
 *     — the previous FISCAL YEAR and the previous BTW-quarter, on a document
 *     that already carries a number from the doorlopende reeks;
 *   · a payment recorded just after midnight on 1 July gets dated 30 June, which
 *     under KASSTELSEL puts its BTW in a quarter that may already be filed;
 *   · used as an input `max`, it stops the owner picking today at all.
 *
 * The crons already work in Amsterdam time for exactly this reason. Client
 * components must use the same clock, or the two disagree about what "today" is.
 *
 * `now` is injectable so this is testable without touching the system clock.
 */
export function amsterdamToday(now: Date = new Date()): string {
  // en-CA renders ISO-ordered YYYY-MM-DD, so no reassembly is needed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * The owner's calendar YEAR in Europe/Amsterdam.
 *
 * [NUMMER-JAAR] The paragraph above names this exact failure — "an invoice created just after
 * midnight on 1 January gets dated 31 December … on a document that already carries a number from
 * the doorlopende reeks" — and the numbering line was the one place still asking `new Date()`
 * directly. Between 23:00 UTC on 31 December and midnight UTC the server's year is the OLD one
 * while the owner is already in the NEW one, so for that hour:
 *
 *   · next_invoice_seq draws from LAST year's counter, which was supposed to be closed, and the
 *     new year's series starts at 2 instead of 1 — a gap Article 35 does not allow;
 *   · formatInvoiceNumber prints that old year, so an invoice dated 1 January 2027 goes out
 *     numbered 20260123.
 *
 * One hour a year, on the busiest possible boundary. Derived from amsterdamToday() rather than
 * from a second Intl call so there is only ever one clock to be wrong.
 *
 * `now` is injectable so this is testable without touching the system clock.
 */
export function amsterdamYear(now: Date = new Date()): number {
  return Number(amsterdamToday(now).slice(0, 4))
}
