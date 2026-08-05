// src/lib/date-field-nl.ts
// [DATE-NL] A date the owner TYPES, in the order they read it. Pure.
//
// ── WHY A NATIVE <input type="date"> IS NOT ENOUGH HERE ──
// Chromium renders that control's segments in the order of the BROWSER's locale, and nothing on
// the page can change it. Measured, not assumed — `lang="nl-NL"` on the input, on a wrapper, and
// on <html> (which this app already sets) all produce identical output; under an en-US browser the
// first segment is the MONTH in every one of them.
//
// So a Dutch entrepreneur typing "21" for the 21st puts a 2 in the month box, the control decides
// no month starts with 2 except 02, fills it in and jumps — and they cannot type a two-digit day at
// all. That is the complaint. The quieter half is worse: the field then reads 02/01/2026, which is
// 1 February to the browser and 2 January to the person looking at it, and neither of them says so.
//
// Under the kasstelsel the payment date decides which quarter the BTW lands in. A month typed into
// a day is not a cosmetic slip there; near a quarter boundary it moves money between two aangiftes.
//
// ── WHAT THIS DOES INSTEAD ──
// Dutch order, always, whatever the browser thinks: dd-mm-jjjj, separators inserted while typing,
// parsed by the app's own normalizeToIso — the same parser the import paths use, so a date typed on
// screen and a date read off a PDF can never be understood two different ways.
//
// And it says back what it understood, in words. "21-01-2026" is unambiguous once written; while
// it is half-typed it is not, and an owner who can see "woensdag 21 januari 2026" appear under
// their fingers catches a wrong month before they save it rather than a quarter later.
//
// The separator is only inserted once there is a digit AFTER it, so backspace walks back through
// the field the way it should instead of fighting a separator that reappears.

import { normalizeToIso } from '@/lib/safecore'

/** The mask the owner sees, and the order this whole module is about. */
export const DUTCH_DATE_PLACEHOLDER = 'dd-mm-jjjj'

/**
 * Format what the owner has typed so far as dd-mm-jjjj.
 *
 * Digits only; everything else is dropped, so pasting "21/01/2026" or "21.01.2026" lands correctly.
 * Capped at eight digits — a ninth keystroke is a typo, not a longer year.
 */
export function formatDutchDateInput(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '').slice(0, 8)
  // A separator is added only when something follows it. Adding it eagerly after the 2nd digit
  // means backspace deletes the separator, the formatter puts it straight back, and the field
  // becomes impossible to correct.
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
}

/**
 * dd-mm-jjjj → ISO "YYYY-MM-DD", or null while it is incomplete or impossible.
 *
 * Delegates to normalizeToIso: one parser for dates typed on screen and dates read off a document,
 * so "31-02-2026" is rejected in both places for the same reason and by the same code.
 */
export function dutchDateToIso(display: string | null | undefined): string | null {
  const s = (display ?? '').trim()
  if (!/^\d{2}-\d{2}-\d{4}$/.test(s)) return null
  return normalizeToIso(s)
}

/** ISO → dd-mm-jjjj, for seeding the field from a stored value. Empty when there is nothing. */
export function isoToDutchDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

/**
 * "woensdag 21 januari 2026" — what we understood, said back to the person who typed it.
 *
 * This is the honest half of the field. The digits alone cannot show a month typed into a day; the
 * weekday and the month NAME can, at a glance, before it is saved.
 */
export function dutchDateInWords(iso: string | null | undefined): string | null {
  const s = (iso ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(d)
}

/**
 * The bounds the native control used to enforce through its picker.
 *
 * A text field enforces nothing by itself, so dropping these would quietly widen what can be
 * saved — a payment date in 1970 or next year, on the one field that decides a BTW quarter.
 * Returns a Dutch reason, or null when the date is fine or not yet parseable.
 */
export function dutchDateOutOfRange(
  iso: string | null,
  min?: string | null,
  max?: string | null,
): string | null {
  if (!iso) return null
  if (min && iso < min) return `Die datum ligt vóór ${isoToDutchDate(min)} — controleer het jaartal.`
  if (max && iso > max) return `Die datum ligt in de toekomst (na ${isoToDutchDate(max)}).`
  return null
}
