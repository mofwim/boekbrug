// [BETAALBEWIJS] Pure node test — run: npx tsx --test src/lib/payment-evidence.test.ts
//
// The pay screen has always shown "Betaald" and never once read bank_tx_invoices, so the word
// carried no evidence: to check it the owner had to open their bank in another tab — the work the
// app exists to remove, handed back at the exact moment trust is being asked for.
//
// Held here: that the three kinds of claim stay THREE, and that the one the app cannot answer
// never borrows the language of the ones it can.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyPayment, describePayment, isBankProven, type PaymentLink } from './payment-evidence'

const bankLink = (over: Partial<PaymentLink> = {}): PaymentLink => ({
  transactionId: 'tx-1',
  amountApplied: 1224.75,
  paidOn: '2026-08-20',
  method: 'bank',
  transaction: {
    date: '2026-08-20', amount: -1224.75,
    description: 'FACTUUR 264091 BALKIP', counterpartName: 'BALKIP B.V.',
    counterpartIban: 'NL48INGB0000810658',
  },
  ...over,
})

const handLink = (over: Partial<PaymentLink> = {}): PaymentLink => ({
  transactionId: null, amountApplied: 1224.75, paidOn: '2026-08-20', method: 'bank',
  transaction: null, ...over,
})

test('[BETAALBEWIJS] a bank-proven payment quotes the statement the owner recognises', () => {
  const ev = classifyPayment([bankLink()])
  assert.equal(ev.kind, 'bank')
  assert.equal(isBankProven(ev), true)
  const text = describePayment(ev)
  assert.match(text, /€\s?1\.224,75/)
  assert.match(text, /20 augustus 2026/)
  assert.match(text, /BALKIP B\.V\./)
  assert.match(text, /"FACTUUR 264091 BALKIP"/, 'verbatim — recognition is the whole mechanism')
})

test('[BETAALBEWIJS] a hand-recorded payment says so, and does not borrow the bank', () => {
  // Usually perfectly true. It is simply not the same claim, and rendering the two identically
  // lends a third party's authority to the owner's own memory.
  const ev = classifyPayment([handLink()])
  assert.equal(ev.kind, 'manual')
  assert.equal(isBankProven(ev), false)
  const text = describePayment(ev)
  assert.match(text, /Door jou/)
  assert.match(text, /geen bankregel/)
  assert.doesNotMatch(text, /afgeschreven/, 'nothing was demonstrably debited')
})

test('[BETAALBEWIJS] contant is named as contant', () => {
  assert.match(describePayment(classifyPayment([handLink({ method: 'kas' })])), /contant/)
})

test('[BETAALBEWIJS] part bank, part tick — both halves are said', () => {
  const ev = classifyPayment([bankLink({ amountApplied: 600 }), handLink({ amountApplied: 624.75 })])
  assert.equal(ev.kind, 'mixed')
  assert.equal(isBankProven(ev), true, 'a bank line does carry part of it')
  const text = describePayment(ev)
  assert.match(text, /afgeschreven/)
  assert.match(text, /door jou zelf afgevinkt/i, 'and the other half is not hidden behind it')
})

test('[BETAALBEWIJS] several bank lines are counted, not silently dropped', () => {
  const ev = classifyPayment([bankLink(), bankLink({ transactionId: 'tx-2', amountApplied: 100 })])
  assert.equal(ev.kind, 'bank')
  assert.match(describePayment(ev), /\+ 1 andere betaling/)
})

test('[BETAALBEWIJS] paid with nothing recording how — the app says it does not know', () => {
  // Rare, real, and the case that keeps the other two worth believing.
  const ev = classifyPayment([])
  assert.equal(ev.kind, 'none')
  assert.equal(isBankProven(ev), false)
  assert.match(describePayment(ev), /geen betaling aan gekoppeld/)
})

test('[BETAALBEWIJS] a failed read is NEVER the same answer as "nothing recorded"', () => {
  // The direction that matters: collapsing these two makes a busy database assert that an
  // invoice has no payment evidence.
  const ev = classifyPayment(null)
  assert.equal(ev.kind, 'unknown')
  assert.equal(isBankProven(ev), false)
  assert.match(describePayment(ev), /konden niet nakijken/)
  assert.notEqual(describePayment(ev), describePayment(classifyPayment([])))
})

test('[BETAALBEWIJS] a zero-amount link is not a payment', () => {
  // A link row that applies nothing settles nothing; counting it would make "Betaald" true on an
  // invoice where no money moved.
  assert.equal(classifyPayment([bankLink({ amountApplied: 0 })]).kind, 'none')
})
