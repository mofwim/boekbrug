// [BETAALPLAN] Pure node test — run: npx tsx --test src/lib/bank-line-budget.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { allocatedOnLine, allocatedByTransaction, givesMoneyBack } from './bank-line-budget'

const inv = (id: string, total: number, type = 'factuur') => ({ id, invoice_type: type, total_inc_btw: total })

test('[BETAALPLAN] ordinary links add up, plainly', () => {
  const r = allocatedOnLine(
    [{ invoice_id: 'a', amount_applied: 1200 }, { invoice_id: 'b', amount_applied: 800 }],
    [inv('a', 1200), inv('b', 800)],
  )
  assert.equal(r.allocated, 2000)
  assert.deepEqual(r.unknownInvoiceIds, [])
})

test('[CREDITNOTA] a credit SUBTRACTS from what the line has given away', () => {
  // The €850 debit made of a €1.000 invoice and a €150 credit. Summed as magnitudes this returns
  // 1150 and the line looks over-spent by €300; signed it returns 850, which is what moved.
  const r = allocatedOnLine(
    [{ invoice_id: 'f', amount_applied: 1000 }, { invoice_id: 'cn', amount_applied: 150 }],
    [inv('f', 1000), inv('cn', -150, 'creditnota')],
  )
  assert.equal(r.allocated, 850)
})

test('[CREDITNOTA] a credit alone leaves the line owing MORE than its face amount', () => {
  // Booked in an earlier visit: the credit is on the line and the invoice is not yet. The line's
  // face amount is €850 and it now has €1.000 to give.
  const r = allocatedOnLine(
    [{ invoice_id: 'cn', amount_applied: 150 }],
    [inv('cn', -150, 'creditnota')],
  )
  assert.equal(r.allocated, -150, 'negative: the credit gave money to the line')
})

test('[CREDITNOTA] a negative total alone is enough — the type may never have been set', () => {
  // An import can leave a credit behind as a 'factuur' with a negative total. payment-plan.ts and
  // allocate_bank_payment both accept either spelling, so this has to as well or the three
  // disagree about the same invoice.
  assert.equal(givesMoneyBack({ invoice_type: 'factuur', total_inc_btw: -150 }), true)
  assert.equal(givesMoneyBack({ invoice_type: 'creditnota', total_inc_btw: 150 }), true)
  assert.equal(givesMoneyBack({ invoice_type: 'factuur', total_inc_btw: 150 }), false)
  assert.equal(givesMoneyBack({ total_inc_btw: 150 }), false, 'a missing type is an ordinary invoice')

  const r = allocatedOnLine([{ invoice_id: 'x', amount_applied: 150 }], [inv('x', -150)])
  assert.equal(r.allocated, -150)
})

test('[BETAALPLAN] a NULL amount means the link settled its invoice in FULL', () => {
  // Links from before amount_applied existed. Reading NULL as 0 makes the line look untouched and
  // lets the same euros be spent twice — which is the one direction this sum may never err in.
  const r = allocatedOnLine([{ invoice_id: 'old', amount_applied: null }], [inv('old', 640)])
  assert.equal(r.allocated, 640)

  // And a NULL on a credit still gives money back.
  const c = allocatedOnLine([{ invoice_id: 'oldcn', amount_applied: null }], [inv('oldcn', -90, 'creditnota')])
  assert.equal(c.allocated, -90)
})

test('[BETAALPLAN] a link to an invoice we were not given is NAMED, never assumed away', () => {
  // Counting it as 0 makes the budget too large — the direction that double-spends. Counting it as
  // something guessed is worse. So it is reported and the caller decides.
  const r = allocatedOnLine(
    [{ invoice_id: 'known', amount_applied: 100 }, { invoice_id: 'ghost', amount_applied: 500 }],
    [inv('known', 100)],
  )
  assert.equal(r.allocated, 100)
  assert.deepEqual(r.unknownInvoiceIds, ['ghost'])
})

test('[BETAALPLAN] nothing linked is zero, and an empty read is not an error', () => {
  assert.equal(allocatedOnLine([], []).allocated, 0)
  assert.equal(allocatedOnLine(null, null).allocated, 0)
  assert.equal(allocatedOnLine(undefined, [inv('a', 1)]).allocated, 0)
})

test('[BETAALPLAN] the sum lands on the cent, not on a float tail', () => {
  const r = allocatedOnLine(
    [{ invoice_id: 'a', amount_applied: 0.1 }, { invoice_id: 'b', amount_applied: 0.2 }],
    [inv('a', 0.1), inv('b', 0.2)],
  )
  assert.equal(r.allocated, 0.3, '0.1 + 0.2 must not reach a caller as 0.30000000000000004')
})

test('[CREDITNOTA] grouped: a line with a credit and a part invoice is NOT fully covered', () => {
  // The bank page's version of the same sum. €850 debit, €150 supplier credit, €700 invoice —
  // €300 still to assign. As magnitudes that is 850 of 850, the line reads as done, and it leaves
  // "te bevestigen" with €300 nobody will look at again.
  const { byTransaction } = allocatedByTransaction(
    [
      { transaction_id: 'tx1', invoice_id: 'cn', amount_applied: 150 },
      { transaction_id: 'tx1', invoice_id: 'f', amount_applied: 700 },
    ],
    [inv('cn', -150, 'creditnota'), inv('f', 700)],
  )
  assert.equal(byTransaction.get('tx1'), 550, '700 − 150, not 700 + 150')
})

test('[BETAALPLAN] grouped: lines are kept apart, and a link with no transaction is skipped', () => {
  const { byTransaction } = allocatedByTransaction(
    [
      { transaction_id: 'tx1', invoice_id: 'a', amount_applied: 100 },
      { transaction_id: 'tx2', invoice_id: 'b', amount_applied: 250 },
      { transaction_id: null, invoice_id: 'c', amount_applied: 999 },
    ],
    [inv('a', 100), inv('b', 250), inv('c', 999)],
  )
  assert.equal(byTransaction.get('tx1'), 100)
  assert.equal(byTransaction.get('tx2'), 250)
  assert.equal(byTransaction.size, 2, 'a link with no transaction belongs to no line')
})

test('[BETAALPLAN] grouped: an unreadable invoice is reported against ITS line, not all of them', () => {
  const { byTransaction, unknownByTransaction } = allocatedByTransaction(
    [
      { transaction_id: 'tx1', invoice_id: 'known', amount_applied: 100 },
      { transaction_id: 'tx2', invoice_id: 'ghost', amount_applied: 500 },
    ],
    [inv('known', 100)],
  )
  assert.equal(byTransaction.get('tx1'), 100)
  assert.deepEqual(unknownByTransaction.get('tx2'), ['ghost'])
  assert.equal(unknownByTransaction.has('tx1'), false, 'a measurable line must not be spoiled by another line')
})
