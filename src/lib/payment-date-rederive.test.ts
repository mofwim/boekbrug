// [PAYDATE-REDERIVE] Pure node test — run: npx tsx --test src/lib/payment-date-rederive.test.ts
//
// The case, from the migration this stands in for: an invoice settled in two instalments —
// EUR 1.000 on 1 May, EUR 2.000 on 15 June — and the owner undoes the FIRST one. The money still
// on that invoice arrived on 15 June; the invoice went on saying 1 May. Under the kasstelsel that
// date decides which QUARTER the payment counts in, so a stale one moves money into a quarter it
// never belonged to, silently.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { earliestSurvivingPayment, rederivePaymentDate, type SurvivingLink } from './payment-date-rederive'

const bankLink = (date: string, created = `${date}T10:00:00Z`): SurvivingLink =>
  ({ paid_on: null, method: null, transaction_date: date, created_at: created })

test('[PAYDATE-REDERIVE] undoing the first instalment leaves the date of the money that stayed', () => {
  // 1 May is gone; only 15 June survives.
  const out = earliestSurvivingPayment([bankLink('2026-06-15')])
  assert.deepEqual(out, { date: '2026-06-15', method: 'bank' })

  // And with both still there, the EARLIEST is the invoice's date — which is what it was before
  // anything was undone, so a reversal of the SECOND instalment changes nothing.
  const both = earliestSurvivingPayment([bankLink('2026-06-15'), bankLink('2026-05-01')])
  assert.deepEqual(both, { date: '2026-05-01', method: 'bank' })
})

test('[PAYDATE-REDERIVE] a manual instalment is dated and paid by itself, not by a bank line', () => {
  const cash: SurvivingLink = { paid_on: '2026-05-20', method: 'kas', transaction_date: null, created_at: '2026-05-20T09:00:00Z' }
  assert.deepEqual(earliestSurvivingPayment([cash]), { date: '2026-05-20', method: 'kas' })

  // Its own date wins over the transaction's — a manual row states what it means.
  const both: SurvivingLink = { paid_on: '2026-05-20', method: 'kas', transaction_date: '2026-07-01', created_at: 'x' }
  assert.equal(earliestSurvivingPayment([both])?.date, '2026-05-20')

  // Losing the cash instalment leaves a bank one, and the METHOD follows the money that remains —
  // keep 'kas' and the surviving bank payment disappears from the kasboek's reasoning.
  assert.deepEqual(earliestSurvivingPayment([bankLink('2026-06-15')]), { date: '2026-06-15', method: 'bank' })
})

test('[PAYDATE-REDERIVE] two payments on one day resolve the same way every time', () => {
  // Ties break on created_at, exactly as the SQL orders them. Without it the answer depends on the
  // order rows happen to come back in, and an invoice's date could flip between two reversals.
  const a: SurvivingLink = { paid_on: '2026-05-01', method: 'kas', created_at: '2026-05-01T08:00:00Z' }
  const b: SurvivingLink = { paid_on: '2026-05-01', method: 'bank', created_at: '2026-05-01T09:00:00Z' }
  assert.equal(earliestSurvivingPayment([b, a])?.method, 'kas')
  assert.equal(earliestSurvivingPayment([a, b])?.method, 'kas')
})

test('[PAYDATE-REDERIVE] an undated link never wins while a dated one exists', () => {
  // NULLS LAST. A link with no date at all says nothing about which quarter the money is in, so it
  // may not push aside one that does.
  const undated: SurvivingLink = { paid_on: null, method: 'bank', transaction_date: null, created_at: '2026-01-01T00:00:00Z' }
  assert.deepEqual(
    earliestSurvivingPayment([undated, bankLink('2026-06-15')]),
    { date: '2026-06-15', method: 'bank' },
  )
})

test('[PAYDATE-REDERIVE] nothing derivable writes nothing — and that is not the same as null', () => {
  // No links: the caller is already clearing the date for a fully unpaid invoice. Writing null here
  // as well would ALSO blank the recorded date of an invoice whose payment predates the join table
  // and is invisible to this query. Same answer as the SQL's `IF v_date IS NOT NULL`.
  assert.equal(earliestSurvivingPayment([]), null)
  assert.equal(earliestSurvivingPayment(null), null)
  assert.equal(earliestSurvivingPayment(undefined), null)
  // Links that exist but carry no date at all: still nothing to write.
  assert.equal(earliestSurvivingPayment([{ paid_on: '  ', method: 'bank', transaction_date: null }]), null)
})

test('[PAYDATE-REDERIVE] the write reads the join, derives, and stores both fields', async () => {
  const writes: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      if (table === 'bank_tx_invoices') {
        return {
          select: () => ({ eq: () => ({ eq: () => Promise.resolve({
            data: [
              { paid_on: null, method: null, created_at: '2026-06-15T10:00:00Z', bank_transactions: { date: '2026-06-15' } },
            ],
            error: null,
          }) }) }),
        }
      }
      return { update: (patch: Record<string, unknown>) => { writes.push(patch); return { eq: () => ({ or: () => Promise.resolve({ error: null }) }) } } }
    },
  }
  const out = await rederivePaymentDate(client, 'u1', 'inv1')
  assert.deepEqual(out, { date: '2026-06-15', method: 'bank' })
  assert.deepEqual(writes, [{ payment_date: '2026-06-15', payment_method: 'bank' }])
})

test('[PAYDATE-REDERIVE] the embed answers as an array on some versions, and that changes nothing', async () => {
  const client = {
    from(table: string) {
      if (table === 'bank_tx_invoices') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [{ paid_on: null, method: null, created_at: 'x', bank_transactions: [{ date: '2026-06-15' }] }],
          error: null,
        }) }) }) }
      }
      return { update: () => ({ eq: () => ({ or: () => Promise.resolve({ error: null }) }) }) }
    },
  }
  assert.deepEqual(await rederivePaymentDate(client, 'u1', 'inv1'), { date: '2026-06-15', method: 'bank' })
})

test('[PAYDATE-REDERIVE] a failed read or write costs the date, never the reversal', async () => {
  // The amount was already re-derived by the caller when this runs. Throwing here would refuse a
  // reversal that has, in the part that matters, already succeeded.
  const readFails = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }),
  }
  assert.equal(await rederivePaymentDate(readFails, 'u1', 'inv1'), null)

  const writeFails = {
    from(table: string) {
      if (table === 'bank_tx_invoices') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({
          data: [{ paid_on: '2026-06-15', method: 'bank', created_at: 'x', bank_transactions: null }], error: null,
        }) }) }) }
      }
      return { update: () => ({ eq: () => ({ or: () => Promise.resolve({ error: { message: 'nope' } }) }) }) }
    },
  }
  assert.equal(await rederivePaymentDate(writeFails, 'u1', 'inv1'), null)

  // And a client that throws outright is still not a thrown reversal.
  const explodes = { from: () => { throw new Error('gone') } }
  assert.equal(await rederivePaymentDate(explodes, 'u1', 'inv1'), null)
})
