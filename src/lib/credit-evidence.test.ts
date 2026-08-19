// [CREDIT-BEWIJS] Pure node test — run: npx tsx --test src/lib/credit-evidence.test.ts
//
// The third trust layer, on the documents that give money BACK. What is held here is the same
// property as everywhere else in this line of work: a screen may state a conclusion, but it may
// not state it alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildCreditEvidenceLine } from './credit-evidence'
import { creditDetailsFrom, moneyDirection } from './credited-invoices'

test('[CREDIT-SIGN] a creditnota moves money the OTHER way than its document points', () => {
  // The invoices table has one `direction` column and it describes the DOCUMENT: who issued it.
  // For an ordinary invoice that is also the direction of the money, so the two were treated as
  // the same thing. On a creditnota they are opposites, and the evidence line said so out loud: a
  // € 500 refund the owner PAID OUT rendered as "bijgeschreven … van Kiwi Food Market" beside a
  // bank line of −500. Money leaving, described as money arriving.
  assert.equal(moneyDirection({ direction: 'outgoing', invoice_type: 'factuur', total_inc_btw: 1210 }), 'outgoing')
  assert.equal(moneyDirection({ direction: 'outgoing', invoice_type: 'creditnota', total_inc_btw: -500 }), 'incoming')
  assert.equal(moneyDirection({ direction: 'incoming', invoice_type: 'factuur', total_inc_btw: 1210 }), 'incoming')
  assert.equal(moneyDirection({ direction: 'incoming', invoice_type: 'creditnota', total_inc_btw: -500 }), 'outgoing')

  // A row can carry the SIGN before anyone has set the type — an AI read, an import — and the
  // screens already treat a negative total as a credit. This has to agree with them, or the badge
  // and the sentence under it describe two different documents.
  assert.equal(moneyDirection({ direction: 'outgoing', invoice_type: null, total_inc_btw: -500 }), 'incoming')
  // An absent direction is an outgoing document: that is what the sales list holds, and it is the
  // side where guessing wrong would put a refund in the owner's income.
  assert.equal(moneyDirection({ invoice_type: 'factuur', total_inc_btw: 100 }), 'outgoing')
})

test('[CREDIT-BEWIJS] the chip states an amount; this states the documents behind it', () => {
  // "Deels gecrediteerd · € 250" is a conclusion the owner can only check by going to find the
  // credit notes. Unlike a bank line these are papers THEY sent, each with a number an accountant
  // asks about — so the app was already holding this and simply never showed it.
  const line = buildCreditEvidenceLine([
    { invoiceNumber: 'CR-2026-004', invoiceDate: '2026-07-20', amount: 100 },
    { invoiceNumber: 'CR-2026-003', invoiceDate: '2026-07-14', amount: 150 },
  ])!
  assert.match(line.lead, /€\s?250,00 teruggegeven met 2 creditnota/)
  assert.equal(line.entries.length, 2)
  assert.match(line.entries[0], /CR-2026-004 · 20 juli 2026 — €\s?100,00/)
  assert.match(line.entries[1], /CR-2026-003 · 14 juli 2026 — €\s?150,00/)

  // One credit reads as one, not as "1 creditnota's".
  assert.match(
    buildCreditEvidenceLine([{ invoiceNumber: 'CR-1', invoiceDate: '2026-07-01', amount: 50 }])!.lead,
    /met 1 creditnota:/,
  )
  // An invoice with no credits gets NO line — the row looks exactly as it did before this existed,
  // which is the only honest thing to say about a document that was never written.
  assert.equal(buildCreditEvidenceLine([]), null)
  assert.equal(buildCreditEvidenceLine(undefined), null)

  // A creditnota still in concept has no number, and that is the truth rather than a gap: the
  // number falls when it is sent (Art. 35).
  assert.match(
    buildCreditEvidenceLine([{ invoiceNumber: null, invoiceDate: null, amount: 50 }])!.entries[0],
    /Concept — nog geen nummer/,
  )
  // The direction travels with the words, so a component cannot render the two out of step.
  assert.equal(line.dir, 'ltr')
  assert.equal(buildCreditEvidenceLine([{ invoiceNumber: 'CR-1', invoiceDate: null, amount: 5 }], 'ar')!.dir, 'rtl')
})

test('[CREDIT-BEWIJS] the details are the same rows the total is built from', () => {
  // Two spellings of "what was credited" is how the chip and the list under it come to disagree.
  // creditDetailsFrom reads exactly what creditedTotalsFrom reads, and drops exactly what it
  // drops: a credit with no original is attached to nothing and belongs to no invoice.
  const rows = [
    { original_invoice_id: 'a', total_inc_btw: -100, invoice_number: 'CR-2', invoice_date: '2026-07-20' },
    { original_invoice_id: 'a', total_inc_btw: -150, invoice_number: 'CR-1', invoice_date: '2026-07-14' },
    { original_invoice_id: null, total_inc_btw: -999, invoice_number: 'CR-X', invoice_date: '2026-07-30' },
    { original_invoice_id: 'b', total_inc_btw: 0, invoice_number: 'CR-0', invoice_date: '2026-07-01' },
  ]
  const details = creditDetailsFrom(rows)
  assert.equal(details.get('a')!.length, 2)
  assert.equal(details.has('b'), false, 'a credit of nothing gives nothing back')
  assert.equal([...details.keys()].includes('null'), false)

  // Newest first: the credit the owner is looking for is the last one they sent.
  assert.equal(details.get('a')![0].invoiceNumber, 'CR-2')
  // Magnitudes — a creditnota is stored negative, and the question here is how much came back.
  assert.equal(details.get('a')![0].amount, 100)
  // …and the sum of the details equals the amount the chip prints.
  const sum = details.get('a')!.reduce((s, c) => s + c.amount, 0)
  assert.equal(sum, 250)

  // A row with a date-less credit sorts last rather than jumping the queue on an empty string.
  const mixed = creditDetailsFrom([
    { original_invoice_id: 'c', total_inc_btw: -10, invoice_number: 'CR-geen', invoice_date: null },
    { original_invoice_id: 'c', total_inc_btw: -20, invoice_number: 'CR-wel', invoice_date: '2026-01-01' },
  ])
  assert.equal(mixed.get('c')![0].invoiceNumber, 'CR-wel')
})
