// src/lib/parse-nl.ts
// [PARSE-NL] Single tolerant parser for user-typed Dutch amounts. The counterpart
// to lib/format-nl (which is display-only). Handles the real ways people type
// money, so "40.000" is forty-thousand — not 40.
//
//   "40.000"      → 40000      (dot = thousands grouping)
//   "1.250.000"   → 1250000
//   "1.250,00"    → 1250.00    (dot thousands + comma decimal)
//   "40.000,50"   → 40000.50
//   "1,5" / "0,25"→ 1.5 / 0.25 (comma decimal)
//   "1.5" / "0.25"→ 1.5 / 0.25 (lone dot with ≠3 trailing digits = decimal)
//   "40000" / "100" → 40000 / 100
//
// Rule: if both separators appear, the LAST one is the decimal. If only a dot
// appears, it's thousands grouping ONLY when every dot is followed by exactly 3
// digits (e.g. 40.000, 1.250.000); otherwise it's a decimal point.

/**
 * English-style amount parser for the public /en tool pages: comma = thousands
 * separator, dot = decimal. The counterpart to parseAmountNL (Dutch
 * conventions), because an English user types "50,000" for fifty-thousand,
 * which parseAmountNL would read as 50.
 *
 *   "50,000"     → 50000
 *   "1,234.56"   → 1234.56
 *   "50000"      → 50000
 *   "0.25"       → 0.25
 */
export function parseAmountEN(input: string | number | null | undefined): number {
  if (typeof input === 'number') return isFinite(input) ? input : 0
  const t = String(input ?? '')
    .trim()
    .replace(/[,\s]/g, '') // strip thousands separators and spaces; dot stays decimal
  const n = parseFloat(t)
  return isFinite(n) ? n : 0
}

export function parseAmountNL(input: string | number | null | undefined): number {
  if (typeof input === 'number') return isFinite(input) ? input : 0
  let t = String(input ?? '').trim()
  if (!t) return 0

  const hasComma = t.includes(',')
  const hasDot = t.includes('.')

  if (hasComma && hasDot) {
    // Whichever comes last is the decimal separator.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) {
      t = t.replace(/\./g, '').replace(',', '.') // Dutch: dot thousands, comma decimal
    } else {
      t = t.replace(/,/g, '') // English: comma thousands, dot decimal
    }
  } else if (hasComma) {
    t = t.replace(/\./g, '').replace(',', '.') // comma is the decimal
  } else if (hasDot) {
    const parts = t.split('.')
    const groupingLike =
      parts.length > 1 &&
      parts[0].length >= 1 &&
      parts[0].length <= 3 &&
      parts.slice(1).every((p) => p.length === 3)
    if (groupingLike) t = t.replace(/\./g, '') // dots are thousands separators
    // else: leave the single dot as a decimal point
  }

  const n = parseFloat(t)
  return isFinite(n) ? n : 0
}
