// [STATIEGELD-GAT] Pure node test — run: npx tsx --test src/lib/statiegeld.test.ts
//
// The invoice is real: Elegance Brands 2026080832, reported by the owner because the app could do
// nothing with it. Every number below is off that paper. What must hold in both directions:
// the deposit that IS printed gets found, and a difference the paper does not explain stays
// unexplained — a wrong "this is deposit" over a misread total is worse than the blunt message it
// would replace.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectDepositGap, depositGapText } from './statiegeld'

// The totals block as the PDF prints it.
const ELEGANCE = `
  Subtotaal            € 835,30
  BTW 9%               € 75,22
  Totaal Statiegeld    € 176,40
  Totaal               € 1.086,92
`

test('[STATIEGELD-GAT] the Elegance invoice: the missing 176,40 is found on the paper', () => {
  const d = detectDepositGap({
    totalExBtw: 835.3,
    btwAmount: 75.22,
    totalIncBtw: 1086.92,
    text: ELEGANCE,
  })
  assert.ok(d, 'the deposit line was not found')
  assert.equal(d!.gap, 176.4)
  assert.equal(d!.correctedExcl, 1011.7, 'the base the owner is agreeing to')
  assert.match(d!.label, /Statiegeld/i)

  const zin = depositGapText(d!)
  assert.match(zin, /€\s?176,40/, 'names the difference')
  assert.match(zin, /€\s?1\.011,70/, 'and the figure the base becomes')
  assert.match(zin, /geen btw/, 'and says the btw does not move — that is why this is safe')
})

test('[STATIEGELD-GAT] a breakdown that already adds up says nothing', () => {
  assert.equal(
    detectDepositGap({ totalExBtw: 1011.7, btwAmount: 75.22, totalIncBtw: 1086.92, text: ELEGANCE }),
    null,
  )
})

test('[STATIEGELD-GAT] an unexplained difference stays unexplained', () => {
  // Same three amounts, a document that says nothing about deposits. The identity still fails —
  // and this module refuses to name a cause it cannot see. That refusal is the whole safety.
  const d = detectDepositGap({
    totalExBtw: 835.3,
    btwAmount: 75.22,
    totalIncBtw: 1086.92,
    text: 'Subtotaal 835,30\nBTW 9% 75,22\nVerzendkosten 176,40 excl.\nTotaal 1.086,92',
  })
  assert.equal(d, null, 'shipping is not a deposit — nothing here may vouch for the gap')
})

test('[STATIEGELD-GAT] a returned deposit moves the base DOWN, and says so', () => {
  // "Retour container 408,00" printed positive under a return heading; the arithmetic gives the
  // sign. Goods 2.000,00 + 420,00 btw − 408,00 returned = 2.012,00 paid.
  const d = detectDepositGap({
    totalExBtw: 2000,
    btwAmount: 420,
    totalIncBtw: 2012,
    text: 'Goederen 2.000,00\nBTW 21% 420,00\nRetouremballage 408,00\nTe voldoen 2.012,00',
  })
  assert.ok(d)
  assert.equal(d!.gap, -408)
  assert.equal(d!.correctedExcl, 1592)
  assert.match(depositGapText(d!), /eraf/, 'a return lowers the base and the sentence says which way')
})

test('[STATIEGELD-GAT] a supplier NAME containing "borg" never vouches for an amount', () => {
  // `borg` is matched as a whole word for exactly this: "Borgman Dranken B.V." beside a difference
  // it has nothing to do with would otherwise read as evidence.
  const d = detectDepositGap({
    totalExBtw: 100,
    btwAmount: 21,
    totalIncBtw: 171,
    text: 'Borgman Dranken B.V.  50,00 administratiekosten\nTotaal 171,00',
  })
  assert.equal(d, null)
})

test('[STATIEGELD-GAT] the amount must be the WHOLE number, not a slice of a bigger one', () => {
  // 176,40 inside 1.176,40 beside the deposit word: the shared matcher in amount-grounding refuses
  // it, which is the thousand-euro error that module exists to prevent.
  const d = detectDepositGap({
    totalExBtw: 835.3,
    btwAmount: 75.22,
    totalIncBtw: 1086.92,
    text: 'Statiegeld totaal 1.176,40\nTotaal 1.086,92',
  })
  assert.equal(d, null)
})

test('[STATIEGELD-GAT] without a document there is nothing to corroborate with', () => {
  // A photo with no transcription. The gap is real; the explanation is not available. Silence.
  assert.equal(
    detectDepositGap({ totalExBtw: 835.3, btwAmount: 75.22, totalIncBtw: 1086.92, text: null }),
    null,
  )
  assert.equal(
    detectDepositGap({ totalExBtw: 835.3, btwAmount: null, totalIncBtw: 1086.92, text: ELEGANCE }),
    null,
    'an unread btw leaves no identity to reason from',
  )
})
