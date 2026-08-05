// [BTW-SPLIT] Pure node test — run: npx tsx --test src/lib/btw-split.test.ts
//
// The invoice under test is real: Enka Horeca B.V. 26701681, which passed all seven checks in
// invoice-checks.ts while carrying a btw that was € 0,46 wrong. Every number below is off that
// paper, so a regression here is not hypothetical — it is that invoice going green again.
//
// The property being held is narrow and it is the one that failed: a blended rate is not evidence.
// Whatever else changes, `blend-unverified` must never become a pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyBtwSplit,
  btwSplitCorroborated,
  btwSplitDetail,
  type BtwSplitRow,
} from './btw-split'

// ── The paper ────────────────────────────────────────────────────────────────
// Totaal exclusief BTW € 1.213,50 · € 1.101,38 @ 9% → € 99,06 · € 112,12 @ 21% → € 23,58
// Totaal te voldoen € 1.336,14
const ENKA_ROWS: BtwSplitRow[] = [
  { rate: 9, base: 1101.38, btw: 99.06 },
  { rate: 21, base: 112.12, btw: 23.58 },
]
const ENKA_EX = 1213.5
const ENKA_BTW_PRINTED = 122.64   // 99,06 + 23,58
const ENKA_BTW_STORED = 122.18    // what the app read

test('[BTW-SPLIT] the Enka invoice: stored btw is a blend, so nothing corroborates it', () => {
  const v = classifyBtwSplit({ totalExBtw: ENKA_EX, btwAmount: ENKA_BTW_STORED })
  assert.equal(v.kind, 'blend-unverified', 'a blended rate is not a checked rate')
  assert.equal(btwSplitCorroborated(v), false, 'and it must never count as a pass')

  // The reason this was invisible: the two candidate figures blend to rates one apart, and BOTH
  // are legal. No rate test can separate them — which is exactly why the answer is "not checked"
  // and not "checked, fine".
  assert.equal((v as { rate: number }).rate, 10, 'stored blends to 10%')
  const truth = classifyBtwSplit({ totalExBtw: ENKA_EX, btwAmount: ENKA_BTW_PRINTED })
  assert.equal(truth.kind, 'blend-unverified', 'the CORRECT btw is equally unverifiable on its own')
})

test('[BTW-SPLIT] with the printed block read, the € 0,46 is caught', () => {
  const v = classifyBtwSplit({
    totalExBtw: ENKA_EX,
    btwAmount: ENKA_BTW_STORED,
    rows: ENKA_ROWS,
  })
  assert.equal(v.kind, 'blend-mismatch')
  assert.equal(btwSplitCorroborated(v), false)
  if (v.kind !== 'blend-mismatch') return
  assert.equal(v.rowsBtw, 122.64, 'the btw column of the printed block')
  assert.equal(v.rowsBase, 1213.5, 'and its grondslag column')
  assert.equal(v.baseAgrees, true, 'which reproduces our excl exactly — so the block is trustworthy')

  // The half that makes it actionable: naming the figure the paper supports.
  const detail = btwSplitDetail(v, ENKA_BTW_STORED)
  assert.ok(detail?.includes('122,64'), 'says what the invoice adds up to')
  assert.ok(detail?.includes('122,18'), 'and what we stored, so the owner can see the gap')
})

test('[BTW-SPLIT] the same block over the CORRECT btw verifies instead of flagging', () => {
  const v = classifyBtwSplit({
    totalExBtw: ENKA_EX,
    btwAmount: ENKA_BTW_PRINTED,
    rows: ENKA_ROWS,
  })
  assert.equal(v.kind, 'blend-verified', 'both columns reproduce what we stored')
  assert.equal(btwSplitCorroborated(v), true, 'THIS is how a mixed-rate invoice earns a tick')
})

test('[BTW-SPLIT] an ordinary single-rate invoice is corroborated without any block', () => {
  // 21% — the everyday case. Two constraints hold (the sum identity elsewhere, the exact rate
  // here), so the amounts check each other and the row is a genuine pass.
  const v21 = classifyBtwSplit({ totalExBtw: 100, btwAmount: 21 })
  assert.deepEqual(v21, { kind: 'single-rate', rate: 21 })
  assert.equal(btwSplitCorroborated(v21), true)

  // 9%, with the cent-rounding a real invoice carries (257,85 × 9% = 23,2065 → printed 23,21).
  const v9 = classifyBtwSplit({ totalExBtw: 257.85, btwAmount: 23.21 })
  assert.deepEqual(v9, { kind: 'single-rate', rate: 9 }, 'rounding to the cent is not a blend')

  // 0% — verlegd / intracommunautair / a pure statiegeld credit.
  assert.deepEqual(classifyBtwSplit({ totalExBtw: 480, btwAmount: 0 }), { kind: 'single-rate', rate: 0 })
})

