// [LEVERANCIER-VASTLEGGEN] Pure node test — run: npx tsx --test src/lib/supplier-pin.test.ts
//
// The invoice is real: the leverancier field read "Silifke / Hocaoglu" — a product line printed at
// the top of the page — while the company sending it is OZ&ER FOOD B.V., named further down beside
// its KVK 63458357, its BTW NL852244872B01 and its IBAN NL20ABNA0458266515.
//
// What must hold: the owner's answer is stored as the app's own keys expect it, and a value that
// would POISON a gate is refused rather than stored. A mistyped IBAN here would make every future
// genuine invoice from this supplier look like an account change — which teaches the owner to
// click the fraud warning away.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planSupplierPin, supplierPinChanges, SUPPLIER_PIN_REFUSAL_KEY } from './supplier-pin'
import { MESSAGES } from './i18n/messages'

test('[LEVERANCIER-VASTLEGGEN] the OZ&ER form, normalized the way the registry reads it', () => {
  const plan = planSupplierPin({
    name: '  OZ&ER FOOD  B.V. ',
    iban: 'NL20 ABNA 0458 2665 15',
    kvk: '63458357',
    btw: 'NL 852244872 B01',
  })
  assert.ok(plan.ok, JSON.stringify(plan))
  if (!plan.ok) return
  assert.equal(plan.values.name, 'OZ&ER FOOD B.V.', 'collapsed whitespace, nothing else touched')
  assert.equal(plan.values.iban, 'NL20ABNA0458266515', 'spaces out, upper case — the registry key')
  assert.equal(plan.values.btw, 'NL852244872B01')
  assert.equal(plan.values.kvk, '63458357')
  assert.ok(plan.values.nameKey.length > 0, 'the resolve key is derived here, not by the caller')
})

test('[LEVERANCIER-VASTLEGGEN] a mistyped IBAN is refused, and the refusal says what it would cost', () => {
  // One digit off. Storing it would not be untidy — it would make knownIbanForVendor flag every
  // real invoice from this supplier as an account change.
  const plan = planSupplierPin({ name: 'OZ&ER FOOD B.V.', iban: 'NL21ABNA0458266515' })
  assert.equal(plan.ok, false)
  if (plan.ok) return
  assert.equal(plan.field, 'iban', 'the form must know WHICH field to mark')
  assert.equal(plan.code, 'iban_checksum')
  // The sentence lives in the catalogue, in Dutch first, and names the consequence, not just the rule.
  const dutch = MESSAGES[SUPPLIER_PIN_REFUSAL_KEY[plan.code]].nl
  assert.match(dutch, /controlecijfers/)
  assert.match(dutch, /élke echte factuur/, 'it names the consequence, not just the rule')
})

test('[TAAL] every refusal has a sentence, and the module itself holds none', () => {
  for (const key of Object.values(SUPPLIER_PIN_REFUSAL_KEY)) {
    assert.ok(key in MESSAGES, `${key} exists in messages.ts`)
    assert.ok(MESSAGES[key].nl.length > 0, `${key} has its Dutch`)
  }
})

test('[LEVERANCIER-VASTLEGGEN] empty means CLEAR — that is what makes it an editor', () => {
  const plan = planSupplierPin({ name: 'OZ&ER FOOD B.V.', iban: '', kvk: '', btw: '' })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.equal(plan.values.iban, null)
  assert.equal(plan.values.kvk, null)
  assert.equal(plan.values.btw, null)
})

test('[LEVERANCIER-VASTLEGGEN] a placeholder name is refused — it would collect the whole book', () => {
  for (const naam of ['onbekend', 'Onbekende afzender', '   ']) {
    const plan = planSupplierPin({ name: naam })
    assert.equal(plan.ok, false, `"${naam}" was accepted as a supplier name`)
    if (!plan.ok) assert.equal(plan.field, 'name')
  }
})

test('[LEVERANCIER-VASTLEGGEN] a KVK that is not eight digits, and a btw that is not a btw', () => {
  const kvk = planSupplierPin({ name: 'OZ&ER FOOD B.V.', kvk: '6345835' })
  assert.equal(kvk.ok, false)
  if (!kvk.ok) assert.equal(kvk.field, 'kvk')

  const btw = planSupplierPin({ name: 'OZ&ER FOOD B.V.', btw: 'NL8522448721B01' })
  assert.equal(btw.ok, false)
  if (!btw.ok) assert.equal(btw.field, 'btw')

  // …and a Belgian supplier is not an error. Per-country rules are not encoded; refusing a valid
  // foreign number would be a false alarm on a correct invoice.
  const be = planSupplierPin({ name: 'Delhaize Groep', btw: 'BE0402206045' })
  assert.equal(be.ok, true)
})

