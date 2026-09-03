// [NIET-DEZE-FACTUUR] Pure node test — run: npx tsx --test src/lib/bank-rejections.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyRejections, rejectionsByTransaction } from './bank-rejections'

const c = (invoiceId: string) => ({ invoiceId })
const auto = { outcome: 'auto', best: c('a'), candidates: [c('a'), c('b'), c('c')] }

test('[NIET-DEZE-FACTUUR] refusing the winner never hands the tap to the runner-up', () => {
  // The rule the whole feature rests on. The runner-up was the runner-up because its evidence was
  // weaker; pre-selecting it after a "no" is arguing with the owner rather than listening.
  const out = applyRejections(auto, new Set(['a']))
  assert.equal(out.outcome, 'choice', 'an auto whose winner is refused stops being an auto')
  assert.equal(out.best, null, 'and nothing is pre-chosen')
  assert.deepEqual(out.candidates.map((x) => x.invoiceId), ['b', 'c'], 'the rest are still SHOWN')
  assert.equal(out.removed, true)
})

test('[NIET-DEZE-FACTUUR] refusing a runner-up leaves the card exactly as it was, minus that row', () => {
  const out = applyRejections(auto, new Set(['b']))
  assert.equal(out.outcome, 'auto', 'the winner is untouched, so the one-tap confirm stays')
  assert.equal(out.best?.invoiceId, 'a')
  assert.deepEqual(out.candidates.map((x) => x.invoiceId), ['a', 'c'])
})

test('[NIET-DEZE-FACTUUR] refusing everything is a fact, not a failure', () => {
  const out = applyRejections(auto, new Set(['a', 'b', 'c']))
  assert.equal(out.outcome, 'none', 'this payment has no invoice the app can suggest — and says so')
  assert.equal(out.best, null)
  assert.deepEqual(out.candidates, [])
})

test('[NIET-DEZE-FACTUUR] no refusals changes nothing at all', () => {
  for (const empty of [new Set<string>(), null, undefined]) {
    const out = applyRejections(auto, empty)
    assert.equal(out.outcome, 'auto')
    assert.equal(out.best?.invoiceId, 'a')
    assert.deepEqual(out.candidates.map((x) => x.invoiceId), ['a', 'b', 'c'])
    assert.equal(out.removed, false, 'and the card must not claim it changed')
  }
  // A refusal about an invoice this line never offered is also nothing.
  const out = applyRejections(auto, new Set(['zz']))
  assert.equal(out.removed, false)
  assert.equal(out.outcome, 'auto')
})

test('[NIET-DEZE-FACTUUR] a choice stays a choice', () => {
  const choice = { outcome: 'choice', best: null, candidates: [c('a'), c('b')] }
  const out = applyRejections(choice, new Set(['a']))
  assert.equal(out.outcome, 'choice')
  assert.deepEqual(out.candidates.map((x) => x.invoiceId), ['b'])
  assert.equal(out.best, null, 'one candidate left is still a choice — it is not promoted either')
})

test('[NIET-DEZE-FACTUUR] a refusal is about a PAIR, and is grouped that way', () => {
  // Flattening to a set of invoice ids would make one refusal hide that invoice from every other
  // bank line as well — the one mistake this feature could make that is worse than the problem.
  const map = rejectionsByTransaction([
    { transaction_id: 't1', invoice_id: 'a' },
    { transaction_id: 't1', invoice_id: 'b' },
    { transaction_id: 't2', invoice_id: 'a' },
  ])
  assert.deepEqual([...(map.get('t1') ?? [])].sort(), ['a', 'b'])
  assert.deepEqual([...(map.get('t2') ?? [])], ['a'])
  assert.equal(map.get('t3'), undefined)

  // Invoice 'a' is refused on t1 — and must still be offered on t3.
  const out = applyRejections(auto, map.get('t3'))
  assert.equal(out.best?.invoiceId, 'a')
})

test('[NIET-DEZE-FACTUUR] junk rows are dropped rather than grouped into a key of nothing', () => {
  const map = rejectionsByTransaction([
    { transaction_id: null, invoice_id: 'a' },
    { transaction_id: 't1', invoice_id: null },
    { transaction_id: '  ', invoice_id: '  ' },
  ])
  assert.equal(map.size, 0)
  assert.equal(rejectionsByTransaction(null).size, 0)
  assert.equal(rejectionsByTransaction(undefined).size, 0)
})
