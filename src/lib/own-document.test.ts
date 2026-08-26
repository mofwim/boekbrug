// [EIGEN-FACTUUR] Pure node test — run: npx tsx --test src/lib/own-document.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { looksLikeOwnDocument, matchesOwnInvoiceNumber, ownDocumentNotice, normalizeCompanyName } from './own-document'

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

// ── [EIGEN-NUMMER] Recognised by the number the app itself issued ───────────────────────────────

test('[EIGEN-NUMMER] the role-confusion case: the reader named the CLIENT as the vendor', () => {
  // The measured miss. On Kiwi's own invoice the reader returned vendor = "Stichting Contour de
  // Twern" — the customer — so the identity guard had nothing of the owner to match. The stored
  // row for the same number knows who the client is, and that is exactly who the "vendor" is.
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: '20260004', totalIncBtw: 394.99, vendorName: 'Stichting Contour de Twern' },
    { invoiceNumber: '20260004', totalIncBtw: 394.99, clientName: 'Stichting Contour de Twern' },
  )
  assert.equal(v.isOwn, true)
  assert.equal(v.certainty, 'certain')
  assert.match(ownDocumentNotice(v)!, /factuurnummer 20260004/)
  assert.match(ownDocumentNotice(v)!, /NIET als inkoopfactuur geboekt/)
})

test('[EIGEN-NUMMER] number plus amount is enough, whatever name the reader saw', () => {
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: '20260005', totalIncBtw: 121.0, vendorName: 'Onleesbaar BV' },
    { invoiceNumber: '20260005', totalIncBtw: 121.0, clientName: 'Stichting Contour de Twern' },
  )
  assert.equal(v.isOwn, true)
  assert.equal(v.certainty, 'certain')
})

test('[EIGEN-NUMMER] the number ALONE is a coincidence, not a verdict', () => {
  // Half the country numbers its invoices "20260001, 20260002, …" — a real supplier invoice can
  // share a number with an own outgoing one. Different amount, different party → a real cost that
  // must be booked; skipping it would lose the cost AND the voorbelasting.
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: '20260005', totalIncBtw: 88.5, vendorName: 'Bakkerij Saada' },
    { invoiceNumber: '20260005', totalIncBtw: 121.0, clientName: 'Stichting Contour de Twern' },
  )
  assert.equal(v.isOwn, false)
})

test('[EIGEN-NUMMER] a creditnota matches on its absolute amount', () => {
  // The stored creditnota is negative; the reader reports what the paper says, usually positive.
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: 'CN20260002', totalIncBtw: 50.0, vendorName: 'Stichting Contour de Twern' },
    { invoiceNumber: 'CN20260002', totalIncBtw: -50.0, clientName: 'Andere Klant' },
  )
  assert.equal(v.isOwn, true, 'amount corroborates through the sign')
})

test('[EIGEN-NUMMER] different or junk numbers never match', () => {
  const own = { invoiceNumber: '20260005', totalIncBtw: 121.0, clientName: 'Stichting' }
  assert.equal(matchesOwnInvoiceNumber({ invoiceNumber: '20260006', totalIncBtw: 121.0, vendorName: 'Stichting' }, own).isOwn, false)
  assert.equal(matchesOwnInvoiceNumber({ invoiceNumber: null, totalIncBtw: 121.0, vendorName: 'Stichting' }, own).isOwn, false)
  // A sloppy lookup handing back a row for a DIFFERENT number may not manufacture a verdict.
  assert.equal(matchesOwnInvoiceNumber({ invoiceNumber: '7', totalIncBtw: 121.0, vendorName: 'Stichting' }, { ...own, invoiceNumber: '7' }).isOwn, false, 'too short to be an invoice number')
})

test('[EIGEN-NUMMER] formatting differences in the number do not break the match', () => {
  // "2026-0005" on the paper, "20260005" in the row: same number, written by different hands.
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: '2026-0005', totalIncBtw: 121.0, vendorName: 'X' },
    { invoiceNumber: '20260005', totalIncBtw: 121.0, clientName: 'Y' },
  )
  assert.equal(v.isOwn, true)
})

test('[EIGEN-NUMMER] a zero-total own row cannot corroborate by amount', () => {
  // An own row storing 0 (a voided draft) matching a document reading 0 proves nothing about
  // identity — 0 == 0 for every empty read. Name is then the only way in.
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: '20260009', totalIncBtw: 0, vendorName: 'Onbekend' },
    { invoiceNumber: '20260009', totalIncBtw: 0, clientName: 'Iemand Anders' },
  )
  assert.equal(v.isOwn, false)
})

test('[EIGEN-NUMMER] role confusion WITHOUT the amount agreeing is likely, with the way back in', () => {
  // A customer who also supplies you can collide on a number. The verdict stands (the roles say
  // own work), but as `likely` — whose notice tells the owner how to overrule it.
  const v = matchesOwnInvoiceNumber(
    { invoiceNumber: '20260004', totalIncBtw: 88.5, vendorName: 'Stichting Contour de Twern' },
    { invoiceNumber: '20260004', totalIncBtw: 394.99, clientName: 'Stichting Contour de Twern' },
  )
  assert.equal(v.isOwn, true)
  assert.equal(v.certainty, 'likely')
  assert.match(ownDocumentNotice(v)!, /alsnog inlezen/, 'the notice offers the override')
})
