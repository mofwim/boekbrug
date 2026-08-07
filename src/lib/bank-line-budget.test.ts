// [BETAALPLAN] Pure node test — run: npx tsx --test src/lib/bank-line-budget.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { allocatedOnLine, allocatedByTransaction, spendsTheLine, invoiceMovesMoneyOut } from './bank-line-budget'

/** An incoming (purchase) invoice unless told otherwise — the common case. */
const inv = (id: string, total: number, type = 'factuur', direction = 'incoming') =>
  ({ id, direction, invoice_type: type, total_inc_btw: total })

/** A debit: money out. Every test that does not care passes this. */
const DEBIT = -1000
const CREDIT = 1000

test('[BETAALPLAN] ordinary links add up, plainly', () => {
  const r = allocatedOnLine(
    [{ invoice_id: 'a', amount_applied: 1200 }, { invoice_id: 'b', amount_applied: 800 }],
    [inv('a', 1200), inv('b', 800)],
    DEBIT,
  )
  assert.equal(r.allocated, 2000)
  assert.deepEqual(r.unknownInvoiceIds, [])
})

test('[CREDITNOTA] on a DEBIT a supplier credit SUBTRACTS from what the line gave away', () => {
  // The €850 debit made of a €1.000 invoice and a €150 credit. Summed as magnitudes this returns
  // 1150 and the line looks over-spent by €300; signed it returns 850, which is what moved.
  const r = allocatedOnLine(
    [{ invoice_id: 'f', amount_applied: 1000 }, { invoice_id: 'cn', amount_applied: 150 }],
    [inv('f', 1000), inv('cn', -150, 'creditnota')],
    -850,
  )
  assert.equal(r.allocated, 850)
})

test('[CREDITNOTA] on a REFUND line the very same credit note SPENDS it', () => {
  // The case a type-only sign gets wrong, and the reason this rule is about DIRECTION.
  //
  // A supplier refunds €250 in one CREDIT line covering two credit notes. Here they consume the
  // line — the refund IS the money. Read as "creditnota → gives back", this returns −250 and the
  // line looks like it has €500 to give when it has nothing.
  const r = allocatedOnLine(
    [{ invoice_id: 'cn1', amount_applied: 150 }, { invoice_id: 'cn2', amount_applied: 100 }],
    [inv('cn1', -150, 'creditnota'), inv('cn2', -100, 'creditnota')],
    250,
  )
  assert.equal(r.allocated, 250, 'both credit notes spent the refund')
})

test('[CREDITNOTA] the direction rule, in all four combinations', () => {
  // An invoice moves money OUT when it is a bill you pay, or a credit you issue to a customer.
  assert.equal(invoiceMovesMoneyOut(inv('x', 100)), true, 'a purchase invoice pays out')
  assert.equal(invoiceMovesMoneyOut(inv('x', -100, 'creditnota')), false, 'a supplier credit brings money in')
  assert.equal(invoiceMovesMoneyOut(inv('x', 100, 'factuur', 'outgoing')), false, 'a sale brings money in')
  assert.equal(invoiceMovesMoneyOut(inv('x', -100, 'creditnota', 'outgoing')), true, 'a credit you issue pays out')

  // And a link spends its line when the two move the same way.
  assert.equal(spendsTheLine(inv('x', 100), true), true, 'purchase on a debit: spends')
  assert.equal(spendsTheLine(inv('x', -100, 'creditnota'), true), false, 'supplier credit on a debit: gives back')
  assert.equal(spendsTheLine(inv('x', -100, 'creditnota'), false), true, 'supplier credit on a REFUND: spends')
  assert.equal(spendsTheLine(inv('x', 100, 'factuur', 'outgoing'), false), true, 'sale on a credit line: spends')
})

test('[CREDITNOTA] a credit alone leaves a debit owing MORE than its face amount', () => {
  // Booked in an earlier visit: the credit is on the line and the invoice is not yet. The line's
  // face amount is €850 and it now has €1.000 to give.
  const r = allocatedOnLine([{ invoice_id: 'cn', amount_applied: 150 }], [inv('cn', -150, 'creditnota')], -850)
  assert.equal(r.allocated, -150, 'negative: the credit gave money to the line')
})

test('[CREDITNOTA] a negative total alone is enough — the type may never have been set', () => {
  // An import can leave a credit behind as a 'factuur' with a negative total. payment-plan.ts and
  // allocate_bank_payment both accept either spelling, so this has to as well or the three
  // disagree about the same invoice.
  const r = allocatedOnLine([{ invoice_id: 'x', amount_applied: 150 }], [inv('x', -150)], -850)
  assert.equal(r.allocated, -150)
})

