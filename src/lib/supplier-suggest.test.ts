// [LEVERANCIER-KIEZEN] Pure node test — run: npx tsx --test src/lib/supplier-suggest.test.ts
//
// The names are real ones out of this owner's registry. The case that built the feature: invoice
// 26004628, where the reader took a delivery stamp ("Jim Ketels 01-09-2026 09:38") for the sender
// and the actual company — W. Ketels en Zoon Eierhandel — was nowhere in the PDF's text layer.
// The owner has to type it, and the field has to find it before the spelling matches.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  suggestSuppliers,
  shouldSuggest,
  SUPPLIER_SUGGEST_LIMIT,
  type SupplierChoice,
} from './supplier-suggest'

const REGISTRY: SupplierChoice[] = [
  { id: 'a', name: 'W. Ketels en Zoon Eierhandel', iban: 'NL89RABO0131703501' },
  { id: 'b', name: 'Jim Ketels' },
  { id: 'c', name: 'CAN Vleesgroothandel B.V.', iban: 'NL20ABNA0458266515' },
  { id: 'd', name: 'GROOTHANDEL M.H. BAL V.O.F.' },
  { id: 'e', name: 'OZ&ER FOOD B.V.' },
  { id: 'f', name: 'Coöperatie Univé Zuid-Nederland U.A.' },
  { id: 'g', name: 'Sligro Food Group' },
  { id: 'h', name: 'Silifke Hocaoglu' },
]

const names = (q: string, opts: readonly SupplierChoice[] = REGISTRY, limit?: number) =>
  suggestSuppliers(q, opts, limit).matches.map((m) => m.name)

test('[LEVERANCIER-KIEZEN] half a name with the punctuation left out still finds the company', () => {
  // The exact keystrokes off the screenshot. A substring filter answers nothing here, because the
  // printed name has a period between the W and the K that nobody types.
  assert.deepEqual(names('w kete'), ['W. Ketels en Zoon Eierhandel'])
  assert.deepEqual(names('w ke'), ['W. Ketels en Zoon Eierhandel'])
  // And the misread that caused it is still offered on its own name — it IS a supplier row, and
  // hiding it would hide the island the owner is trying to merge.
  assert.deepEqual(names('jim'), ['Jim Ketels'])
})

test('[LEVERANCIER-KIEZEN] one word finds every supplier that has it, shortest name first', () => {
  assert.deepEqual(names('ketels'), ['Jim Ketels', 'W. Ketels en Zoon Eierhandel'])
})

test('[LEVERANCIER-KIEZEN] typing a word twice is a typo, not a match', () => {
  // Each typed word claims a different word of the name. Answering "ket ket" with a match would
  // hide the slip instead of showing it.
  assert.deepEqual(names('ketels ketels'), [])
  assert.deepEqual(names('ketels zoon'), ['W. Ketels en Zoon Eierhandel'])
})

test('[LEVERANCIER-KIEZEN] accents and case are not part of the name you have to remember', () => {
  assert.deepEqual(names('unive'), ['Coöperatie Univé Zuid-Nederland U.A.'])
  assert.deepEqual(names('UNIVÉ ZUID'), ['Coöperatie Univé Zuid-Nederland U.A.'])
  assert.deepEqual(names('oz&er'), ['OZ&ER FOOD B.V.'])
  assert.deepEqual(names('ozer food'), ['OZ&ER FOOD B.V.'])
})

test('[LEVERANCIER-KIEZEN] the entity form is a word on the screen, so it is searchable', () => {
  // vendorCoreKey strips 'bv' and 'cooperatie' because IDENTITY must survive both spellings. A
  // search that inherited that would answer nothing for a word the owner can read on the row.
  assert.deepEqual(names('cooperatie'), ['Coöperatie Univé Zuid-Nederland U.A.'])
  assert.ok(names('b.v.').includes('OZ&ER FOOD B.V.'))
})

