// [EIGEN-FACTUUR] Pure node test — run: npx tsx --test src/lib/own-document.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { looksLikeOwnDocument, ownDocumentNotice, normalizeCompanyName } from './own-document'

/** Kiwi Food Market, from the profile — the real one from the reported case. */
const me = {
  companyName: 'Kiwi Food Market',
  fullName: 'M. Eigenaar',
  kvkNumber: '94386676',
  btwNumber: 'NL005079680B23',
  iban: 'NL73INGB0107197480',
}

test('[EIGEN-FACTUUR] the reported case: our own invoice, mailed back to us', () => {
  // Kiwi invoices Stichting Contour de Twern for EUR 394,99; the copy lands in the mailbox the app
  // reads. Every feature of a purchase invoice is present, so it was booked as one — turnover
  // counted a second time as a cost, and EUR 32,61 of BTW owed also claimed back.
  const v = looksLikeOwnDocument(
    { vendorName: 'Kiwi Food Market', kvkNumber: '94386676', btwNumber: 'NL005079680B23', vendorIban: 'NL73INGB0107197480' },
    me,
  )
  assert.equal(v.isOwn, true)
  assert.equal(v.certainty, 'certain')
  assert.equal(v.reasons.length, 4, 'all four identifiers matched, and each is named')
  assert.match(ownDocumentNotice(v)!, /EIGEN verkoopfactuur/)
  assert.match(ownDocumentNotice(v)!, /NIET als inkoopfactuur geboekt/, 'it says what it did not do')
})

test('[EIGEN-FACTUUR] ONE registration number is enough — and it has to be', () => {
  // A supplier invoice carries the supplier's KVK; ours carries ours. The reader does not always
  // find every field, so requiring all four would mean the guard almost never fires.
  const byKvk = looksLikeOwnDocument({ vendorName: 'Iets anders', kvkNumber: '94386676' }, me)
  assert.equal(byKvk.certainty, 'certain', 'a KVK number belongs to exactly one business')

  const byBtw = looksLikeOwnDocument({ vendorName: null, btwNumber: 'NL005079680B23' }, me)
  assert.equal(byBtw.certainty, 'certain')

  // The payee account: on a purchase invoice this is where YOUR money goes. Your own account
  // there means the document is asking you to pay yourself.
  const byIban = looksLikeOwnDocument({ vendorName: null, vendorIban: 'NL73INGB0107197480' }, me)
  assert.equal(byIban.certainty, 'certain')
  assert.match(byIban.reasons[0], /IBAN/)
})

test('[EIGEN-FACTUUR] the same numbers, written the way documents actually write them', () => {
  const v = looksLikeOwnDocument(
    { kvkNumber: 'KVK 94 38 66 76', btwNumber: 'nl 005079680 b23', vendorIban: 'nl73 ingb 0107 1974 80' },
    me,
  )
  assert.equal(v.certainty, 'certain')
  assert.equal(v.reasons.length, 3, 'spacing, dots and case are formatting, not identity')
})

test('[EIGEN-FACTUUR] a name alone is LIKELY, never certain', () => {
  // Two businesses can share a name; a KVK number cannot be shared. Treating a name match as proof
  // would refuse a real supplier invoice, and an unbooked cost with unclaimed voorbelasting is its
  // own damage — so this one asks instead of deciding.
  const v = looksLikeOwnDocument({ vendorName: 'Kiwi Food Market B.V.' }, me)
  assert.equal(v.isOwn, true)
  assert.equal(v.certainty, 'likely')
  assert.match(ownDocumentNotice(v)!, /Klopt dat niet/, 'the likely notice offers a way back')
})

test('[EIGEN-FACTUUR] a legal form is not part of the name', () => {
  assert.equal(normalizeCompanyName('Kiwi Food Market B.V.'), 'kiwi food market')
  assert.equal(normalizeCompanyName('KIWI FOOD MARKET'), 'kiwi food market')
  assert.equal(normalizeCompanyName('Kiwi Food Market V.O.F.'), 'kiwi food market')
})

test('[EIGEN-FACTUUR] a different business is left alone', () => {
  // The whole risk of this guard sits here. An ordinary purchase invoice must sail through, or the
  // cure costs more than the disease.
  const v = looksLikeOwnDocument(
    { vendorName: 'ATAPACK Cash & Carry B.V.', kvkNumber: '17123456', btwNumber: 'NL812345678B01', vendorIban: 'NL91ABNA0417164300' },
    me,
  )
  assert.equal(v.isOwn, false)
  assert.equal(v.certainty, 'no')
  assert.deepEqual(v.reasons, [])
  assert.equal(ownDocumentNotice(v), null)
})

test('[EIGEN-FACTUUR] a name that CONTAINS ours is a different business', () => {
  // Substring matching would make "Bakkerij Saada Groothandel" our own invoice. It is a supplier.
  const v = looksLikeOwnDocument({ vendorName: 'Kiwi Food Market Groothandel Zuid' }, me)
  assert.equal(v.isOwn, false, 'the name must match entirely, not merely start the same way')
})

test('[EIGEN-FACTUUR] two blanks are not a match', () => {
  // The direction this may never err in. An owner who has not filled in their KVK, and a document
  // the reader found none on, are not the same business because both fields are empty — that
  // would refuse every purchase invoice on a half-filled account.
  const empty = { companyName: null, fullName: null, kvkNumber: null, btwNumber: null, iban: null }
  assert.equal(looksLikeOwnDocument({ vendorName: null, kvkNumber: null }, empty).isOwn, false)
  assert.equal(looksLikeOwnDocument({ vendorName: '', kvkNumber: '' }, empty).isOwn, false)
  assert.equal(looksLikeOwnDocument({}, me).isOwn, false, 'a document with no supplier fields at all')
  assert.equal(looksLikeOwnDocument({ vendorName: 'ATAPACK' }, empty).isOwn, false)
})

test('[EIGEN-FACTUUR] a truncated identifier does not pass as a match', () => {
  // "94386676" against a profile holding "9438" would match on a prefix rule. Both sides must be
  // full-length before they are compared at all.
  assert.equal(looksLikeOwnDocument({ kvkNumber: '9438' }, me).isOwn, false)
  assert.equal(looksLikeOwnDocument({ kvkNumber: '94386676' }, { kvkNumber: '9438' }).isOwn, false)
  assert.equal(looksLikeOwnDocument({ btwNumber: 'NL005079680' }, me).isOwn, false, 'a BTW number without its B-suffix')
  assert.equal(looksLikeOwnDocument({ vendorIban: 'NL73INGB' }, me).isOwn, false)
})

test('[EIGEN-FACTUUR] a sole trader with no company name falls back to their own name', () => {
  const zzp = { companyName: null, fullName: 'Jan de Vries', kvkNumber: null, btwNumber: null, iban: null }
  assert.equal(looksLikeOwnDocument({ vendorName: 'Jan de Vries' }, zzp).certainty, 'likely')
  assert.equal(looksLikeOwnDocument({ vendorName: 'Jan de Vries Hoveniers' }, zzp).isOwn, false)
})