test('[LEVERANCIER-VASTLEGGEN] only what MOVED is written, and a rename carries its key', () => {
  const plan = planSupplierPin({
    name: 'OZ&ER FOOD B.V.', iban: 'NL20ABNA0458266515', kvk: '63458357', btw: null,
  })
  assert.ok(plan.ok)
  if (!plan.ok) return

  const changes = supplierPinChanges(
    { name: 'Silifke / Hocaoglu', iban: 'NL20ABNA0458266515', kvk_number: null, btw_number: null },
    plan.values,
  )
  assert.deepEqual(Object.keys(changes).sort(), ['kvk_number', 'name', 'name_key'])
  assert.equal(changes.name, 'OZ&ER FOOD B.V.')
  assert.ok(changes.name_key, 'a rename that does not move the key leaves the supplier unfindable')
  assert.equal('iban' in changes, false, 'an unchanged field is untouched, not re-confirmed')

  // Nothing moved at all → nothing is written, so the trail never records a change that was not one.
  assert.deepEqual(
    supplierPinChanges(
      { name: 'OZ&ER FOOD B.V.', iban: 'NL20ABNA0458266515', kvk_number: '63458357', btw_number: null },
      plan.values,
    ),
    {},
  )
})

test('[LEVERANCIER-STANDAARD] a default not on the form is silence, not a clear', () => {
  const plan = planSupplierPin({ name: 'OZ&ER FOOD B.V.' })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.equal('defaultBtwRate' in plan.values, false, 'the four-field form never mentions the rate')
  const changes = supplierPinChanges(
    { name: 'OZ&ER FOOD B.V.', iban: null, kvk_number: null, btw_number: null, default_btw_rate: 9, default_category: 'kosten' },
    plan.values,
  )
  assert.deepEqual(changes, {}, 'a stored default survives a form that did not carry it')
})

test('[LEVERANCIER-STANDAARD] a default on the form is read, cleared by empty, and refused when it is not a rate', () => {
  const set = planSupplierPin({ name: 'OZ&ER FOOD B.V.', defaultBtwRate: '9', defaultCategory: 'kosten' })
  assert.ok(set.ok)
  if (set.ok) {
    assert.equal(set.values.defaultBtwRate, 9)
    assert.equal(set.values.defaultCategory, 'kosten')
    const changes = supplierPinChanges({ name: 'OZ&ER FOOD B.V.', default_btw_rate: null, default_category: null }, set.values)
    assert.deepEqual(changes, { default_btw_rate: 9, default_category: 'kosten' })
  }
  const cleared = planSupplierPin({ name: 'OZ&ER FOOD B.V.', defaultBtwRate: '', defaultCategory: '' })
  assert.ok(cleared.ok)
  if (cleared.ok) {
    assert.equal(cleared.values.defaultBtwRate, null)
    assert.equal(cleared.values.defaultCategory, null)
    const changes = supplierPinChanges({ name: 'OZ&ER FOOD B.V.', default_btw_rate: 9, default_category: 'kosten' }, cleared.values)
    assert.deepEqual(changes, { default_btw_rate: null, default_category: null }, 'empty means CLEAR — an editor, not a decoration')
  }
  // 19 % was the Dutch rate until 2012 and is not one now; a category the P&L does not know is a typo.
  const badRate = planSupplierPin({ name: 'OZ&ER FOOD B.V.', defaultBtwRate: '19' })
  assert.equal(badRate.ok, false)
  if (!badRate.ok) { assert.equal(badRate.field, 'rate'); assert.equal(badRate.code, 'rate_unknown') }
  const badCat = planSupplierPin({ name: 'OZ&ER FOOD B.V.', defaultCategory: 'brandstof' })
  assert.equal(badCat.ok, false)
  if (!badCat.ok) { assert.equal(badCat.field, 'category'); assert.equal(badCat.code, 'category_unknown') }
})