test('[LEVERANCIER-KIEZEN] a whole name typed out is settled — the panel has nothing to add', () => {
  const r = suggestSuppliers('W. Ketels en Zoon Eierhandel', REGISTRY)
  assert.equal(r.settled, true)
  assert.equal(r.matches[0].exact, true)
  // Same name, different spacing and case: still the same supplier, still settled.
  assert.equal(suggestSuppliers('  w. KETELS  en zoon eierhandel ', REGISTRY).settled, true)
  // A prefix of it is NOT settled — that is exactly when the panel must stay open.
  assert.equal(suggestSuppliers('W. Ketels', REGISTRY).settled, false)
})

test('[LEVERANCIER-KIEZEN] an exact name outranks the longer names it is a prefix of', () => {
  const opts: SupplierChoice[] = [
    { id: '1', name: 'Sligro Food Group Nederland B.V.' },
    { id: '2', name: 'Sligro' },
    { id: '3', name: 'Sligro Food Group' },
  ]
  assert.deepEqual(names('Sligro', opts), ['Sligro', 'Sligro Food Group', 'Sligro Food Group Nederland B.V.'])
})

test('[ZOEK-EERLIJK] a capped list says how many it did not show', () => {
  const many: SupplierChoice[] = Array.from({ length: 9 }, (_, i) => ({
    id: `s${i}`, name: `Groothandel ${String.fromCharCode(65 + i)}`,
  }))
  const r = suggestSuppliers('groothandel', many, SUPPLIER_SUGGEST_LIMIT)
  assert.equal(r.matches.length, SUPPLIER_SUGGEST_LIMIT)
  assert.equal(r.hidden, 9 - SUPPLIER_SUGGEST_LIMIT)
  // Nothing held back → nothing claimed.
  assert.equal(suggestSuppliers('ketels', REGISTRY).hidden, 0)
})

test('[LEVERANCIER-KIEZEN] an empty field offers the list itself', () => {
  const r = suggestSuppliers('', REGISTRY)
  assert.equal(r.matches.length, SUPPLIER_SUGGEST_LIMIT)
  assert.equal(r.hidden, REGISTRY.length - SUPPLIER_SUGGEST_LIMIT)
  assert.equal(r.settled, false, 'an empty field has landed on nothing')
  assert.equal(r.matches.every((m) => !m.exact), true)
})

test('[LEVERANCIER-KIEZEN] no registry, no suggestions — and no crash', () => {
  assert.deepEqual(suggestSuppliers('ketels', []), { matches: [], hidden: 0, settled: false })
  assert.deepEqual(suggestSuppliers('ketels', null), { matches: [], hidden: 0, settled: false })
  assert.deepEqual(suggestSuppliers('ketels', undefined), { matches: [], hidden: 0, settled: false })
  // A supplier row whose name is blank is nothing to offer, and must not be offered as one.
  assert.deepEqual(names('', [{ id: 'x', name: '   ' }]), [])
  assert.deepEqual(names('zzzz nothing like this'), [])
})

test('[LEVERANCIER-KIEZEN] a name in another script survives the fold', () => {
  // The word split is on \p{L}, not [a-z]: a non-latin name must not be erased into nothing.
  const opts: SupplierChoice[] = [{ id: 'x', name: 'مؤسسة الشرق للتجارة' }]
  assert.deepEqual(names('الشرق', opts), ['مؤسسة الشرق للتجارة'])
})

test('[LEVERANCIER-KIEZEN] the order does not depend on the order the rows came back in', () => {
  const forward = names('ketels', REGISTRY)
  const reversed = names('ketels', [...REGISTRY].reverse())
  assert.deepEqual(forward, reversed, 'two reads of the same registry must offer the same list')
})

test('[LEVERANCIER-KIEZEN] the panel waits for a second character, but opens empty on focus', () => {
  assert.equal(shouldSuggest('', true), true, 'focus on an empty field shows what you have')
  assert.equal(shouldSuggest('w', true), false, 'one letter is not a search')
  assert.equal(shouldSuggest('w ', true), false, 'nor is one letter with a space after it')
  assert.equal(shouldSuggest('w k', true), true)
  assert.equal(shouldSuggest('', false), false, 'a field nobody is in shows nothing')
  assert.equal(shouldSuggest('ketels', false), false)
})
