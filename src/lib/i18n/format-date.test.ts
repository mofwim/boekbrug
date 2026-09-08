// src/lib/i18n/format-date.test.ts
// [TAAL] The screen's dates follow the owner's language; the digits do not.
// Run: npx tsx --test src/lib/i18n/format-date.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dateInWords, dateShort } from './format-date'

test('[TAAL] the date in words is Dutch for a Dutch owner — unchanged from before', () => {
  assert.equal(dateInWords('2026-01-21', 'nl'), 'woensdag 21 januari 2026')
  assert.equal(dateInWords('2026-09-07', 'nl'), 'maandag 7 september 2026')
})

test('[TAAL] the same date reads in the language the owner picked', () => {
  assert.match(dateInWords('2026-09-07', 'en') ?? '', /^Monday,? 7 September 2026$/)
  assert.match(dateInWords('2026-09-07', 'tr') ?? '', /Eylül/)
  const ar = dateInWords('2026-09-07', 'ar') ?? ''
  assert.match(ar, /سبتمبر/, 'the month is an Arabic word')
  assert.match(ar, /الاثنين/, 'so is the weekday')
})

test('[TAAL] Arabic keeps Latin digits — a year reads the same as on the bank statement', () => {
  const ar = dateInWords('2026-09-07', 'ar') ?? ''
  assert.match(ar, /2026/)
  assert.doesNotMatch(ar, /[٠-٩]/, 'no Eastern Arabic numerals')
  assert.match(dateShort('2026-08-03', 'ar'), /^3 .+ 2026$/)
})

test('[TAAL] an unknown language reads as Dutch, never as a crash', () => {
  assert.equal(dateInWords('2026-09-07', 'xx'), 'maandag 7 september 2026')
  assert.equal(dateInWords('2026-09-07', undefined), 'maandag 7 september 2026')
})

test('[TAAL] the short form is a row-sized date with the month as a word', () => {
  assert.equal(dateShort('2026-08-03', 'nl'), '3 aug 2026')
  assert.equal(dateShort('2026-08-03', 'en'), '3 Aug 2026')
})

test('[TAAL] what is not a date comes back as it was, not as a blank', () => {
  assert.equal(dateInWords('21-01-2026', 'nl'), null, 'it takes ISO, never the display form')
  assert.equal(dateInWords('2026-02-30', 'nl'), null, 'a day the calendar does not have')
  assert.equal(dateInWords(null, 'nl'), null)
  assert.equal(dateShort('garbage', 'nl'), 'garbage')
  assert.equal(dateShort(null, 'nl'), '')
})
