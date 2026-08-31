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
//
// ── [PARSE-STRIKT] TOLERANT IS NOT THE SAME AS PREFIX-TOLERANT ─────────────────────────────────
//
// Both parsers ended in `parseFloat(t)`, and parseFloat reads the longest numeric PREFIX and
// silently discards the rest. So a token that is not a number came back as one:
//
//     parseAmountNL("-1.#INF")  ->  -1        (parseFloat stops at '#', leaving "-1.")
//     parseAmountNL("1.#IND")   ->   1
//     parseAmountNL("12abc")    ->  12
//     parseAmountNL("1,2,3")    ->   1.2
//
// `-1.#INF` is not hypothetical and not ours: it is how the Microsoft C runtime prints negative
// infinity, and it appears IN THE PRICE COLUMN of real supplier invoices whose own system divided
// by a zero quantity. The app then read the supplier's crash as the amount minus one euro. It
// reaches money by two doors: the owner copying the figure off the PDF into a correction field,
// and ocrAmountValues, which feeds this parser every transcribed token and offers what comes back
// as a candidate total.
//
// The second one was worse and had nothing to do with garbage:
//
//     parseAmountNL("1 250,00") ->   1        (parseFloat stops at the space)
//
// A space is an ordinary thousands separator in this trade — bank exports and supplier templates
// print it constantly — so a real, correctly-typed amount was read 1250x too small, silently, in
// every money field on the app.
//
// The rule now: after normalising, the WHOLE token must be a number, or the value is unreadable
// and answers 0 exactly as "abc" always did. What that deliberately keeps: the mid-keystroke forms
// ("95," while typing) the draft pattern depends on. What it adds: a space that really groups by
// threes, a currency symbol, and the accounting trailing minus — which used to come back POSITIVE,
// the one failure here worse than refusing to read at all.


/** Currency the owner leaves in the field. Not a digit, never part of the value. */
const CURRENCY = /[\u20AC$\u00A3]|EUR/gi

/** Every space that can carry a thousands group, including NBSP and the narrow ones. */
const SPACE = /[\s\u00A0\u202F\u2007]+/

/**
 * The shape a normalised amount must have, or it is not a number.
 *
 * A trailing decimal separator with no digits after it is allowed ON PURPOSE: the money fields
 * parse on every keystroke, so "95," passes through here mid-typing and must stay 95 rather than
 * blanking the field the owner is halfway through.
 */
const WHOLE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * Strip a leading/trailing currency symbol, and whitespace that is really a thousands separator.
 *
 * "1 250,00" is 1250,00 and is stripped. "12 34" is not a number at all: it stays as it is, fails
 * WHOLE_NUMBER, and reads as unreadable — which is the honest answer, and better than the 1234 a
 * blanket strip would invent.
 *
 * Returns null when the token cannot be a number at all.
 */
function normalise(raw: string): string | null {
  const t = raw.replace(CURRENCY, '').trim()
  if (!t) return null
  if (!SPACE.test(t)) return t

  const groups = t.split(SPACE)
  const grouped =
    groups.length > 1 &&
    /^[+-]?\d{1,3}$/.test(groups[0]) &&
    groups.slice(1, -1).every((g) => /^\d{3}$/.test(g)) &&
    /^\d{3}(?:[.,]\d*)?$/.test(groups[groups.length - 1])
  return grouped ? groups.join('') : null
}

/**
 * The accounting minus, which is written AFTER the number on bank exports and on plenty of
 * supplier templates. It used to be dropped by parseFloat and the amount came back POSITIVE — a
 * refund read as a charge, which is the one outcome worse than not reading the field.
 */
function trailingMinus(t: string): { body: string; sign: 1 | -1 } {
  if (!t.endsWith('-')) return { body: t, sign: 1 }
  const body = t.slice(0, -1)
  // "-5,00-" is not an accounting minus, it is a typo. Refuse rather than guess which one wins.
  if (body.startsWith('-')) return { body: '\u0000', sign: 1 }
  return { body, sign: -1 }
}

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
  const raw = String(input ?? '').trim()
  if (!raw) return 0
  const { body, sign } = trailingMinus(raw)
  // Comma is the thousands separator here, so it goes before the space rule ever sees the token;
  // a space groups the same way it does in Dutch.
  const cleaned = normalise(body.replace(/,/g, ''))
  if (cleaned === null) return 0
  // [PARSE-STRIKT] The whole token, or nothing. parseFloat's prefix tolerance read "-1.#INF" as -1.
  if (!WHOLE_NUMBER.test(cleaned)) return 0
  const n = parseFloat(cleaned)
  return isFinite(n) ? sign * n : 0
}

export function parseAmountNL(input: string | number | null | undefined): number {
  if (typeof input === 'number') return isFinite(input) ? input : 0
  const raw = String(input ?? '').trim()
  if (!raw) return 0

  const { body, sign } = trailingMinus(raw)
  const cleaned = normalise(body)
  if (cleaned === null) return 0
  let t = cleaned

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

  // [PARSE-STRIKT] The whole token, or nothing — see the header. This is the line that stops a
  // supplier's "-1.#INF" from being read as minus one euro.
  if (!WHOLE_NUMBER.test(t)) return 0
  const n = parseFloat(t)
  return isFinite(n) ? sign * n : 0
}