test('[BETAALPLAN] a NULL amount means the link settled its invoice in FULL', () => {
  // Links from before amount_applied existed. Reading NULL as 0 makes the line look untouched and
  // lets the same euros be spent twice — which is the one direction this sum may never err in.
  const r = allocatedOnLine([{ invoice_id: 'old', amount_applied: null }], [inv('old', 640)], DEBIT)
  assert.equal(r.allocated, 640)

  const c = allocatedOnLine([{ invoice_id: 'oldcn', amount_applied: null }], [inv('oldcn', -90, 'creditnota')], DEBIT)
  assert.equal(c.allocated, -90)
})

test('[BETAALPLAN] a link to an invoice we were not given is NAMED, never assumed away', () => {
  // Counting it as 0 makes the budget too large — the direction that double-spends. Counting it as
  // something guessed is worse. So it is reported and the caller decides.
  const r = allocatedOnLine(
    [{ invoice_id: 'known', amount_applied: 100 }, { invoice_id: 'ghost', amount_applied: 500 }],
    [inv('known', 100)],
    DEBIT,
  )
  assert.equal(r.allocated, 100)
  assert.deepEqual(r.unknownInvoiceIds, ['ghost'])
})

test('[BETAALPLAN] nothing linked is zero, and an empty read is not an error', () => {
  assert.equal(allocatedOnLine([], [], DEBIT).allocated, 0)
  assert.equal(allocatedOnLine(null, null, DEBIT).allocated, 0)
  assert.equal(allocatedOnLine(undefined, [inv('a', 1)], DEBIT).allocated, 0)
})

test('[BETAALPLAN] the sum lands on the cent, not on a float tail', () => {
  const r = allocatedOnLine(
    [{ invoice_id: 'a', amount_applied: 0.1 }, { invoice_id: 'b', amount_applied: 0.2 }],
    [inv('a', 0.1), inv('b', 0.2)],
    DEBIT,
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
    new Map([['tx1', -850]]),
  )
  assert.equal(byTransaction.get('tx1'), 550, '700 − 150, not 700 + 150')
})

test('[CREDITNOTA] grouped: each line is judged by its OWN direction', () => {
  // Two lines, the same kind of credit note on each. On the debit it gives money back; on the
  // refund it spends. A screen measuring many lines at once cannot use one rule for all of them.
  const { byTransaction } = allocatedByTransaction(
    [
      { transaction_id: 'debit', invoice_id: 'cnA', amount_applied: 150 },
      { transaction_id: 'refund', invoice_id: 'cnB', amount_applied: 150 },
    ],
    [inv('cnA', -150, 'creditnota'), inv('cnB', -150, 'creditnota')],
    new Map([['debit', -850], ['refund', 150]]),
  )
  assert.equal(byTransaction.get('debit'), -150, 'gives back to the debit')
  assert.equal(byTransaction.get('refund'), 150, 'spends the refund')
})

test('[BETAALPLAN] grouped: lines are kept apart, and a link with no transaction is skipped', () => {
  const { byTransaction } = allocatedByTransaction(
    [
      { transaction_id: 'tx1', invoice_id: 'a', amount_applied: 100 },
      { transaction_id: 'tx2', invoice_id: 'b', amount_applied: 250 },
      { transaction_id: null, invoice_id: 'c', amount_applied: 999 },
    ],
    [inv('a', 100), inv('b', 250), inv('c', 999)],
    new Map([['tx1', DEBIT], ['tx2', DEBIT]]),
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
    new Map([['tx1', DEBIT], ['tx2', DEBIT]]),
  )
  assert.equal(byTransaction.get('tx1'), 100)
  assert.deepEqual(unknownByTransaction.get('tx2'), ['ghost'])
  assert.equal(unknownByTransaction.has('tx1'), false, 'a measurable line must not be spoiled by another line')
})

test('[BETAALPLAN] grouped: a line whose amount we do not have is unmeasurable, not assumed', () => {
  // Guessing a line's direction is guessing the sign of money, so a transaction missing from the
  // map is reported rather than defaulted. The caller then falls back to a rule that keeps the
  // line VISIBLE, which is the safe direction for a screen showing what is left to do.
  const { byTransaction, unknownByTransaction } = allocatedByTransaction(
    [{ transaction_id: 'tx9', invoice_id: 'a', amount_applied: 100 }],
    [inv('a', 100)],
    new Map([['tx1', DEBIT]]),
  )
  assert.equal(byTransaction.has('tx9'), false)
  assert.deepEqual(unknownByTransaction.get('tx9'), ['a'])
})

test('[BETAALPLAN] an outgoing sale spends the credit line that paid it', () => {
  const r = allocatedOnLine(
    [{ invoice_id: 's', amount_applied: 1210 }],
    [inv('s', 1210, 'factuur', 'outgoing')],
    CREDIT,
  )
  assert.equal(r.allocated, 1210)
})
