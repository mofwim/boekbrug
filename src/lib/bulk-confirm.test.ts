// [BULK-BEVESTIG] Pure node test — run: npx tsx --test src/lib/bulk-confirm.test.ts
//
// The screen loads up to 500 waiting purchase invoices across every client that authorised this
// accountant, and confirms them one at a time. Removing that is worth a lot of a bookkeeper's
// quarter — and it is also the single easiest way to turn the one safeguard on that screen into a
// formality, because a checkbox will happily sweep up the rows a human was supposed to look at.
//
// So what is held here is the split: the mechanical work goes, the judgement work stays, and the
// rows held back are COUNTED rather than quietly dropped.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planBulkConfirm,
  bulkConfirmable,
  bulkConfirmTitle,
  bulkConfirmWarnings,
  bulkConfirmResultText,
  type ConfirmCandidateRow,
} from './bulk-confirm'

const row = (o: Partial<ConfirmCandidateRow> & { id: string }): ConfirmCandidateRow => ({
  clientId: 'k1',
  clientNaam: 'Bakkerij Yilmaz',
  leverancier: 'Groothandel Bos',
  factuurnummer: 'RE0801378',
  totaalInc: 871.4,
  twijfels: [],
  ...o,
})

test('[BULK-BEVESTIG] a row the reader was unsure about is never swept up', () => {
  // The doctrine this screen is built on: "a confirm button above a hidden doubt turns the
  // accountant into a rubber stamp". A bulk action that can swallow a doubt does that at scale, in
  // one tap, which is worse than having no bulk action at all.
  assert.equal(bulkConfirmable(row({ id: 'schoon' })), true)
  assert.equal(bulkConfirmable(row({ id: 'twijfel', twijfels: ['het bedrag'] })), false)

  const plan = planBulkConfirm(
    [row({ id: 'a' }), row({ id: 'b', twijfels: ['het bedrag', 'de datum'] }), row({ id: 'c' })],
    new Set(['a', 'b', 'c']),
  )
  assert.deepEqual(plan.eligible.map((r) => r.id), ['a', 'c'])
  assert.deepEqual(
    plan.refused.map((r) => [r.row.id, r.reason]),
    [['b', 'leesonzekerheid']],
    'held back, and held back VISIBLY — an exclusion nobody notices is no exclusion',
  )
})

test('[BULK-BEVESTIG] the held-back rows are the FIRST thing the confirm says', () => {
  const plan = planBulkConfirm(
    [row({ id: 'a' }), row({ id: 'b', twijfels: ['de datum'] })],
    new Set(['a', 'b']),
  )
  const w = bulkConfirmWarnings(plan)
  assert.match(w[0], /blijft staan/, 'said first, because it is why this is safe at all')
  assert.match(w[0], /één voor één/, 'and it says what to do with them instead')
  // Nothing to hold back → nothing claimed about it.
  const schoon = planBulkConfirm([row({ id: 'a' })], new Set(['a']))
  assert.ok(!bulkConfirmWarnings(schoon).some((x) => /blijft staan/.test(x)))
})

test('[BULK-BEVESTIG] the liability sentence survives the bulk path', () => {
  // It is on the single-confirm screen and the render gate holds it there. A bulk action that
  // books forty invoices without it would be the one place the law is not mentioned.
  const plan = planBulkConfirm([row({ id: 'a' })], new Set(['a']))
  assert.ok(bulkConfirmWarnings(plan).some((x) => /art\. 52 AWR/.test(x)))
  assert.ok(bulkConfirmWarnings(plan).some((x) => /je verandert er niets aan/.test(x)))
})

test('[BULK-BEVESTIG] more than one client is said out loud', () => {
  // This screen spans every authorised client at once. "12 facturen bevestigen" reads as one
  // administration, and booking into the wrong client's books is the mistake that costs most.
  const plan = planBulkConfirm(
    [row({ id: 'a', clientId: 'k1' }), row({ id: 'b', clientId: 'k2', clientNaam: 'Slagerij Demir' })],
    new Set(['a', 'b']),
  )
  assert.equal(plan.clientCount, 2)
  assert.match(bulkConfirmTitle(plan), /2 klanten/)
  assert.ok(bulkConfirmWarnings(plan).some((x) => /2 verschillende klanten/.test(x)))

  const een = planBulkConfirm([row({ id: 'a' })], new Set(['a']))
  assert.doesNotMatch(bulkConfirmTitle(een), /klanten/, 'one client says nothing about clients')
})

test('[BULK-BEVESTIG] the total is what is about to be booked', () => {
  const plan = planBulkConfirm(
    [row({ id: 'a', totaalInc: 871.4 }), row({ id: 'b', totaalInc: 128.6 })],
    new Set(['a', 'b']),
  )
  assert.equal(plan.total, 1000)
  assert.match(bulkConfirmTitle(plan), /1\.000,00/)
  // A row with no readable amount contributes nothing rather than NaN — a title reading
  // "€ NaN" is the kind of thing that makes an accountant close the tab.
  const kaal = planBulkConfirm([row({ id: 'x', totaalInc: null })], new Set(['x']))
  assert.equal(kaal.total, 0)
  assert.match(bulkConfirmTitle(kaal), /1 factuur bevestigen/)
})

test('[BULK-BEVESTIG] only what was ticked, and unticked doubts are not "refused"', () => {
  const plan = planBulkConfirm(
    [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', twijfels: ['de datum'] })],
    new Set(['a']),
  )
  assert.deepEqual(plan.eligible.map((r) => r.id), ['a'])
  assert.deepEqual(plan.refused, [], 'a row nobody selected was not held back — it was not asked for')
})

test('[BULK-BEVESTIG] a half-failed run says both numbers', () => {
  // A bulk action over a per-row route WILL sometimes half-succeed: a mandate withdrawn mid-run, an
  // invoice already confirmed in another tab. Reporting "gelukt" over that is the exact failure
  // this codebase keeps correcting.
  assert.match(bulkConfirmResultText(12, 0), /12 facturen bevestigd/)
  assert.match(bulkConfirmResultText(1, 0), /^1 factuur bevestigd/)
  assert.match(bulkConfirmResultText(9, 3), /9 bevestigd, 3 niet/)
  assert.match(bulkConfirmResultText(9, 3), /staan er nog/, 'and says where the failures went')
  assert.match(bulkConfirmResultText(0, 4), /Geen van de 4/)
})

test('[BULK-BEVESTIG] an empty selection plans nothing and claims nothing', () => {
  const plan = planBulkConfirm([row({ id: 'a' })], new Set())
  assert.deepEqual(plan.eligible, [])
  assert.equal(plan.total, 0)
  assert.equal(plan.clientCount, 0)
})
