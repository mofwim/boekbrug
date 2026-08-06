// [DUP-ON-PAY] Pure node test — run: npx tsx --test src/lib/duplicate-payable.test.ts
//
// Both real pairs are here verbatim, because both were found by the owner adding up their own pay
// list rather than by the app saying anything:
//
//     26701681  Enka Horeca B.V.        € 1.348,14  and  € 1.335,68
//     2601291   Al-Malika Bakkerij B.V. € 128,40    and  € 155,43
//
// The import-time [DEDUP-CORRECTED] flag knows this shape and is deliberately not a block. What
// was missing is the SECOND moment: both copies confirmed, side by side on the pay screen, each
// with a Betalen button, both counted in the total at the top.
//
// The other half is what must NOT be paired, and it is the half that makes the warning worth
// reading: a placeholder number, and two different suppliers who both number from 1.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  findPayableDuplicates,
  duplicateWarningText,
  type DuplicateCandidateRow,
} from './duplicate-payable'

const row = (o: Partial<DuplicateCandidateRow> & { id: string }): DuplicateCandidateRow => ({
  invoice_number: '26701681',
  client_name: 'Enka Horeca B.V.',
  total_inc_btw: 1335.68,
  status: 'received',
  amount_paid: 0,
  ...o,
})

test('[DUP-ON-PAY] the Enka pair is found, and both rows are told', () => {
  const rows = [
    row({ id: 'a', total_inc_btw: 1348.14 }),
    row({ id: 'b', total_inc_btw: 1335.68 }),
    row({ id: 'other', invoice_number: '26302050', client_name: 'ATAPACK Cash & Carry B.V.', total_inc_btw: 6662.8 }),
  ]
  const dups = findPayableDuplicates(rows)
  assert.equal(dups.size, 2, 'both copies carry the warning — the owner may open either one')
  assert.equal(dups.has('other'), false, 'an unrelated invoice is left alone')

  const w = dups.get('a')!
  assert.equal(w.others.length, 1)
  assert.equal(w.amountsDiffer, true, 'a corrected re-issue, not a plain double import')
  assert.equal(w.anyPaid, false)

  // The text has to name the OTHER amount: that is the whole decision, and it is answered by
  // looking at the paper. On this very pair the CORRECT copy was the one our reader got wrong.
  const text = duplicateWarningText(w, '26701681')
  assert.match(text, /26701681/)
  // Row 'a' IS the € 1.348,14 copy, so what it must name is the OTHER one.
  assert.match(text, /1\.335,68/, 'it names what the other copy says')
  assert.match(duplicateWarningText(dups.get('b')!, '26701681'), /1\.348,14/, 'and symmetrically')
  assert.match(text, /correctie of een dubbele import/)
})

test('[DUP-ON-PAY] the Al-Malika pair too, across a differently-read legal suffix', () => {
  // The two imports need not have read the supplier name identically. Folding the legal suffix is
  // what makes the pairing survive that.
  const rows = [
    row({ id: 'x', invoice_number: '2601291', client_name: 'Al-Malika Bakkerij B.V.', total_inc_btw: 128.4 }),
    row({ id: 'y', invoice_number: '2601291', client_name: 'Al-Malika Bakkerij bv', total_inc_btw: 155.43 }),
  ]
  const dups = findPayableDuplicates(rows)
  assert.equal(dups.size, 2)
  assert.match(duplicateWarningText(dups.get('x')!, '2601291'), /155,43/)
})

test('[DUP-ON-PAY] an already-paid twin is the expensive case and says so first', () => {
  const rows = [
    row({ id: 'open' }),
    row({ id: 'settled', status: 'paid', amount_paid: 1335.68 }),
  ]
  const w = findPayableDuplicates(rows).get('open')!
  assert.equal(w.anyPaid, true)
  const text = duplicateWarningText(w, '26701681')
  assert.match(text, /al betaald/, 'about to pay a bill that is already settled')
  assert.doesNotMatch(text, /Verwijder er één/, 'deleting is not the advice when money already moved')
})

test('[DUP-ON-PAY] two copies of the SAME amount read as a double import', () => {
  const w = findPayableDuplicates([row({ id: 'a' }), row({ id: 'b' })]).get('a')!
  assert.equal(w.amountsDiffer, false)
  assert.match(duplicateWarningText(w, '26701681'), /twee keer geïmporteerd/)
})

test('[DUP-ON-PAY] what must NOT be paired', () => {
  // Two suppliers who both number from 1. Numbers are unique PER supplier, not across them —
  // pairing these puts a false warning on two honest invoices.
  const twoSuppliers = findPayableDuplicates([
    row({ id: 'p', invoice_number: '0714', client_name: 'Bakkerij Saada' }),
    row({ id: 'q', invoice_number: '0714', client_name: 'Dutch Sweets Company B.V.' }),
  ])
  assert.equal(twoSuppliers.size, 0)

  // A placeholder is minted per import and can only ever collide by accident.
  const placeholders = findPayableDuplicates([
    row({ id: 'r', invoice_number: 'UPLOAD-1700000000000' }),
    row({ id: 's', invoice_number: 'UPLOAD-1700000000000' }),
  ])
  assert.equal(placeholders.size, 0)

  // No number at all, and no supplier — nothing to key on either way.
  assert.equal(findPayableDuplicates([row({ id: 't', invoice_number: null }), row({ id: 'u', invoice_number: null })]).size, 0)
  assert.equal(findPayableDuplicates([row({ id: 'v', client_name: null }), row({ id: 'w', client_name: null })]).size, 0)

  // And a single invoice is never a duplicate of itself.
  assert.equal(findPayableDuplicates([row({ id: 'only' })]).size, 0)
})

test('[DUP-ON-PAY] spacing in a printed number does not hide the pair', () => {
  // The same folding the hard dedup key uses: "26 / 3958" and "26/3958" are one number.
  const dups = findPayableDuplicates([
    row({ id: 'a', invoice_number: '26 / 3958' }),
    row({ id: 'b', invoice_number: '26/3958' }),
  ])
  assert.equal(dups.size, 2)
})
