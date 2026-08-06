// [DOCCHECK] Pure node test — run: npx tsx --test src/lib/document-verify.test.ts
//
// [GEGROND] proved a figure is PRINTED. Measurement then showed what that still lets through: on a
// real layout, reading the SUBTOTAL, a LINE ITEM or the BTW as the total all came back 'found',
// because all three are printed. Only an invented number was caught.
//
// So the question had to get sharper — is it printed WHERE A TOTAL IS PRINTED? — and this file
// holds both halves of that: the wrong picks are caught, and the correct ones are not flagged.
//
// The second half is the one that decides whether this ships. A false alarm on a correct invoice is
// what makes a safety feature get switched off, and then the real warning is gone too.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  verifyTotal, verifyDate, verifyInvoiceNumber, verifyDocument, documentCheckBlocks,
  amountsIn, anchoredAmounts,
} from './document-verify'

const clean = { date: 'found' as const, invoiceNumber: 'found' as const, btw: 'found' as const }
const blocks = (total: ReturnType<typeof verifyTotal>) => documentCheckBlocks({ total, ...clean })

// The layout every earlier example came from.
const FACTUUR = `
ATAPACK Cash & Carry B.V.   factuur 26302050    01-06-2026
2 x Doos A          149,00        298,00
1 x Doos B          573,24        573,24
Subtotaal                        1.872,24
BTW 21%                            393,17
Totaal te betalen              € 2.265,41
`

test('[DOCCHECK] the four reads [GEGROND] could not tell apart', () => {
  // All four are printed on the paper, so "is it printed?" answers 'found' to every one of them.
  // This is the measurement that produced this module.
  assert.equal(verifyTotal(2265.41, FACTUUR), 'anchored', 'the real total is labelled as the total')
  assert.equal(verifyTotal(1872.24, FACTUUR), 'present', 'the subtotal is printed — and is not the total')
  assert.equal(verifyTotal(573.24, FACTUUR), 'present', 'a line item likewise')
  assert.equal(verifyTotal(393.17, FACTUUR), 'present', 'and the BTW')
  assert.equal(verifyTotal(2266.0, FACTUUR), 'absent', 'an invented figure is not printed at all')

  assert.equal(blocks('anchored'), false)
  for (const v of ['present', 'absent'] as const) {
    assert.equal(blocks(v), true, `${v} must hold the invoice for a human`)
  }
})

test('[DOCCHECK] a correct invoice is never flagged — fourteen real layouts', () => {
  // The half that decides whether this ships. One false alarm on a correct invoice teaches an owner
  // to ignore the warning, and then the true one is gone with it.
  const CORRECT: Array<[string, number, string]> = [
    ['classic Totaal te betalen', 2265.41, 'Subtotaal 1.872,24\nBTW 21% 393,17\nTotaal te betalen € 2.265,41'],
    ['bare Totaal',               121.0,   'Bedrag 100,00\nBTW 21,00\nTotaal 121,00'],
    ['Totaalbedrag',              89.95,   'Artikel 74,34\nBTW 15,61\nTotaalbedrag 89,95'],
    ['Te betalen only',           45.5,    'Levering 37,60\nBTW 7,90\nTe betalen 45,50'],
    ['English total',             500.0,   'Subtotal 413,22\nVAT 86,78\nTotal 500,00'],
    ['German Gesamtbetrag',       238.0,   'Netto 200,00\nMwSt 38,00\nGesamtbetrag 238,00'],
    ['no label at all',           310.0,   'Regel A 100,00\nRegel B 156,20\nBTW 53,80\n310,00'],
    ['Totaal incl. btw',          1000.0,  'Totaal excl. btw 826,45\nBTW 173,55\nTotaal incl. btw 1.000,00'],
    ['dotted leader',             2265.41, 'Totaal te betalen .............. 2.265,41'],
    ['amount before its label',   75.0,    'BTW 13,02\n75,00 Totaal'],
    ['multi-rate invoice',        1210.0,  'Regel 9% 500,00\nRegel 21% 500,00\nBTW 9% 45,00\nBTW 21% 105,00\nSubtotaal 1.000,00\nTotaal 1.210,00'],
    ['creditnota (negative)',     -6.81,   'Creditnota CR0300343\nBTW 1,18\nTotaal te betalen 6,81'],
    ['Eindtotaal',                42.35,   'Post 1 35,00\nBTW 7,35\nEindtotaal 42,35'],
    ['Factuurbedrag',             274.86,  'Levering 227,16\nBTW 47,70\nFactuurbedrag 274,86'],
  ]
  const flagged = CORRECT.filter(([, amt, text]) => blocks(verifyTotal(amt, text))).map(([n]) => n)
  assert.deepEqual(flagged, [], 'these CORRECT invoices were held for a human')
})

