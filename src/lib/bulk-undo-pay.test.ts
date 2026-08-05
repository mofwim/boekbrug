// [BULK-UNDO] Pure node test — run: npx tsx --test src/lib/bulk-undo-pay.test.ts
//
// Undoing a payment is the harder direction of the pair. Paying is additive; un-paying REMOVES a
// settlement that other things have already been derived from — a bank link, a kasboek entry, and
// under the kasstelsel a BTW figure that may already have been declared.
//
// So what is held here is that every one of those is NAMED before twenty of them happen at once,
// and that the two rows which must not be touched are refused rather than attempted.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planBulkUndo,
  bulkUndoWarnings,
  bulkUndoTitle,
  quarterOf,
  type UndoCandidateRow,
} from './bulk-undo-pay'

const row = (o: Partial<UndoCandidateRow> & { id: string }): UndoCandidateRow => ({
  invoice_number: '26302050',
  client_name: 'ATAPACK Cash & Carry B.V.',
  total_inc_btw: 500,
  amount_paid: 500,
  status: 'paid',
  accountant_status: null,
  payment_method: 'bank',
  payment_date: '2026-05-20',
  ...o,
})

test('[BULK-UNDO] the plan separates what can be undone from what must not', () => {
  const plan = planBulkUndo(
    [
      row({ id: 'a' }),
      row({ id: 'locked', accountant_status: 'verwerkt' }),
      row({ id: 'open', status: 'received', amount_paid: 0 }),
    ],
    [],
  )
  assert.deepEqual(plan.eligible.map((r) => r.id), ['a'])
  assert.deepEqual(
    plan.refused.map((r) => [r.row.id, r.reason]),
    [['locked', 'accountant_locked'], ['open', 'not_paid']],
    'refused, not silently dropped — the owner sees them in the confirm',
  )
})

test('[BULK-UNDO] the total is what was APPLIED, not the invoice total', () => {
  // A partly-paid invoice gives back only its instalments. Saying the full total would overstate
  // what is about to change, on a confirm whose whole job is to be accurate about that.
  const plan = planBulkUndo([row({ id: 'part', total_inc_btw: 500, amount_paid: 200 })], [])
  assert.equal(plan.total, 200)
  assert.match(bulkUndoTitle(plan), /1 betaling ongedaan maken/)
  assert.match(bulkUndoTitle(plan), /200,00/)

  // A row marked paid before amount_paid existed reports no instalment — fall back to the total
  // rather than claiming € 0,00 is being withdrawn.
  assert.equal(planBulkUndo([row({ id: 'legacy', amount_paid: 0, status: 'paid' })], []).total, 500)
})

test('[BULK-UNDO] a filed quarter is the one consequence that reaches outside the app', () => {
  // Under the kasstelsel the PAYMENT date decides the quarter, so that is the date read — not the
  // invoice date. Undoing here changes a figure already declared to the Belastingdienst.
  const plan = planBulkUndo([row({ id: 'q2', payment_date: '2026-05-20' })], ['2026-Q2'])
  assert.deepEqual(plan.filedQuarters, ['2026-Q2'])

  const warnings = bulkUndoWarnings(plan)
  assert.match(warnings[0], /al ingediend/, 'and it is said FIRST')
  assert.match(warnings[0], /suppletie/, 'with the correction route named')

  // Not a refusal: a wrong booking must stay correctable.
  assert.equal(plan.eligible.length, 1)

  // An unfiled quarter says nothing about aangifte at all.
  const quiet = planBulkUndo([row({ id: 'q3', payment_date: '2026-08-01' })], ['2026-Q2'])
  assert.deepEqual(quiet.filedQuarters, [])
  assert.ok(!bulkUndoWarnings(quiet).some((w) => /ingediend/.test(w)))
})

test('[BULK-UNDO] the bank and the kasboek are named, and cash only when there is cash', () => {
  const bank = planBulkUndo([row({ id: 'b', payment_method: 'bank' })], [])
  const w = bulkUndoWarnings(bank)
  assert.ok(w.some((x) => /bankafschrift/.test(x)), 'the links come loose — always true, always said')
  assert.ok(!w.some((x) => /kasboek/.test(x)), 'no cash row, no cash sentence')

  const cash = planBulkUndo([row({ id: 'c', payment_method: 'kas' })], [])
  assert.equal(cash.touchesCash, true)
  assert.ok(bulkUndoWarnings(cash).some((x) => /kasboek/.test(x)))
})

test('[BULK-UNDO] the accountant lock appears in the confirm, with what to do', () => {
  const plan = planBulkUndo(
    [row({ id: 'a' }), row({ id: 'l', invoice_number: '2601291', accountant_status: 'verwerkt' })],
    [],
  )
  const w = bulkUndoWarnings(plan)
  assert.ok(w.some((x) => /2601291/.test(x) && /boekhouder/.test(x)), 'named, with the way out')
})

test('[BULK-UNDO] quarterOf reads the quarter the way the aangifte does', () => {
  assert.equal(quarterOf('2026-01-30'), '2026-Q1')
  assert.equal(quarterOf('2026-04-01'), '2026-Q2')
  assert.equal(quarterOf('2026-12-31'), '2026-Q4')
  assert.equal(quarterOf(null), null)
  assert.equal(quarterOf('niet een datum'), null)
})

test('[BULK-UNDO] an empty selection plans nothing and claims nothing', () => {
  const plan = planBulkUndo([], ['2026-Q2'])
  assert.deepEqual(plan.eligible, [])
  assert.equal(plan.total, 0)
  assert.deepEqual(plan.filedQuarters, [])
  assert.equal(plan.touchesCash, false)
})
