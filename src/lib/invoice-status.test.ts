// [STATUS] Pure node test — run: npx tsx --test src/lib/invoice-status.test.ts
//
// Eleven files carried their own copy of these labels and colours, and they had drifted on four
// of the statuses. This test does not re-check that there is one copy — the [STATUS] gate does
// that. It pins the decisions the consolidation had to MAKE, because each one silently changed a
// word or a colour somewhere in the app and each one needs to be defensible a year from now.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { INVOICE_STATUSES, isInvoiceStatus, statusChip, statusLabel } from './invoice-status'
import { LOCALES, type Locale } from './i18n/locale'

test('[STATUS] every status has a word in Dutch, and it is not the raw key', () => {
  for (const s of INVOICE_STATUSES) {
    const label = statusLabel(s)
    assert.ok(label.length > 0, `${s} has no label`)
    assert.ok(!label.includes('status.'), `${s} rendered its key: ${label}`)
    assert.notEqual(label, s, `${s} rendered the database value`)
  }
})

test('[STATUS] the four words that eleven copies disagreed about', () => {
  // Each of these had two or three versions in the wild. Pinned with the reason, because the
  // losing word is still the "obvious" one to someone editing one screen.
  //
  //   sent        Verzonden / Verstuurd            → the filter tab says Verzonden
  //   overdue     Verlopen / Te laat               → five files to one, and the tab again
  //   processing  Te verifiëren / In behandeling   → names what is waiting: a human check
  //   received    Ontvangen / Te betalen           → what the owner must DO, not what arrived
  assert.equal(statusLabel('sent'), 'Verzonden')
  assert.equal(statusLabel('overdue'), 'Verlopen')
  assert.equal(statusLabel('processing'), 'Te verifiëren')
  assert.equal(statusLabel('received'), 'Te betalen')
})

test('[STATUS] an unpaid incoming bill does not look settled', () => {
  // The one disagreement that was about MEANING. One file chipped 'received' the same blue as
  // 'sent' — which reads as done — while another used amber and wrote down why: this is a bill
  // you still owe. Amber won. If this ever flips back, a screen full of unpaid supplier invoices
  // turns the colour of "handled".
  const received = statusChip('received')
  const sent = statusChip('sent')
  const paid = statusChip('paid')
  assert.equal(received.bg, '#FEF7E0')
  assert.notEqual(received.bg, sent.bg, 'an unpaid bill may not wear the colour of a sent one')
  assert.notEqual(received.bg, paid.bg, 'nor of a paid one')
})

test('[STATUS] the label and the colours arrive together', () => {
  // The point of statusChip over two lookups: a screen cannot take the word from here and the
  // colour from a local copy, which is exactly how eleven copies came to exist.
  const chip = statusChip('paid')
  assert.deepEqual(chip, { label: 'Betaald', bg: '#CEEAD6', color: '#137333' })
})

test('[STATUS] an unknown status is shown, not hidden', () => {
  // A status this module does not know is a database value that arrived from somewhere new.
  // Printing it is how that gets noticed; "—" would hide it and an empty chip reads as a bug.
  assert.equal(isInvoiceStatus('archived'), false)
  assert.equal(statusLabel('archived'), 'archived')
  const chip = statusChip('archived')
  assert.equal(chip.label, 'archived')
  assert.equal(chip.bg, '#f1f3f4', 'and it falls back to the neutral chip, not to a colour')
  // Nothing at all still renders nothing, rather than the word "undefined".
  assert.equal(statusLabel(null), '')
  assert.equal(statusLabel(undefined), '')
})

test('[STATUS] every status reads in Arabic, and none of them falls through to Dutch', () => {
  // The whole reason this module exists. Eleven copies meant eleven places to translate, so the
  // honest prediction was that two would get done. A status still showing Dutch here means the
  // catalogue is missing a key — which is a silent gap, since the fallback is by design invisible.
  for (const s of INVOICE_STATUSES) {
    const ar = statusLabel(s, 'ar')
    assert.notEqual(ar, statusLabel(s, 'nl'), `${s} has no Arabic — it fell back to Dutch`)
    assert.ok(/[؀-ۿ]/.test(ar), `${s} is not Arabic script: ${ar}`)
  }
})

test('[STATUS] the colours never move with the language', () => {
  // A chip is the same chip in every language; only the word changes. This would break the moment
  // someone put a colour in the catalogue.
  for (const s of INVOICE_STATUSES) {
    const nl = statusChip(s, 'nl')
    for (const l of LOCALES as Locale[]) {
      const other = statusChip(s, l)
      assert.equal(other.bg, nl.bg, `${s} changes background in ${l}`)
      assert.equal(other.color, nl.color, `${s} changes text colour in ${l}`)
    }
  }
})