test('[DOCCHECK] "totaal excl. btw" must never anchor the incl total', () => {
  // The permissive failure that matters most: if an excl-label anchored, the module would bless the
  // exact read it exists to catch, and do it with more confidence than before.
  const t = 'Totaal excl. btw 826,45\nBTW 173,55\nTotaal incl. btw 1.000,00'
  assert.equal(verifyTotal(826.45, t), 'present', 'the excl figure is not the total')
  assert.equal(verifyTotal(1000.0, t), 'anchored')
  // Same for "Subtotaal", which contains "totaal".
  assert.equal(verifyTotal(1872.24, 'Subtotaal 1.872,24\nTotaal 2.265,41'), 'present')
  assert.ok(!anchoredAmounts('Subtotaal 1.872,24').includes(1872.24))
  assert.ok(!anchoredAmounts('Totaal exclusief btw 826,45').includes(826.45))
})

test('[DOCCHECK] a photo blocks nothing — the check simply did not run', () => {
  assert.equal(verifyTotal(2265.41, null), 'unreadable')
  assert.equal(blocks('unreadable'), false, 'a photographed receipt is the ordinary case, not a defect')
})

test('[DOCCHECK] the date finally has a witness', () => {
  // Under factuurstelsel the invoice date picks the BTW quarter, and nothing had ever compared it
  // with the document. A date read one month wrong moves BTW between two filings.
  for (const printed of [
    'Factuurdatum 01-06-2026', 'Datum: 1-6-2026', 'Datum 01/06/2026', 'Datum 01.06.2026',
    '2026-06-01', '1 juni 2026', '01 juni 2026', '1 jun 2026',
  ]) {
    assert.equal(verifyDate('2026-06-01', printed), 'found', `not found in: ${printed}`)
  }
  assert.equal(verifyDate('2026-07-01', 'Factuurdatum 01-06-2026'), 'absent', 'a month wrong is absent')
  assert.equal(verifyDate('2026-06-01', null), 'unreadable')
  assert.equal(verifyDate(null, 'Datum 01-06-2026'), 'unreadable')
})

test('[DOCCHECK] the invoice number too, and punctuation does not divide it', () => {
  // The number is what makes a duplicate detectable and what a payment quotes. A stored number that
  // is not on the paper is one nothing else can ever reconcile against.
  assert.equal(verifyInvoiceNumber('26302050', FACTUUR), 'found')
  assert.equal(verifyInvoiceNumber('2630-2050', FACTUUR), 'found', 'same number, different punctuation')
  assert.equal(verifyInvoiceNumber('99999999', FACTUUR), 'absent')
  // The app's own placeholders are not claims about the document.
  assert.equal(verifyInvoiceNumber('UPLOAD-1234567', FACTUUR), 'unreadable')
  assert.equal(verifyInvoiceNumber('EMAIL-999', FACTUUR), 'unreadable')
  // Too short to mean anything: confirming it would be noise dressed as evidence.
  assert.equal(verifyInvoiceNumber('7', FACTUUR), 'unreadable')
})

test('[DOCCHECK] only the total holds the invoice — the rest is reported', () => {
  // A date or a number that could not be found is worth SAYING. Holding an invoice for it would
  // fire on every document printing a date in a format nobody predicted, and a queue full of
  // correct invoices is how a safety feature gets switched off.
  assert.equal(documentCheckBlocks({ total: 'anchored', date: 'absent', invoiceNumber: 'absent', btw: 'absent' }), false)
  assert.equal(documentCheckBlocks({ total: 'largest', date: 'absent', invoiceNumber: 'absent', btw: 'absent' }), false)
  assert.equal(documentCheckBlocks({ total: 'present', ...clean }), true)
})

test('[DOCCHECK] amountsIn reads money and ignores everything else', () => {
  // Requiring a 2-digit decimal part is what keeps order numbers, postcodes and article codes out
  // of the largest-amount comparison — one stray 99999 there would make every real total 'present'.
  const t = 'Order 20260601 postcode 1234 AB art. 88123 bedrag 1.234,56 en 78,90'
  assert.deepEqual(amountsIn(t).sort((a, b) => a - b), [78.9, 1234.56])
  // Both separator conventions, decided by whichever comes LAST.
  assert.deepEqual(amountsIn('2.265,41'), [2265.41])
  assert.deepEqual(amountsIn('2,265.41'), [2265.41])
})

test('[DOCCHECK] the whole check composes without inventing anything', () => {
  const c = verifyDocument(
    { totalIncBtw: 2265.41, btwAmount: 393.17, invoiceDate: '2026-06-01', invoiceNumber: '26302050' },
    FACTUUR,
  )
  assert.deepEqual(c, { total: 'anchored', date: 'found', invoiceNumber: 'found', btw: 'found' })

  // No text: every field says the check did not run. Not one of them says 'absent'.
  const blind = verifyDocument(
    { totalIncBtw: 2265.41, btwAmount: 393.17, invoiceDate: '2026-06-01', invoiceNumber: '26302050' },
    null,
  )
  assert.deepEqual(blind, { total: 'unreadable', date: 'unreadable', invoiceNumber: 'unreadable', btw: 'unreadable' })
  assert.equal(documentCheckBlocks(blind), false)
})
