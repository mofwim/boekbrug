// [SCHEME-MERGE] Pure node test — run: npx tsx --test src/lib/scheme-merge.test.ts
//
// ── WHAT THIS PROTECTS, IN ONE SENTENCE ──
// Under the kasstelsel the invoices a quarter SETTLES are mostly not the invoices it DATES, so a
// route that replaces the scheme's per-invoice maps with its own date-range maps deletes exactly
// the half that quarter is about.
//
// The cost is specific and it lands on a filed document. A sale invoiced in Q1 and paid in Q2,
// under a vrijgestelde-omzet regime: its exempt share lives in the scheme's map because that is
// where the settlement points, and nowhere in the Q2 date-range map. Lose it and
// financial-result's `opts.exemptShareByInvoice?.get(id) ?? 0` reads zero exempt — so the whole
// settlement is declared as TAXED omzet and the owner pays BTW on turnover that carries none.
//
// Nothing disagrees with itself when that happens. Every total still adds up; the money is simply
// in the wrong rubriek. That is why it is held here rather than left to a screen to reveal.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeSchemeOpts } from './kas-payment-events-fetch'

/** What resolveSchemeSettlements returns under kas: the invoices the SETTLEMENTS point at. */
const schemeOpts = () => ({
  scheme: 'kas' as const,
  exemptShareByInvoice: new Map([['inv-q1', 1]]),        // a fully exempt sale, invoiced last quarter
  rateSharesByInvoice: new Map([['inv-q1', [{ rate: 0, ex: 1000, btw: 0 }]]]),
})

/** What a route builds from its own date-range query: the invoices DATED in this quarter. */
const localMaps = () => ({
  exemptShareByInvoice: new Map([['inv-q2', 0.5]]),
  rateSharesByInvoice: new Map([['inv-q2', [{ rate: 21, ex: 500, btw: 105 }]]]),
})

test('[SCHEME-MERGE] the settled-in-this-quarter invoices survive the route\'s own map', () => {
  const merged = mergeSchemeOpts(schemeOpts(), localMaps())

  // The one that was being dropped: invoiced in Q1, paid in Q2, fully exempt.
  assert.equal(
    merged.exemptShareByInvoice?.get('inv-q1'), 1,
    'a sale paid this quarter but invoiced in an earlier one keeps its exempt share — without ' +
      'it the settlement is declared as taxed omzet and the owner pays BTW on exempt turnover',
  )
  assert.equal(merged.exemptShareByInvoice?.get('inv-q2'), 0.5, 'and the route\'s own map is still there')
  assert.equal(merged.exemptShareByInvoice?.size, 2)

  // The rate split has exactly the same shape, and it was already merged by hand in one route and
  // not the other — which is why both now go through this function together.
  assert.equal(merged.rateSharesByInvoice?.size, 2)
  assert.ok(merged.rateSharesByInvoice?.has('inv-q1') && merged.rateSharesByInvoice?.has('inv-q2'))
})

test('[SCHEME-MERGE] the freshly-read value wins where both know an invoice', () => {
  // Same precedence the working call site used: the route's own read is the newer one.
  const merged = mergeSchemeOpts(
    { exemptShareByInvoice: new Map([['same', 1]]) },
    { exemptShareByInvoice: new Map([['same', 0.25]]) },
  )
  assert.equal(merged.exemptShareByInvoice?.get('same'), 0.25)
})

test('[SCHEME-MERGE] everything else on the scheme opts is carried, not rebuilt', () => {
  // settlements and priorByInvoice are the kas inputs themselves. A merge that returned a fresh
  // object without them would turn a cash-basis quarter into an empty one.
  const opts = {
    scheme: 'kas' as const,
    settlements: [{ invoiceId: 'x' }] as never,
    priorByInvoice: new Map([['x', { ex: 10, btw: 2.1 }]]),
  }
  const merged = mergeSchemeOpts(opts, { exemptShareByInvoice: new Map([['y', 1]]) })
  assert.equal(merged.scheme, 'kas')
  assert.equal(merged.settlements?.length, 1)
  assert.deepEqual(merged.priorByInvoice?.get('x'), { ex: 10, btw: 2.1 })
})

test('[SCHEME-MERGE] under factuur there is nothing to merge and nothing is invented', () => {
  // resolveSchemeSettlements returns {} on the accrual path, and the accrual branch of
  // computeResult must keep behaving byte-identically — an empty Map is not the same as absent
  // for a caller that checks `opts.rateSharesByInvoice ? … : …`.
  assert.deepEqual(mergeSchemeOpts({}, {}), {})

  const onlyLocal = mergeSchemeOpts({}, { exemptShareByInvoice: new Map([['a', 1]]) })
  assert.equal(onlyLocal.exemptShareByInvoice?.get('a'), 1)
  assert.equal(onlyLocal.rateSharesByInvoice, undefined, 'a map nobody supplied stays absent')
})
