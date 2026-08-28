// src/lib/pay-block.test.ts
// Run: npx tsx --test src/lib/pay-block.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPayBlock } from './pay-block'

test('[BETAALBLOK] the block carries the link, the account and the reference', () => {
  const block = buildPayBlock({
    payUrl: 'https://boekbrug.nl/pay/2f1c0f9e-0000-4000-8000-000000000001',
    iban: 'NL91ABNA0417164300',
    beneficiaryName: 'Kapsalon Karim',
    amount: 2420,
    reference: '2026-014',
  })
  assert.ok(block)
  // The one action that needs no typing, and the only one that works on the phone reading the mail.
  assert.match(block.html, /href="https:\/\/boekbrug\.nl\/pay\/2f1c0f9e-0000-4000-8000-000000000001"/)
  assert.match(block.html, /Betaal deze factuur/)
  // …and the details for whoever pays from their own banking app.
  assert.match(block.html, /NL91ABNA0417164300/)
  assert.match(block.html, /Kapsalon Karim/)
  assert.match(block.html, /2026-014/)
  assert.match(block.html, /€\s?2\.420,00/)
  // The plain-text twin says the same things. A mail with only HTML scores worse with spam filters,
  // and this is the mail that MUST arrive.
  assert.deepEqual(block.textLines, [
    'Betalen',
    'https://boekbrug.nl/pay/2f1c0f9e-0000-4000-8000-000000000001',
    'IBAN: NL91ABNA0417164300',
    'Ten name van: Kapsalon Karim',
    'Bedrag: € 2.420,00',
    'Kenmerk: 2026-014',
  ])
})

test('[BETAALBLOK] an owner with no IBAN and no link gets no block at all', () => {
  // A "Betalen" heading over an empty box reads as something that failed to load — worse than the
  // silence this mail had before.
  assert.equal(buildPayBlock({}), null)
  assert.equal(buildPayBlock({ iban: '   ', payUrl: '' }), null)
})

test('[BETAALBLOK] half the facts is still a block', () => {
  // An owner without a stored IBAN can still have a pay page (Mollie, or the page itself asks).
  const alleenLink = buildPayBlock({ payUrl: 'https://boekbrug.nl/pay/abc', amount: 100 })
  assert.ok(alleenLink)
  assert.match(alleenLink.html, /Betaal deze factuur/)
  assert.doesNotMatch(alleenLink.html, /IBAN/)

  // And an owner whose invoice never got a token still hands over an account number.
  const alleenIban = buildPayBlock({ iban: 'NL91ABNA0417164300', reference: '2026-014' })
  assert.ok(alleenIban)
  assert.doesNotMatch(alleenIban.html, /Betaal deze factuur/)
  assert.match(alleenIban.html, /NL91ABNA0417164300/)
})

test('[BETAALBLOK] only an absolute https URL becomes a link', () => {
  // This string is pasted straight into an anchor in an e-mail. A caller that hands over a path,
  // or something javascript-shaped, must not be able to make a link out of it here — the block
  // falls back to the details it can vouch for.
  for (const bad of ['javascript:alert(1)', 'http://boekbrug.nl/pay/x', '/pay/x', 'https://a b/c']) {
    const block = buildPayBlock({ payUrl: bad, iban: 'NL91ABNA0417164300' })
    assert.ok(block, `${bad}: the IBAN half still stands`)
    assert.doesNotMatch(block.html, /Betaal deze factuur/, `${bad} was turned into a button`)
    assert.ok(!block.textLines.includes(bad), `${bad} reached the text part`)
  }
})

test('[BETAALBLOK] the amount is what is still OPEN, and zero is not an amount', () => {
  // A reminder asks for the remainder, never the original total — the caller passes that in. What
  // this file must not do is print "€ 0,00" beside a payment instruction.
  const block = buildPayBlock({ iban: 'NL91ABNA0417164300', amount: 0, reference: 'X' })
  assert.ok(block)
  assert.doesNotMatch(block.html, /Bedrag/)
  assert.ok(!block.textLines.some((l) => l.startsWith('Bedrag')))

  const half = buildPayBlock({ iban: 'NL91ABNA0417164300', amount: 460 })
  assert.match(half!.html, /€\s?460,00/)
})

test('[BETAALBLOK] a customer name cannot smuggle markup into the mail', () => {
  const block = buildPayBlock({
    iban: 'NL91ABNA0417164300',
    beneficiaryName: '<script>alert(1)</script>',
    reference: '2026-014" onmouseover="x',
  })
  assert.ok(block)
  assert.doesNotMatch(block.html, /<script>/)
  assert.doesNotMatch(block.html, /onmouseover="x/)
})
