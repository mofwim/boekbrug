// src/lib/i18n/format-date.ts
// [TAAL] A calendar date, written the way the OWNER reads it. Pure.
// Run: npx tsx --test src/lib/i18n/format-date.test.ts
//
// WHY THIS IS NOT format-nl.ts
// formatDateNL prints dd-mm-jjjj and belongs to the documents: an invoice PDF is Dutch whatever
// language the owner picked, and those digits go on it. This module is for the SCREEN — the line
// under a date field that says "maandag 7 september 2026" back to the person typing, and the
// date on a row in a list. Both used to be hard-wired to nl-NL, so an Arabic interface read its
// weekdays in Dutch. The month names live in Intl, not in a table per language: four hand-kept
// lists is exactly the kind of thing that stays half finished after the next language.
//
// Digits are Latin in every language (see the `intl` tag in locale.ts): a year has to read the
// same here as on the bank statement next to it.
//
// The date is an ISO "YYYY-MM-DD" and is formatted in UTC. No time zone can move a date-only
// value across midnight that way, which is the whole reason the input is a string and not a Date.

import { LOCALE_META, resolveLocale } from './locale'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function utcDay(iso: string | null | undefined): Date | null {
  const s = (iso ?? '').trim()
  if (!ISO_DAY.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  // "2026-02-30" parses — as 2 March. A date that does not round-trip is not a date.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  return d
}

/**
 * "maandag 7 september 2026" / "Monday 7 September 2026" / "الاثنين 7 سبتمبر 2026".
 *
 * The weekday and the month NAME are the point: digits alone cannot show a month typed into a
 * day, and this line is what catches that before it is saved.
 */
export function dateInWords(iso: string | null | undefined, locale: unknown): string | null {
  const d = utcDay(iso)
  if (!d) return null
  return new Intl.DateTimeFormat(LOCALE_META[resolveLocale(locale)].intl, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(d)
}

/**
 * "3 aug 2026" — short enough for a list row, unambiguous in every language because the month is
 * a word and not a position. Falls back to the ISO string it was given when that is not a date,
 * so a row never goes blank over a value the database accepted.
 */
export function dateShort(iso: string | null | undefined, locale: unknown): string {
  const d = utcDay(iso)
  if (!d) return (iso ?? '').trim()
  return new Intl.DateTimeFormat(LOCALE_META[resolveLocale(locale)].intl, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(d)
}
