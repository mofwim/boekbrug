// [LEVERANCIER-BEWERKEN] Pure node test — run: npx tsx --test src/lib/supplier-edit.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planSupplierEdit, ibanMove, duplicateField, supplierEditTrail } from './supplier-edit'

const OZER = { name: 'OZ&ER FOOD B.V.', iban: 'NL20ABNA0458266515', kvk_number: '63458357', btw_number: 'NL852244872B01' }

test('[LEVERANCIER-BEWERKEN] an unchanged form writes nothing and moves no account number', () => {
  const plan = planSupplierEdit(OZER, { name: 'OZ&ER FOOD  B.V.', iban: 'NL20 ABNA 0458 2665 15', kvk: '63458357', btw: 'NL852244872B01' })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.deepEqual(plan.changes, {})
  assert.equal(plan.iban, null)
})

test('[LEVERANCIER-BEWERKEN] a replaced IBAN is a MOVE: the old number travels with the decision', () => {
  const plan = planSupplierEdit(OZER, { ...OZER, iban: 'NL91ABNA0417164300', kvk: OZER.kvk_number, btw: OZER.btw_number })
  assert.ok(plan.ok)
  if (!plan.ok) return
  assert.deepEqual(plan.iban, { from: 'NL20ABNA0458266515', to: 'NL91ABNA0417164300' })
  assert.deepEqual(Object.keys(plan.changes), ['iban'])
})

test('[LEVERANCIER-BEWERKEN] adding an IBAN where there was none is not a replacement', () => {
  const move = ibanMove({ iban: null }, { iban: 'NL91ABNA0417164300' })
  assert.deepEqual(move, { from: null, to: 'NL91ABNA0417164300' }, 'nothing to keep, nothing to warn about')
  // Clearing one IS a move from a real number: the history keeps it.
  assert.deepEqual(ibanMove({ iban: 'NL20ABNA0458266515' }, { iban: null }), { from: 'NL20ABNA0458266515', to: null })
})

test('[LEVERANCIER-BEWERKEN] a mistyped IBAN is refused before anything is decided', () => {
  const plan = planSupplierEdit(OZER, { ...OZER, iban: 'NL21ABNA0458266515', kvk: OZER.kvk_number, btw: OZER.btw_number })
  assert.equal(plan.ok, false)
  if (plan.ok) return
  assert.equal(plan.field, 'iban')
  assert.equal(plan.code, 'iban_checksum')
})

test('[LEVERANCIER-BEWERKEN] a unique violation names the key it hit, and nothing else does', () => {
  assert.equal(duplicateField({ code: '23505', message: 'duplicate key value violates unique constraint "suppliers_user_iban_uidx"' }), 'iban')
  assert.equal(duplicateField({ code: '23505', message: 'duplicate key value violates unique constraint "suppliers_user_kvk_uidx"' }), 'kvk')
  assert.equal(duplicateField({ code: '23505', message: 'some other index' }), null)
  assert.equal(duplicateField({ code: '42501', message: 'suppliers_user_iban_uidx' }), null, 'only a 23505 is a duplicate')
  assert.equal(duplicateField(null), null)
})

test('[LEVERANCIER-BEWERKEN] the trail holds old beside new, for the fields that moved only', () => {
  const trail = supplierEditTrail(OZER, { iban: 'NL91ABNA0417164300', btw_number: null })
  assert.deepEqual(trail.old, { iban: 'NL20ABNA0458266515', btw_number: 'NL852244872B01' })
  assert.deepEqual(trail.new, { iban: 'NL91ABNA0417164300', btw_number: null })
  assert.equal('name' in trail.old, false, 'an untouched field is not re-confirmed in the trail')
})
