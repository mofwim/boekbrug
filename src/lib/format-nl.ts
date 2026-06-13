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