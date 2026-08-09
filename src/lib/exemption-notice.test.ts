// [VRIJSTELLING-OP-PAPIER] Pure node test — run: npx tsx --test src/lib/exemption-notice.test.ts
//
// The behaviour is also held end-to-end in invoice-pdf-document.test.ts, which renders a real PDF
// and reads the sentence back off the page. That is the stronger test and it is the one that would
// have caught the original defect. This file exists for the edges a rendered document cannot show
// cheaply: a creditnota's negative amounts, a half-filled line, an owner who wrote the reference
// himself, and the direction this may never err in.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { exemptionNotice, exemptTotal, isExemptLine, EXEMPT_REASON_NL } from './exemption-notice'

/** €500 taxed at a genuine 0% (an export) beside €500 exempt under art. 11 (a course). */
const MIXED = [
  { description: 'Export handelsgoederen', line_total: 500, btw_rate: 0, vat_treatment: null },
  { description: 'Cursus voedselveiligheid', line_total: 500, btw_rate: 0, vat_treatment: 'exempt' },
]

test('[VRIJSTELLING-OP-PAPIER] the reported case: the reference, and the amount it covers', () => {
  const s = exemptionNotice({ lines: MIXED, invoiceType: 'factuur' })
  assert.ok(s, 'an invoice with an exempt line must carry the reference')
  assert.match(s!, /artikel 11 Wet OB 1968/, 'the ground is named — art. 226 punt 11 asks for exactly that')
  assert.match(s!, /€ 500,00/, 'and WHICH € 500 of the € 1.000, because the other half is taxed at 0%')
})

test('[VRIJSTELLING-OP-PAPIER] only the literal flag counts', () => {
  // An unknown value is not an exemption. The write paths already coerce anything else to null;
  // this is the reading side making the same promise.
  assert.equal(isExemptLine({ vat_treatment: 'exempt' }), true)
  assert.equal(isExemptLine({ vat_treatment: 'vrijgesteld' }), false, 'the Dutch word is not the stored value')
  assert.equal(isExemptLine({ vat_treatment: 'EXEMPT' }), false)
  assert.equal(isExemptLine({ vat_treatment: null }), false)
  assert.equal(isExemptLine({}), false)
})

test('[VRIJSTELLING-OP-PAPIER] nothing exempt, nothing said', () => {
  // The direction this may never err in: an exemption claimed on an ordinary invoice is a false
  // statement about the tax, on the document the customer files.
  assert.equal(
    exemptionNotice({
      lines: [{ line_total: 1000, btw_rate: 21, vat_treatment: null }],
      invoiceType: 'factuur',
    }),
    null,
  )
  assert.equal(exemptionNotice({ lines: [], invoiceType: 'factuur' }), null, 'an invoice with no lines')
})

test('[VRIJSTELLING-OP-PAPIER] an offerte makes no BTW statement at all', () => {
  // Same rule the reverse-charge sentence follows: an offer is not a legal invoice.
  for (const t of ['offerte', 'pro_forma', null]) {
    if (t === null) continue
    assert.equal(exemptionNotice({ lines: MIXED, invoiceType: t }), null, `${t} states no ground`)
  }
  // …but a missing type defaults to factuur, because that is what an untyped legal document is.
  assert.ok(exemptionNotice({ lines: MIXED, invoiceType: null }))
})

test('[VRIJSTELLING-OP-PAPIER] a creditnota says it too, without a minus inside the sentence', () => {
  // A creditnota corrects an exempt supply, so it carries the same ground. Its amounts are stored
  // negative; a sentence reading "over € -500,00 is geen btw berekend" would be about arithmetic
  // rather than about a rule.
  const credit = [{ line_total: -500, btw_rate: 0, vat_treatment: 'exempt' }]
  assert.equal(exemptTotal(credit), -500, 'the total keeps the document direction')
  const s = exemptionNotice({ lines: credit, invoiceType: 'creditnota' })
  assert.match(s!, /€ 500,00/)
  assert.doesNotMatch(s!, /-\s*€|€\s*-/, 'the printed amount is a magnitude')
})

test('[VRIJSTELLING-OP-PAPIER] the owner who wrote it himself is not told twice', () => {
  for (const text of ['Cursus — vrijgesteld van btw', 'Behandeling (artikel 11)', 'Zorg, art. 11 Wet OB']) {
    assert.equal(
      exemptionNotice({
        lines: [{ line_total: 500, btw_rate: 0, vat_treatment: 'exempt' }],
        invoiceType: 'factuur',
        lineTexts: [text],
      }),
      null,
      `already referenced in: ${text}`,
    )
  }
})

test('[VRIJSTELLING-OP-PAPIER] a line without line_total falls back to quantity x price', () => {
  // The same precedence the PDF's own rate breakdown uses, so the sentence and the summary can
  // never name different amounts for the same lines.
  assert.equal(exemptTotal([{ quantity: 4, unit_price: 125, vat_treatment: 'exempt' }]), 500)
  assert.equal(exemptTotal([{ line_total: 500, quantity: 99, unit_price: 99, vat_treatment: 'exempt' }]), 500)
  assert.equal(exemptTotal([{ quantity: 3, unit_price: 33.333, vat_treatment: 'exempt' }]), 100)
})

test('[VRIJSTELLING-OP-PAPIER] exempt lines that cancel out say nothing', () => {
  // Not a contrivance: a correction line on the same invoice. Zero exempt turnover means there is
  // no exempt supply to reference, and a sentence about "€ 0,00" would puzzle the reader.
  const lines = [
    { line_total: 500, vat_treatment: 'exempt' },
    { line_total: -500, vat_treatment: 'exempt' },
  ]
  assert.equal(exemptTotal(lines), 0)
  assert.equal(exemptionNotice({ lines, invoiceType: 'factuur' }), null)
})

test('[VRIJSTELLING-OP-PAPIER] the constant is the whole sentence the XML sends', async () => {
  // The point of the shared module: ubl-export must take its BR-E-10 reason from here, so the
  // paper document and the e-invoice cannot describe one supply two ways.
  const { taxExemptionReason } = await import('./ubl-export')
  assert.equal(taxExemptionReason('E'), EXEMPT_REASON_NL)
  assert.equal(taxExemptionReason('Z'), null, 'a genuine 0% supply needs no reason')
  assert.equal(taxExemptionReason('S'), null)
})
