// [REREAD-CONFIRMED] Pure node test — run: npx tsx --test src/lib/reimport-eligibility.test.ts
//
// Two things are held here, and they pull against each other, which is why the rule is one
// function instead of a condition repeated in three places:
//
//   · a CONFIRMED, UNPAID purchase invoice may be read again — that is the whole point, because it
//     is the moment a misread amount is about to be paid;
//   · and nothing that carries money, or that the accountant has processed, ever may.
//
// The third property is the one a reviewer skips: a re-read of a confirmed invoice must ANNOUNCE
// that it goes back to the queue. An invoice vanishing off the pay list without warning reads like
// it was lost, and an owner who thinks the app lost a bill stops trusting the list.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { reimportDecision, reimportPromptText, type ReimportInvoice } from './reimport-eligibility'

const inv = (o: Partial<ReimportInvoice> = {}): ReimportInvoice => ({
  direction: 'incoming',
  status: 'processing',
  amount_paid: 0,
  accountant_status: null,
  pdf_url: 'u1/facturen/26701681.pdf',
  ...o,
})

test('[REREAD-CONFIRMED] a confirmed, unpaid invoice may be read again — and says where it goes', () => {
  // Enka Horeca 26701681: on the pay list, € 0,46 of btw wrong, not paid yet. The old guard
  // refused exactly here, which left "type the numbers yourself" as the only way out on an invoice
  // whose paper the app is holding.
  const d = reimportDecision(inv({ status: 'received' }))
  assert.deepEqual(d, { allowed: true, returnsToQueue: true })
  assert.match(
    reimportPromptText(d) ?? '', /controlewachtrij/,
    'the consequence is announced before the tap — an invoice leaving the pay list unannounced ' +
      'reads like a lost bill',
  )
})

test('[REREAD-CONFIRMED] a queued invoice still qualifies, and stays where it is', () => {
  const d = reimportDecision(inv({ status: 'processing' }))
  assert.deepEqual(d, { allowed: true, returnsToQueue: false })
  assert.doesNotMatch(reimportPromptText(d) ?? '', /controlewachtrij/, 'it is already there')
})

test('[REREAD-CONFIRMED] money outranks everything', () => {
  // Changing the total of an invoice that carries payments breaks
  // amount_paid = Σ bank_tx_invoices.amount_applied, and can leave a row paid for more than it is
  // worth. Both shapes refuse: the status, and a partial amount under a status that has not caught
  // up with it.
  for (const over of [{ status: 'paid' }, { amount_paid: 250 }, { status: 'received', amount_paid: 0.5 }]) {
    const d = reimportDecision(inv(over))
    assert.equal(d.allowed, false, `${JSON.stringify(over)} must be refused`)
    if (d.allowed) return
    assert.equal(d.reason, 'money_booked')
    assert.match(d.message, /terugdraaien|terug/, 'and it says what to do first')
  }

  // A cent of float noise is not a payment.
  assert.equal(reimportDecision(inv({ status: 'received', amount_paid: 0.004 })).allowed, true)
})

test('[REREAD-CONFIRMED] the accountant\'s work and the ignored pile are not ours to overwrite', () => {
  const locked = reimportDecision(inv({ status: 'received', accountant_status: 'verwerkt' }))
  assert.equal(locked.allowed, false)
  if (!locked.allowed) assert.equal(locked.reason, 'accountant_locked')

  // Re-reading an archived row would silently revive a purchase the owner discarded.
  const archived = reimportDecision(inv({ status: 'archived' }))
  assert.equal(archived.allowed, false)
  if (!archived.allowed) assert.equal(archived.reason, 'archived')
})

test('[REREAD-CONFIRMED] nothing to read, nothing to offer', () => {
  const noFile = reimportDecision(inv({ pdf_url: null, document_id: null }))
  assert.equal(noFile.allowed, false)
  if (!noFile.allowed) assert.equal(noFile.reason, 'no_file')

  // Either column may carry the file depending on which door the invoice came through.
  assert.equal(reimportDecision(inv({ pdf_url: null, document_id: 'doc-1' })).allowed, true)

  const outgoing = reimportDecision(inv({ direction: 'outgoing' }))
  assert.equal(outgoing.allowed, false)
  if (!outgoing.allowed) assert.equal(outgoing.reason, 'not_incoming')
})

test('[REREAD-CONFIRMED] every refusal carries a sentence the owner can act on', () => {
  // A greyed-out button with no reason is the same as a broken one. Whatever is added here later
  // must keep saying WHY, and where possible what to do first.
  const refusals: ReimportInvoice[] = [
    { direction: 'outgoing' },
    { direction: 'incoming', pdf_url: null },
    { direction: 'incoming', pdf_url: 'x', status: 'paid' },
    { direction: 'incoming', pdf_url: 'x', status: 'received', accountant_status: 'verwerkt' },
    { direction: 'incoming', pdf_url: 'x', status: 'archived' },
    { direction: 'incoming', pdf_url: 'x', status: 'draft' },
  ]
  for (const r of refusals) {
    const d = reimportDecision(r)
    assert.equal(d.allowed, false, JSON.stringify(r))
    if (d.allowed) return
    assert.ok(d.message.length > 20, `${d.reason} has no usable message`)
    assert.doesNotMatch(d.message, /[a-z]+_[a-z]+/, `${d.reason} leaks a field name at the owner`)
  }
})
