// [REVERSAL-SET] Pure node test — run: npx tsx --test src/lib/statement-reversal.test.ts
//
// Deleting a bank statement un-pays invoices. Both directions of being wrong cost money, so both
// are pinned here, and the pair is the point:
//
//   · an invoice this statement PROVABLY paid must be reversed even when its payment_method says
//     something else — that is the defect this module was extracted for;
//   · an invoice matched only on its printed NUMBER must stay bank-only, or deleting a statement
//     that merely mentions a number un-pays a bill someone settled in cash.
//
// The second assertion is the one that makes the first safe. Removing the payment_method filter
// outright fixes the first and breaks the second, which is why the two tiers exist at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planStatementReversal, type ReversalInvoice } from './statement-reversal'
import { parseReferenceNumbers, normalizeRef } from './bank-matching'

const inv = (o: Partial<ReversalInvoice> & { id: string }): ReversalInvoice => ({
  invoice_number: null,
  direction: 'incoming',
  payment_method: 'bank',
  ...o,
})

/**
 * A batch payment naming two invoices — the shape the gap-fill tier exists for.
 * Comma-separated, because that is what parseReferenceNumbers splits on (see [BANK-REF-DIGITS]:
 * free text without commas stays ONE token on purpose, so prose cannot parse as five invoices).
 */
const batchTx = { reference: '26302050, 26302051', amount: -1500 }

test('[REVERSAL-SET] a link row outranks whatever finally settled the invoice', () => {
  // Two instalments: a bank payment from this statement, then a cash payment that closed it.
  // apply_manual_payment writes the method of the LAST payment, so the row reads 'kas' — and the
  // old `.eq("payment_method","bank")` dropped it from the reversal set. Deleting the statement
  // then cascaded its link away and lowered amount_paid to the cash part, while `status` stayed
  // 'paid'. Nothing re-derives status: the invoice sat marked settled with half of it still owed.
  const mixed = inv({ id: 'a', invoice_number: '26302050', payment_method: 'kas' })
  const plan = planStatementReversal([mixed], new Set(['a']), [], parseReferenceNumbers, normalizeRef)
  assert.deepEqual(plan.idLinked.map((i) => i.id), ['a'])
  assert.deepEqual(plan.gapCandidates, [])

  // And every other method the app can write, for the same reason — the link is the evidence.
  for (const m of ['kas', 'pin', 'incasso', null]) {
    const p = planStatementReversal(
      [inv({ id: 'b', payment_method: m })], new Set(['b']), [], parseReferenceNumbers, normalizeRef)
    assert.equal(p.idLinked.length, 1, `payment_method ${String(m)} must not hide a linked invoice`)
  }
})

test('[REVERSAL-SET] an invoice this statement never touched is left alone', () => {
  const other = inv({ id: 'z', invoice_number: '99999999' })
  const plan = planStatementReversal([other], new Set(), [batchTx], parseReferenceNumbers, normalizeRef)
  assert.deepEqual(plan.idLinked, [])
  assert.deepEqual(plan.gapCandidates, [])
})

test('[REVERSAL-SET] the number-matched tier stays BANK-only — the dangerous direction', () => {
  // The regression that a naive "just drop the payment_method filter" would introduce. This
  // invoice has no bank link at all; the only tie is that a deleted statement's description prints
  // its number. Un-paying it means the owner chases a customer who paid, or re-pays a supplier.
  const cashPaid = inv({ id: 'c', invoice_number: '26302051', payment_method: 'kas' })
  const bankPaid = inv({ id: 'd', invoice_number: '26302050', payment_method: 'bank' })
  const plan = planStatementReversal(
    [cashPaid, bankPaid], new Set(), [batchTx], parseReferenceNumbers, normalizeRef)

  assert.deepEqual(plan.idLinked, [], 'neither is linked')
  assert.deepEqual(
    plan.gapCandidates.map((i) => i.id), ['d'],
    'only the bank-paid sibling may be recovered from a printed number',
  )
})

test('[REVERSAL-SET] the gap-fill keeps its direction guard and its batch precondition', () => {
  const incoming = inv({ id: 'e', invoice_number: '26302050', direction: 'incoming' })
  const outgoing = inv({ id: 'f', invoice_number: '26302050', direction: 'outgoing' })

  // A NEGATIVE amount is money leaving: it pays an incoming (supplier) invoice. The same number on
  // an outgoing invoice is a different document and must not be touched.
  const paid = planStatementReversal(
    [incoming, outgoing], new Set(), [batchTx], parseReferenceNumbers, normalizeRef)
  assert.deepEqual(paid.gapCandidates.map((i) => i.id), ['e'])

  // A zero-amount line has no direction at all — skipped rather than guessed.
  const zero = planStatementReversal(
    [incoming, outgoing], new Set(),
    [{ reference: batchTx.reference, amount: 0 }], parseReferenceNumbers, normalizeRef)
  assert.deepEqual(zero.gapCandidates, [])

  // One number named is an ordinary payment, already covered by its link. The gap-fill exists only
  // for a BATCH, where the migration could backfill just one representative id.
  const single = planStatementReversal(
    [incoming], new Set(),
    [{ reference: '26302050', amount: -750 }], parseReferenceNumbers, normalizeRef)
  assert.deepEqual(single.gapCandidates, [])
})

test('[REVERSAL-SET] a number already covered by a link is not gap-filled twice', () => {
  // Both tiers returning the same invoice would make the route write it twice and, worse, feed a
  // duplicate into the claimed-by-other-tx exclusion.
  const linked = inv({ id: 'g', invoice_number: '26302050' })
  const sibling = inv({ id: 'h', invoice_number: '26302051' })
  const plan = planStatementReversal(
    [linked, sibling], new Set(['g']), [batchTx], parseReferenceNumbers, normalizeRef)
  assert.deepEqual(plan.idLinked.map((i) => i.id), ['g'])
  assert.deepEqual(plan.gapCandidates.map((i) => i.id), ['h'], 'only the uncovered sibling')
})
