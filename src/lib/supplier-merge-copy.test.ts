// [LEVERANCIER-SAMENVOEGEN] Pure node test — run: npx tsx --test src/lib/supplier-merge-copy.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSupplierMergePanel, mergeRefusalText, mergeDoneText } from './supplier-merge-copy'
import { planSupplierMerge, findMergeCandidates, type MergeSupplier } from './supplier-merge'

const KVK = '17123456'
const IBAN = 'NL89RABO0131703501'
const s = (over: Partial<MergeSupplier> & { id: string }): MergeSupplier => ({ name: 'X', invoiceCount: 0, ...over })

test('[LEVERANCIER-SAMENVOEGEN] the offer quotes the proof, not the resemblance', () => {
  const plans = findMergeCandidates([
    s({ id: 'a', name: 'W.KETELS & ZN EIERHANDEL', kvk: KVK, invoiceCount: 25 }),
    s({ id: 'b', name: 'W. Ketels en Zoon Eierhandel', kvk: KVK, invoiceCount: 3 }),
  ])
  const panel = buildSupplierMergePanel(plans, 'nl')
  assert.ok(panel)
  if (!panel) return
  assert.equal(panel.offers.length, 1)
  const o = panel.offers[0]
  // The identifier itself is on the screen — the owner checks it against the paper, and does not
  // take the app's word for who these two are.
  assert.match(o.evidence, /17123456/)
  assert.match(o.effect, /3 facturen/)
  assert.match(o.effect, /W\.KETELS & ZN EIERHANDEL/, 'and says under WHICH name they land')
  assert.equal(o.survivorId, 'a')
  // And the panel states its own rule, so the owner can see the app is not guessing from names.
  assert.match(panel.explanation, /KVK/)
  assert.equal(panel.dir, 'ltr')
})

test('[LEVERANCIER-SAMENVOEGEN] one, none and many are three sentences', () => {
  const one = buildSupplierMergePanel(
    [planSupplierMerge(s({ id: 'a', name: 'Groot', kvk: KVK, invoiceCount: 9 }), s({ id: 'b', name: 'Klein', kvk: KVK, invoiceCount: 1 }))],
    'nl',
  )
  assert.match(one!.offers[0].effect, /^1 factuur /, 'never "1 facturen"')

  const none = buildSupplierMergePanel(
    [planSupplierMerge(s({ id: 'a', name: 'Groot', kvk: KVK, invoiceCount: 9 }), s({ id: 'b', name: 'Leeg eiland', kvk: KVK, invoiceCount: 0 }))],
    'nl',
  )
  // An empty island is not a smaller merge: nothing moves, only a name goes, and it says so.
  assert.match(none!.offers[0].effect, /Leeg eiland/)
  assert.doesNotMatch(none!.offers[0].effect, /0 facturen/)
})

test('[LEVERANCIER-SAMENVOEGEN] a shared account is quoted in full', () => {
  const panel = buildSupplierMergePanel(
    [planSupplierMerge(
      s({ id: 'a', name: 'Sligro', invoiceCount: 9, invoiceIbans: [IBAN] }),
      s({ id: 'b', name: 'Sligro B.V.', invoiceCount: 2, invoiceIbans: [IBAN] }),
    )],
    'nl',
  )
  assert.match(panel!.offers[0].evidence, new RegExp(IBAN))
})

test('[LEVERANCIER-SAMENVOEGEN] nothing to offer is no panel, not an empty one', () => {
  // A heading that asks "twee leveranciers die één bedrijf zijn" over an empty list is a question
  // mark on a screen about money. Absence is this panel's ordinary state.
  assert.equal(buildSupplierMergePanel([], 'nl'), null)
  assert.equal(buildSupplierMergePanel([{ ok: false, reason: 'different-kvk' }], 'nl'), null)
  assert.equal(
    buildSupplierMergePanel(findMergeCandidates([s({ id: 'a', name: 'CAN Vlees B.V.', invoiceCount: 5 }), s({ id: 'b', name: 'CAN Vlees', invoiceCount: 2 })]), 'nl'),
    null,
    'two spellings with nothing to prove them are not an offer',
  )
})

test('[LEVERANCIER-SAMENVOEGEN] a refusal names the fact that decided it', () => {
  // "Kon niet" over a merge invites a retry that can never succeed. Each of these can be acted on.
  assert.match(mergeRefusalText('different-kvk', 'nl'), /twee bedrijven/)
  assert.match(mergeRefusalText('two-accounts', 'nl'), /rekeningnummer/)
  assert.match(mergeRefusalText('stale', 'nl'), /[Vv]erversm?|verouderd/)
  assert.match(mergeRefusalText(null, 'nl'), /niets veranderd/)
  // Every language answers; a gap falls back to Dutch, never to a key.
  for (const locale of ['nl', 'en', 'ar', 'tr'] as const) {
    for (const reason of ['different-kvk', 'two-accounts', 'no-evidence', 'same-supplier', 'stale', null] as const) {
      const text = mergeRefusalText(reason, locale)
      assert.ok(text.length > 5 && !text.includes('lev.merge'), `${locale}/${reason} → ${text}`)
    }
  }
})

test('[LEVERANCIER-SAMENVOEGEN] the confirmation names both companies', () => {
  const done = mergeDoneText('W. Ketels en Zoon Eierhandel', 'W.KETELS & ZN EIERHANDEL', 'nl')
  assert.match(done, /W\. Ketels en Zoon Eierhandel/)
  assert.match(done, /W\.KETELS & ZN EIERHANDEL/)
})

test('[TAAL] the panel carries its own direction', () => {
  const plans = findMergeCandidates([s({ id: 'a', name: 'A', kvk: KVK, invoiceCount: 2 }), s({ id: 'b', name: 'B', kvk: KVK, invoiceCount: 1 })])
  assert.equal(buildSupplierMergePanel(plans, 'ar')!.dir, 'rtl')
  assert.equal(buildSupplierMergePanel(plans, 'nl')!.dir, 'ltr')
  // Arabic is a real translation here, not the Dutch fallback.
  assert.notEqual(buildSupplierMergePanel(plans, 'ar')!.heading, buildSupplierMergePanel(plans, 'nl')!.heading)
})
