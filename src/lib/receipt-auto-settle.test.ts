// [BON-AUTO] Pure node test — run: npx tsx --test src/lib/receipt-auto-settle.test.ts
//
// A kassabon is proof the counter was already paid; that is what makes it a receipt rather than an
// invoice. Both import doors nevertheless switched auto-advance OFF for every bon, because
// auto-advance can only produce 'received' — booked and UNPAID — and that is the one status a
// settled bon must never get.
//
// What is held here is the SHAPE of the automation, and most of it is what it refuses. The kind
// answers "was it paid". Only the printed tender line answers "how", and 'kas' versus 'bank' is
// the difference between a cash drawer that moved and one that did not.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planReceiptSettlement, settleNoticeText, type ReceiptSettleInput } from './receipt-auto-settle'
import { paymentSuggestion } from './intake-router'

const TODAY = '2026-08-06'

const input = (o: Partial<ReceiptSettleInput> = {}): ReceiptSettleInput => ({
  documentKind: 'receipt',
  suggestion: { suggestPaid: true, paidMethod: 'kas', paidMethodZeker: true, paidDate: null },
  invoiceDate: '2026-08-04',
  totalIncBtw: 12.5,
  today: TODAY,
  ...o,
})

test('[BON-AUTO] a bon whose paper says how it was paid books itself', () => {
  // The whole point. The owner photographs a receipt at the counter and the app is finished with
  // it: no queue, no tap, and it never stands in "nog te betalen" for money already gone.
  const plan = planReceiptSettlement(input())
  assert.equal(plan.settle, true)
  assert.equal(plan.method, 'kas')
  assert.equal(plan.payDate, '2026-08-04', "the bon's own date is when the money moved")
  assert.equal(plan.reason, 'bon_tender_cash')
})

test('[BON-AUTO] a card bon settles as bank, not as cash', () => {
  // The consequence is not cosmetic: 'kas' writes a dated kasboek entry and moves the drawer,
  // 'bank' does not. A pinbon booked as cash takes money out of a drawer it never left.
  const plan = planReceiptSettlement(input({
    suggestion: { suggestPaid: true, paidMethod: 'bank', paidMethodZeker: true, paidDate: null },
  }))
  assert.equal(plan.settle, true)
  assert.equal(plan.method, 'bank')
  assert.equal(plan.reason, 'bon_tender_card')
})

test('[BON-AUTO] a silent paper is asked, never guessed', () => {
  // THE GATE. paidMethodZeker is false whenever the tender line was not printed — the method then
  // comes from the model's interpretation, and acting on an interpretation is exactly what this
  // whole import path refuses to do with anything that has consequences.
  const plan = planReceiptSettlement(input({
    suggestion: { suggestPaid: true, paidMethod: 'kas', paidMethodZeker: false, paidDate: null },
  }))
  assert.equal(plan.settle, false)
  assert.equal(plan.reason, 'method_not_printed')
  assert.equal(plan.method, null, 'and it carries no method onward — half a decision is worse')
})

test('[BON-AUTO] "zeker" without an actual method is still not a method', () => {
  // Belt and braces on the two fields that must agree. A true flag beside a null method would
  // reach apply_manual_payment, which RAISES on a method that is not bank|kas — turning a silent
  // hold into a failed import.
  for (const bad of [null, 'pin', 'contant', '', 'BANK'] as unknown[]) {
    const plan = planReceiptSettlement(input({
      suggestion: {
        suggestPaid: true, paidMethod: bad as 'bank' | 'kas' | null,
        paidMethodZeker: true, paidDate: null,
      },
    }))
    assert.equal(plan.settle, false, `method ${String(bad)} must not settle`)
  }
})

test('[BON-AUTO] a pen-marked INVOICE is not a bon and stays in the queue', () => {
  // intake-router calls this suggestPaid too, and it is not the same evidence. A till line is
  // printed by the machine that took the money; a pen mark is a reading of somebody's handwriting
  // on a document whose entire purpose is to ASK for payment.
  const plan = planReceiptSettlement(input({ documentKind: 'invoice' }))
  assert.equal(plan.settle, false)
  assert.equal(plan.reason, 'not_a_receipt')
})

test('[BON-AUTO] a bon the reader explicitly called unpaid is respected', () => {
  const plan = planReceiptSettlement(input({
    suggestion: { suggestPaid: false, paidMethod: null, paidMethodZeker: false, paidDate: null },
  }))
  assert.equal(plan.settle, false)
  assert.equal(plan.reason, 'receipt_read_as_unpaid')
})