test('[BTW-SPLIT] a rate NEAR a legal one but not on it is a blend, not a pass', () => {
  // The failure a percentage-point tolerance would produce: 9,4% rounds to 9 and would have been
  // waved through as "9% over het hele bedrag". It is a mix of 9% and 21% goods, and the btw is
  // not verified by anything.
  const v = classifyBtwSplit({ totalExBtw: 1000, btwAmount: 94 })
  assert.equal(v.kind, 'blend-unverified')
  assert.equal(btwSplitCorroborated(v), false)
})

test('[BTW-SPLIT] an impossible rate stays flagged, and a missing split says nothing', () => {
  // Above 21% no NL rate and no blend of them can reach — the horeca case [BTW-SUM-FIX] repairs.
  assert.equal(classifyBtwSplit({ totalExBtw: 3413.92, btwAmount: 995.9 }).kind, 'impossible')
  // btw over an empty base: an infinite rate.
  assert.equal(classifyBtwSplit({ totalExBtw: 0, btwAmount: 13.42 }).kind, 'impossible')

  // No split read at all → the arithmetic row already reports that. Two rows saying the same
  // thing is noise; the checklist drops this one.
  assert.equal(classifyBtwSplit({ totalExBtw: null, btwAmount: null }).kind, 'no-basis')
  assert.equal(classifyBtwSplit({ totalExBtw: 100, btwAmount: null }).kind, 'no-basis')
  assert.equal(classifyBtwSplit({ totalExBtw: 0, btwAmount: 0 }).kind, 'no-basis')
})

test('[BTW-SPLIT] a creditnota is judged on magnitude, not on sign', () => {
  // All three negative, 21% — a normal creditnota. It must read exactly like its positive twin,
  // or every credit would land in the queue with a btw warning.
  const v = classifyBtwSplit({ totalExBtw: -100, btwAmount: -21 })
  assert.deepEqual(v, { kind: 'single-rate', rate: 21 })

  // A block whose rows carry the SAME sign as the totals verifies normally. This is the UBL path,
  // where the file states magnitudes and the intake applies one sign to rows and totals alike.
  const credit = classifyBtwSplit({
    totalExBtw: -1213.5,
    btwAmount: -122.64,
    rows: [{ rate: 9, base: -1101.38, btw: -99.06 }, { rate: 21, base: -112.12, btw: -23.58 }],
  })
  assert.equal(credit.kind, 'blend-verified')

  // And the failure this guards: rows left POSITIVE against negative totals read as a mismatch.
  // Which is why the PDF reader does not store a block for a creditnota at all — the sign of a
  // printed specification row is genuinely ambiguous there, and a false flag on every credit note
  // costs more than the check is worth. See the exclusion in ai.ts.
  const mixedSign = classifyBtwSplit({
    totalExBtw: -1213.5,
    btwAmount: -122.64,
    rows: [{ rate: 9, base: 1101.38, btw: 99.06 }, { rate: 21, base: 112.12, btw: 23.58 }],
  })
  assert.equal(mixedSign.kind, 'blend-mismatch', 'unsigned rows over signed totals do NOT agree')
})

test('[BTW-SPLIT] a block that contradicts BOTH columns says so instead of naming a winner', () => {
  // When the grondslag column does not reproduce our excl either, the block is not corroborated
  // on its own terms — then pointing at its btw total would be guessing, and the detail must not.
  const v = classifyBtwSplit({
    totalExBtw: 900,
    btwAmount: 100,
    rows: [{ rate: 9, base: 500, btw: 45 }, { rate: 21, base: 300, btw: 63 }],
  })
  assert.equal(v.kind, 'blend-mismatch')
  if (v.kind !== 'blend-mismatch') return
  assert.equal(v.baseAgrees, false)
  const detail = btwSplitDetail(v, 100)
  assert.ok(detail?.includes('controleer de hele uitsplitsing'), 'no winner is named')
  assert.ok(!detail?.includes('waarschijnlijk de juiste btw'), 'and no figure is proposed')
})

test('[BTW-SPLIT] junk rows are ignored rather than treated as a read block', () => {
  // A row with a NaN or a missing column carries no evidence. Dropping it back to "no block"
  // is the honest fallback — inventing a sum out of half a block is not.
  const v = classifyBtwSplit({
    totalExBtw: 100,
    btwAmount: 21,
    rows: [{ rate: 21, base: Number.NaN, btw: 21 }],
  })
  assert.deepEqual(v, { kind: 'single-rate', rate: 21 }, 'falls back to the rate test')
})
