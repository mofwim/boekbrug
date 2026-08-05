// [DATE-NL] Pure node test — run: npx tsx --test src/lib/date-field-nl.test.ts
//
// The bug this replaces was not in our code at all: Chromium orders an <input type="date">'s
// segments by the BROWSER's locale, and no attribute on the page changes it. Measured — `lang` on
// the input, on a wrapper and on <html> all behave identically, and under an en-US browser the
// first segment is the month. So a Dutch owner typing "21" for the 21st fills in a month and the
// caret jumps, and the field then shows 02/01/2026, which is two different dates depending on who
// is reading it.
//
// Under the kasstelsel the payment date picks the BTW quarter. Near a quarter boundary that is not
// a cosmetic slip.
//
// What is held here: the Dutch order, a two-digit day that can actually be typed, a backspace that
// walks backwards, and the bounds the native control used to enforce for free.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatDutchDateInput,
  dutchDateToIso,
  isoToDutchDate,
  dutchDateInWords,
  dutchDateOutOfRange,
} from './date-field-nl'

test('[DATE-NL] a two-digit day can be typed — the whole complaint', () => {
  // Keystroke by keystroke: 2, 1, 0, 1, 2, 0, 2, 6. Nothing jumps, nothing is decided early.
  const keys = '21012026'
  const seen: string[] = []
  for (let i = 1; i <= keys.length; i++) seen.push(formatDutchDateInput(keys.slice(0, i)))
  assert.deepEqual(seen, [
    '2', '21', '21-0', '21-01', '21-01-2', '21-01-20', '21-01-202', '21-01-2026',
  ])
  assert.equal(dutchDateToIso(seen[seen.length - 1]), '2026-01-21', 'and it means the 21st of January')
})

test('[DATE-NL] backspace walks backwards instead of fighting a separator', () => {
  // The reason the separator is only added once a digit follows it. Insert it eagerly after two
  // digits and deleting it puts it straight back, so the field cannot be corrected at all.
  assert.equal(formatDutchDateInput('21'), '21', 'no trailing separator to get stuck on')
  assert.equal(formatDutchDateInput('21-0'), '21-0')
  // Deleting the '0' leaves '21-', whose digits are '21' → back to '21'.
  assert.equal(formatDutchDateInput('21-'), '21')
  assert.equal(formatDutchDateInput('2'), '2')
  assert.equal(formatDutchDateInput(''), '')
})

test('[DATE-NL] a pasted date in any punctuation lands correctly', () => {
  for (const pasted of ['21/01/2026', '21.01.2026', '21-01-2026', '21 01 2026']) {
    assert.equal(formatDutchDateInput(pasted), '21-01-2026', pasted)
  }
  // A ninth digit is a typo, not a longer year.
  assert.equal(formatDutchDateInput('210120261'), '21-01-2026')
})

test('[DATE-NL] an impossible date is refused by the SAME parser the import path uses', () => {
  // One parser for a date typed on screen and a date read off a PDF, so 31 February is rejected in
  // both places for the same reason rather than by two rules that can drift.
  assert.equal(dutchDateToIso('31-02-2026'), null, '31 February does not exist')
  assert.equal(dutchDateToIso('00-01-2026'), null)
  assert.equal(dutchDateToIso('21-13-2026'), null, 'there is no thirteenth month')
  // Incomplete is not wrong — it is just not finished, and must not flash an error mid-typing.
  assert.equal(dutchDateToIso('21-01-20'), null)
  assert.equal(dutchDateToIso(''), null)
})

test('[DATE-NL] round-trips with the stored ISO value', () => {
  assert.equal(isoToDutchDate('2026-01-21'), '21-01-2026')
  assert.equal(isoToDutchDate('2026-01-21T10:00:00Z'), '21-01-2026', 'a timestamp is still a date')
  assert.equal(isoToDutchDate(null), '', 'nothing stored is an empty field, never a fabricated today')
  assert.equal(dutchDateToIso(isoToDutchDate('2026-12-31')), '2026-12-31')
})

test('[DATE-NL] it says back what it understood, in words', () => {
  // The half that catches a month typed into a day. Digits alone cannot show it; a weekday and a
  // month NAME can, at a glance, before it is saved.
  assert.equal(dutchDateInWords('2026-01-21'), 'woensdag 21 januari 2026')
  // The ambiguous pair from the screenshot, told apart out loud.
  assert.equal(dutchDateInWords('2026-01-02'), 'vrijdag 2 januari 2026')
  assert.equal(dutchDateInWords('2026-02-01'), 'zondag 1 februari 2026')
  assert.equal(dutchDateInWords(null), null)
  assert.equal(dutchDateInWords('21-01-2026'), null, 'it takes ISO, never the display form')
})

test('[DATE-NL] the bounds the native picker used to enforce are not lost', () => {
  // A text field enforces nothing by itself. Dropping min/max would quietly widen what can be
  // saved on the one field that decides a BTW quarter.
  const MIN = '2020-01-01'
  const MAX = '2026-08-05'
  assert.equal(dutchDateOutOfRange('2026-03-01', MIN, MAX), null, 'an ordinary date passes')
  assert.match(dutchDateOutOfRange('1970-01-01', MIN, MAX) ?? '', /vóór/, 'a mistyped year is caught')
  assert.match(dutchDateOutOfRange('2027-01-01', MIN, MAX) ?? '', /toekomst/, 'so is a future payment')
  // Mid-typing there is nothing to judge yet, and an error flashing while someone types is noise.
  assert.equal(dutchDateOutOfRange(null, MIN, MAX), null)
  // No bounds given → nothing to say.
  assert.equal(dutchDateOutOfRange('1970-01-01'), null)
})