test('[BON-AUTO] nothing settles without a real, positive total', () => {
  // apply_manual_payment refuses a zero total outright, and a NEGATIVE one is a creditnota shape:
  // money coming back, which a settlement does not book.
  for (const total of [null, 0, 0.004, -12.5, Number.NaN] as (number | null)[]) {
    const plan = planReceiptSettlement(input({ totalIncBtw: total }))
    assert.equal(plan.settle, false, `total ${String(total)} must not settle`)
    assert.equal(plan.reason, 'no_settleable_total')
  }
})

test('[BON-AUTO] the tender line beats the document date, and junk beats neither', () => {
  const withTender = planReceiptSettlement(input({
    suggestion: { suggestPaid: true, paidMethod: 'kas', paidMethodZeker: true, paidDate: '2026-08-05' },
    invoiceDate: '2026-08-04',
  }))
  assert.equal(withTender.payDate, '2026-08-05')

  // A malformed tender date falls back to the bon's date rather than blocking the settlement.
  const junk = planReceiptSettlement(input({
    suggestion: { suggestPaid: true, paidMethod: 'kas', paidMethodZeker: true, paidDate: '05-08-2026' },
  }))
  assert.equal(junk.payDate, '2026-08-04')

  // With neither, there is no date to file it under — and a kasstelsel quarter needs one.
  const none = planReceiptSettlement(input({ invoiceDate: null }))
  assert.equal(none.settle, false)
  assert.equal(none.reason, 'no_usable_date')
})

test('[BON-AUTO] an impossible payment date is held, by the app\'s ONE definition of impossible', () => {
  // A misread year files the money in a quarter that has not happened, where nothing reconciles it
  // and nobody goes looking; "1926" does the mirror image. Both are refused by the same
  // paymentDateOutOfWindow every other door uses — a second copy of that rule here would drift.
  for (const bad of ['2062-08-04', '1926-07-04', '2026-02-31']) {
    const plan = planReceiptSettlement(input({ invoiceDate: bad }))
    assert.equal(plan.settle, false, `${bad} must not settle`)
    assert.equal(plan.reason, 'pay_date_impossible')
  }
  // Today itself is fine — a bon photographed at the counter is today's.
  assert.equal(planReceiptSettlement(input({ invoiceDate: TODAY })).settle, true)
})

test('[BON-AUTO] it consumes what paymentSuggestion actually produces', () => {
  // The two halves are written in different files and were built months apart. This test fails if
  // the field names or the meaning of paidMethodZeker ever drift — the failure mode being a plan
  // that reads `undefined` and silently never settles anything, with every test above still green.
  const bon = paymentSuggestion({
    is_invoice: true,
    document_kind: 'receipt',
    is_paid: true,
    paid_method: null,
    paid_date: null,
    // The words a Dutch till actually prints. bon-betaalwijze.ts reads them from the paper.
    paid_evidence: 'KONTANT  12,50   WISSELGELD  0,00',
    paid_card_last4: null,
    confidence: 0.97,
  })
  assert.equal(bon.paidMethodZeker, true, 'a printed tender line is certain')
  assert.equal(bon.paidMethod, 'kas')
  const plan = planReceiptSettlement(input({ suggestion: bon }))
  assert.equal(plan.settle, true)
  assert.equal(plan.method, 'kas')

  // And the same call on a bon whose paper says nothing must NOT settle, however sure the model is.
  const silent = paymentSuggestion({
    is_invoice: true, document_kind: 'receipt', is_paid: true,
    paid_method: 'kas', paid_date: null, paid_evidence: null, paid_card_last4: null,
    confidence: 0.99,
  })
  assert.equal(silent.suggestPaid, true, 'still suggested — the kind is proof it was paid')
  assert.equal(silent.paidMethodZeker, false, 'but the method is an interpretation')
  assert.equal(planReceiptSettlement(input({ suggestion: silent })).settle, false)
})

test('[BON-AUTO] the owner is told what the PAPER said, not what we concluded', () => {
  // "Wij dachten dat het contant was" is an opinion nobody can check. "Op de bon staat Wisselgeld"
  // is a claim the owner settles by looking at the bon — which is the difference between a report
  // and a reassurance.
  const plan = planReceiptSettlement(input())
  const text = settleNoticeText(plan, 'wisselgeld') ?? ''
  assert.match(text, /contant/)
  assert.match(text, /"wisselgeld"/, 'the word on the paper is quoted')
  assert.match(text, /één tik terug op openstaand/, 'and the way back is named in the same breath')

  // A plan that did not settle claims nothing at all.
  assert.equal(settleNoticeText(planReceiptSettlement(input({ documentKind: 'invoice' })), 'x'), null)
})
