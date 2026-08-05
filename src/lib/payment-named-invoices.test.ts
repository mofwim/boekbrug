// [PAYMENT-NAMES-MISSING] Pure node test — run: npx tsx --test src/lib/payment-named-invoices.test.ts
//
// The real payment, verbatim: ATAPACK Cash & Carry, € 2.265,41,
//
//     "Tweede deel factuur 26302050 , factuur 26302362"
//
// The screen showed "2 facturen" on the card and, underneath, one candidate and a confirm that
// books the whole amount onto 26302050 — because 26302362 had never been imported and the slot
// view counts only numbers that RESOLVE.
//
// So this file holds two things that pull against each other, which is why the rule is evidence
// and not a digit count:
//   · a number the supplier introduced as an invoice counts even when we do not have it;
//   · a PSP hash, a customer number and a postcode still do not.
// Getting the second wrong is not cosmetic: it hides the amount-matched invoice behind rows that
// can never be filled, which is the bug the existing gate was written to prevent.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  namedInvoiceNumbers,
  missingNamedInvoices,
  missingInvoiceNoticeText,
} from './payment-named-invoices'

test('[PAYMENT-NAMES-MISSING] the ATAPACK payment names two invoices, and we hold one', () => {
  const text = 'Tweede deel factuur 26302050 , factuur 26302362'
  const named = namedInvoiceNumbers(text, ['26302050'])

  assert.deepEqual(
    named,
    [{ number: '26302050', known: true }, { number: '26302362', known: false }],
    'both are named; only one is in the administration',
  )
  assert.deepEqual(missingNamedInvoices(named), ['26302362'])

  const notice = missingInvoiceNoticeText(missingNamedInvoices(named))
  assert.match(notice ?? '', /26302362/, 'the owner is told WHICH bill is missing')
  assert.match(notice ?? '', /hele bedrag/, '…and what happens if they confirm anyway')
})

test('[PAYMENT-NAMES-MISSING] the word alone is enough — no anchor needed', () => {
  // Nothing of ours resolves here, and the supplier still said "factuur" out loud.
  const named = namedInvoiceNumbers('betaling factuur 26302362', [])
  assert.deepEqual(named, [{ number: '26302362', known: false }])
})

test('[PAYMENT-NAMES-MISSING] a sibling of the same shape counts, anchored on one we hold', () => {
  // No introducing word on the second number, but a number we DO hold sits beside it with the same
  // digit length — the supplier's own numbering, in the same sentence.
  const named = namedInvoiceNumbers('26302050 26302362', ['26302050'])
  assert.deepEqual(named.map((n) => n.number), ['26302050', '26302362'])
  assert.deepEqual(missingNamedInvoices(named), ['26302362'])

  // Without that anchor the same bare pair says nothing about which is an invoice, so neither
  // unknown run is claimed.
  assert.deepEqual(namedInvoiceNumbers('26302050 26302362', []), [])
})

test('[PAYMENT-NAMES-MISSING] what must NOT be claimed', () => {
  // A PSP / order-gateway reference. The comment on the gate this feeds names it: forcing the slot
  // view on these hid the amount-matched invoice behind rows that could never be filled.
  assert.deepEqual(namedInvoiceNumbers('tr_7WBcRDgU8x order 4821', []), [])

  // Brabant Water: a customer number and a postcode read as "invoices" once. The introducing word
  // is what separates them, and neither has it.
  assert.deepEqual(namedInvoiceNumbers('klantnummer 3070417 5049NM', []), [])

  // A date is not an invoice number, however invoice-shaped.
  assert.deepEqual(namedInvoiceNumbers('betaling 20260620', []), [])

  // Empty in, empty out.
  assert.deepEqual(namedInvoiceNumbers('', ['26302050']), [])
  assert.deepEqual(namedInvoiceNumbers(null, []), [])
})

test('[PAYMENT-NAMES-MISSING] one invoice named once is not a batch', () => {
  // The ordinary payment. Nothing here may push the card into the multi-invoice view.
  const named = namedInvoiceNumbers('factuur 26302050', ['26302050'])
  assert.deepEqual(named, [{ number: '26302050', known: true }])
  assert.deepEqual(missingNamedInvoices(named), [])
  assert.equal(missingInvoiceNoticeText([]), null, 'and nothing is said when nothing is missing')
})

test('[PAYMENT-NAMES-MISSING] a number is never counted twice, in either direction', () => {
  // The same number written twice is one invoice, and a run that is a FRAGMENT of one already
  // listed is not a second one either.
  assert.deepEqual(
    namedInvoiceNumbers('factuur 26302050 factuur 26302050', ['26302050']).length, 1,
  )
  assert.deepEqual(
    namedInvoiceNumbers('factuur 260302050 en 0302050', ['260302050']).map((n) => n.number),
    ['260302050'],
    'a substring of a number we already have is not a second invoice',
  )
})

test('[PAYMENT-NAMES-MISSING] the notice names every missing bill, not just the first', () => {
  const text = 'factuur 26302050 , factuur 26302362 , factuur 26302999'
  const missing = missingNamedInvoices(namedInvoiceNumbers(text, ['26302050']))
  assert.deepEqual(missing, ['26302362', '26302999'])
  const notice = missingInvoiceNoticeText(missing) ?? ''
  assert.match(notice, /26302362 en 26302999/)
  assert.match(notice, /staan niet in je administratie/, 'plural, so the sentence reads correctly')
})
