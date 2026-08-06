// [E-FACTUUR] Pure node test — run: npx tsx --test src/lib/e-invoice.test.ts
//
// Every other way this app is sure of a number checks a READING: the arithmetic compares three
// figures one read produced, field_confidence is the model's opinion of its own answer, [GEGROND]
// asks whether the figure is printed, [DOCCHECK] asks where. An e-invoice is not a reading. The
// supplier states the totals in structured form, inside the same bytes, and the app could not see
// any of it.
//
// So what is held here is mostly the REFUSALS. A half-parsed e-invoice is worse than none, because
// whatever it produced would outrank the model.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'

import {
  extractEmbeddedInvoiceXml, parseEInvoice, eInvoiceContradicts, looksLikeInvoiceXml,
} from './e-invoice'

/** Factur-X / ZUGFeRD. Prefixes deliberately NOT the conventional rsm:/ram: — see below. */
const cii = (o: { inc: string; ex: string; btw: string; cur?: string; nr?: string }) => `<?xml version="1.0" encoding="UTF-8"?>
<x:CrossIndustryInvoice xmlns:x="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:y="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <x:ExchangedDocument><y:ID>${o.nr ?? '2026-0418'}</y:ID></x:ExchangedDocument>
  <x:SupplyChainTradeTransaction>
    <y:IncludedSupplyChainTradeLineItem>
      <y:SpecifiedLineTradeSettlement>
        <y:SpecifiedTradeSettlementLineMonetarySummation>
          <y:LineTotalAmount>999999.99</y:LineTotalAmount>
        </y:SpecifiedTradeSettlementLineMonetarySummation>
      </y:SpecifiedLineTradeSettlement>
    </y:IncludedSupplyChainTradeLineItem>
    <y:ApplicableHeaderTradeSettlement>
      <y:SpecifiedTradeSettlementHeaderMonetarySummation>
        <y:TaxBasisTotalAmount>${o.ex}</y:TaxBasisTotalAmount>
        <y:TaxTotalAmount currencyID="${o.cur ?? 'EUR'}">${o.btw}</y:TaxTotalAmount>
        <y:GrandTotalAmount currencyID="${o.cur ?? 'EUR'}">${o.inc}</y:GrandTotalAmount>
        <y:DuePayableAmount>${o.inc}</y:DuePayableAmount>
      </y:SpecifiedTradeSettlementHeaderMonetarySummation>
    </y:ApplicableHeaderTradeSettlement>
  </x:SupplyChainTradeTransaction>
</x:CrossIndustryInvoice>`

/** Peppol / NLCIUS. Note the per-rate TaxSubtotal carrying the same element names as the header. */
const ubl = (o: { inc: string; ex: string; cur?: string; nr?: string }) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>
  <cbc:ID>${o.nr ?? 'RE0801378'}</cbc:ID>
  <cbc:IssueDate>2026-03-12</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cbc:ID>NL001234567B01</cbc:ID></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">71.95</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">11.11</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">1.00</cbc:TaxAmount>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${o.ex}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${o.cur ?? 'EUR'}">${o.ex}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${o.cur ?? 'EUR'}">${o.inc}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${o.cur ?? 'EUR'}">${o.inc}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`

test('[E-FACTUUR] a Factur-X invoice states its own totals, and they are read exactly', () => {
  const f = parseEInvoice(cii({ inc: '871.40', ex: '799.45', btw: '71.95' }))
  assert.ok(f, 'the figures must be found')
  assert.equal(f?.totalIncBtw, 871.4)
  assert.equal(f?.totalExBtw, 799.45)
  assert.equal(f?.btwAmount, 71.95)
  assert.equal(f?.syntax, 'cii')
  assert.equal(f?.invoiceNumber, '2026-0418')
})

test('[E-FACTUUR] a per-rate figure is never mistaken for the document total', () => {
  // UBL states the tax once per RATE as well as once for the document, using overlapping element
  // names. The BTW here is the difference of the two header figures rather than any TaxAmount,
  // precisely so no ordering of TaxTotal/TaxSubtotal can hand back a per-rate number: a
  // subtraction cannot pick the wrong element, a search can.
  const u = parseEInvoice(ubl({ inc: '871.40', ex: '799.45' }))
  assert.equal(u?.totalExBtw, 799.45, 'not the 11.11 from the TaxSubtotal')
  assert.equal(u?.btwAmount, 71.95, 'and the BTW is the header difference, not a per-rate figure')

  const f = parseEInvoice(cii({ inc: '871.40', ex: '799.45', btw: '71.95' }))
  assert.equal(f?.totalIncBtw, 871.4, 'the header summation, with a line present')
})

test('[E-FACTUUR] a producer that ignores the element order still reads correctly', () => {
  // Both standards fix the sequence, so on a well-formed document "the first ID" and "the ID inside
  // the header" are the same element and the block scoping never earns its keep. That is exactly
  // why it is here: the sequence is an assumption about somebody else's software, and this is
  // money. Real ERP exports do deviate.
  //
  // The first version of these tests claimed the scoping was load-bearing and proved no such
  // thing — every fixture happened to list the right element first, so removing the scoping left
  // them all green. These fixtures put the decoys FIRST, which is the only arrangement that can
  // tell the two implementations apart.
  const uglyUbl = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cac:AccountingSupplierParty><cac:Party><cbc:ID>NL001234567B01</cbc:ID></cac:Party></cac:AccountingSupplierParty>
  <cbc:ID>RE0801378</cbc:ID>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  const u = parseEInvoice(uglyUbl)
  assert.equal(u?.totalIncBtw, 121)
  assert.equal(u?.invoiceNumber, null,
    'a supplier VAT number is not this invoice\'s number — better nothing than the wrong one')

  // CII with a line item listed before the document header, and an ID on it.
  const uglyCii = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram">
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:ID>0001</ram:ID></ram:AssociatedDocumentLineDocument>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>799.45</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">71.95</ram:TaxTotalAmount>
        <ram:GrandTotalAmount currencyID="EUR">871.40</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
  <rsm:ExchangedDocument><ram:ID>2026-0418</ram:ID></rsm:ExchangedDocument>
</rsm:CrossIndustryInvoice>`
  const c = parseEInvoice(uglyCii)
  assert.equal(c?.totalIncBtw, 871.4)
  assert.equal(c?.invoiceNumber, '2026-0418', 'the document number, not the line number 0001')

  // And the monetary case that makes the block scoping earn its keep: the ZUGFeRD EXTENDED profile
  // carries tax PER LINE, using the header's own element name. Read document-wide, the first
  // TaxTotalAmount is a line's € 8,40 — which does not add up with the header's other two figures,
  // so the whole e-invoice would be thrown away as inconsistent and the supplier's exact numbers
  // lost for a reason nobody could see.
  const extendedCii = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram">
  <rsm:ExchangedDocument><ram:ID>EXT-1</ram:ID></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedLineTradeSettlement>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>40.00</ram:LineTotalAmount>
          <ram:TaxTotalAmount currencyID="EUR">8.40</ram:TaxTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>799.45</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">71.95</ram:TaxTotalAmount>
        <ram:GrandTotalAmount currencyID="EUR">871.40</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
  const e = parseEInvoice(extendedCii)
  assert.equal(e?.btwAmount, 71.95, "the header's tax total, not the line's 8.40")
  assert.equal(e?.totalIncBtw, 871.4)
})

test('[E-FACTUUR] a Peppol/UBL invoice is read too — one syntax is not the standard', () => {
  // CII and UBL are two spellings of the same European model, and both arrive. An importer that
  // knows only one fails SILENTLY on the other: the totals simply are not where it looked.
  const f = parseEInvoice(ubl({ inc: '1210.00', ex: '1000.00' }))
  assert.ok(f)
  assert.equal(f?.syntax, 'ubl')
  assert.equal(f?.totalIncBtw, 1210)
  assert.equal(f?.totalExBtw, 1000)
  assert.equal(f?.btwAmount, 210)
  assert.equal(f?.invoiceNumber, 'RE0801378')
})

test('[E-FACTUUR] the namespace PREFIX is never what is matched on', () => {
  // rsm:/ram:/cbc:/cac: are conventions, not rules — a producer may bind the same namespace to any
  // prefix. The CII fixture uses x:/y: precisely so a parser keyed on "ram:" reads it as empty,
  // which is the failure that looks exactly like "this PDF has no e-invoice in it".
  assert.ok(parseEInvoice(cii({ inc: '100.00', ex: '90.00', btw: '10.00' })), 'x:/y: prefixes')
  // And a default-namespaced UBL with no prefix at all on the root.
  assert.ok(parseEInvoice(ubl({ inc: '121.00', ex: '100.00' })), 'unprefixed root')
})

test('[E-FACTUUR] an e-invoice whose own numbers do not add up is refused', () => {
  // THE MOST IMPORTANT REFUSAL. These figures outrank the model, so a broken document accepted here
  // is worse than no e-invoice support at all.
  assert.equal(parseEInvoice(cii({ inc: '871.40', ex: '799.45', btw: '61.95' })), null)
  // One cent of slack, because two producers round for display differently.
  assert.ok(parseEInvoice(cii({ inc: '871.40', ex: '799.45', btw: '71.96' })), 'a cent is rounding')
  assert.equal(parseEInvoice(cii({ inc: '871.40', ex: '799.45', btw: '71.98' })), null, 'three is not')
})

test('[E-FACTUUR] a non-euro invoice is refused, never silently treated as euro', () => {
  // 1 200 SEK booked as € 1 200 is an error that survives every other check in the building —
  // the arithmetic is perfect, the figure is printed, it sits where a total belongs.
  assert.equal(parseEInvoice(cii({ inc: '1200.00', ex: '960.00', btw: '240.00', cur: 'SEK' })), null)
  assert.equal(parseEInvoice(ubl({ inc: '1210.00', ex: '1000.00', cur: 'USD' })), null)
  assert.ok(parseEInvoice(cii({ inc: '1200.00', ex: '960.00', btw: '240.00', cur: 'EUR' })))
})

test('[E-FACTUUR] anything incomplete is null, and null means "carry on as before"', () => {
  // A half-parsed e-invoice would be trusted. Every one of these must leave the ordinary reading
  // path untouched rather than contribute a figure it is not sure of.
  const missingBasis = cii({ inc: '871.40', ex: '799.45', btw: '71.95' })
    .replace(/<y:TaxBasisTotalAmount>[^<]*<\/y:TaxBasisTotalAmount>/, '')
  assert.equal(parseEInvoice(missingBasis), null, 'a missing figure')

  const empty = cii({ inc: '871.40', ex: '799.45', btw: '71.95' })
    .replace('>871.40<', '><')
  assert.equal(parseEInvoice(empty), null, 'an empty figure')

  assert.equal(parseEInvoice(cii({ inc: '0.00', ex: '0.00', btw: '0.00' })), null, 'a zero total')
  assert.equal(parseEInvoice('<html><body>not an invoice</body></html>'), null)
  assert.equal(parseEInvoice(''), null)
  assert.equal(parseEInvoice('<Invoice xmlns="urn:x"></Invoice>'), null, 'no monetary block')
})

test('[E-FACTUUR] the shape test keeps unrelated XML out, and completeness does the rest', () => {
  // Two gates with two jobs, and the split is deliberate. looksLikeInvoiceXml is CHEAP and only
  // asks "is this an invoice document at all", so an .xml attachment that is something else is
  // never parsed as one. It is not the gate that decides whether the figures may be trusted —
  // complete() is, and an invoice-rooted document with nothing in it still ends at null.
  assert.equal(looksLikeInvoiceXml('<?xml version="1.0"?><Document><BkToCstmrStmt/></Document>'), false,
    'a CAMT bank statement is not an invoice')
  assert.equal(looksLikeInvoiceXml('<html><body>hoi</body></html>'), false)
  assert.ok(looksLikeInvoiceXml('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'))
  assert.ok(looksLikeInvoiceXml('<rsm:CrossIndustryInvoice xmlns:rsm="x"/>'),
    'invoice-shaped, yes — that is all this gate claims')
  assert.equal(parseEInvoice('<rsm:CrossIndustryInvoice xmlns:rsm="x"/>'), null,
    '…and the figures are still refused, which is the gate that matters')
})

test('[E-FACTUUR] a contradiction with the read total is what must never pass unnoticed', () => {
  const f = parseEInvoice(cii({ inc: '871.40', ex: '799.45', btw: '71.95' }))!
  assert.equal(eInvoiceContradicts(f, 871.4), false, 'agreement is not a contradiction')
  assert.equal(eInvoiceContradicts(f, 871.41), false, 'nor is a cent')
  assert.equal(eInvoiceContradicts(f, 87.14), true, 'a slipped decimal is')
  assert.equal(eInvoiceContradicts(f, 799.45), true, 'the subtotal read as the total is')
  // A creditnota is stored negative; the comparison is about MAGNITUDE, not about the sign
  // convention this app happens to use.
  assert.equal(eInvoiceContradicts(f, -871.4), false)
  // Nothing to compare is not a contradiction — a check that could not run never reads as failed.
  assert.equal(eInvoiceContradicts(f, null), false)
  assert.equal(eInvoiceContradicts(f, undefined), false)
})

test('[E-FACTUUR] the XML is pulled back out of a real PDF', async () => {
  // Not a mock: pdf-lib writes a genuine PDF with an embedded, Flate-compressed attachment, and the
  // extractor has to find and inflate it exactly as it would from a supplier's Factur-X file.
  const doc = await PDFDocument.create()
  doc.addPage()
  const xml = cii({ inc: '265.41', ex: '243.50', btw: '21.91' })
  await doc.attach(Buffer.from(xml, 'utf8'), 'factur-x.xml', { mimeType: 'text/xml' })
  const bytes = Buffer.from(await doc.save())

  const found = await extractEmbeddedInvoiceXml(bytes)
  assert.ok(found, 'the attachment must be found')
  const figures = parseEInvoice(found!)
  assert.equal(figures?.totalIncBtw, 265.41)
  assert.equal(figures?.totalExBtw, 243.5)
})

test('[E-FACTUUR] ZUGFeRD 1.0 used a different filename, and it is still found', async () => {
  // An extractor that knows only the current name fails SILENTLY on the older one: the file is
  // right there, nothing looks for it, and the PDF is read as an ordinary picture.
  const doc = await PDFDocument.create()
  doc.addPage()
  await doc.attach(
    Buffer.from(cii({ inc: '50.00', ex: '45.00', btw: '5.00' }), 'utf8'),
    'zugferd-invoice.xml', { mimeType: 'text/xml' },
  )
  const bytes = Buffer.from(await doc.save())
  const found = await extractEmbeddedInvoiceXml(bytes)
  assert.equal(parseEInvoice(found ?? '')?.totalIncBtw, 50)
})

test('[E-FACTUUR] an ordinary PDF, and a broken one, both answer "no e-invoice"', async () => {
  // This runs on untrusted mail inside the sync loop. A malformed PDF must leave the import exactly
  // as it was rather than take the whole batch down with it.
  const plain = await PDFDocument.create()
  plain.addPage()
  assert.equal(await extractEmbeddedInvoiceXml(Buffer.from(await plain.save())), null)

  assert.equal(await extractEmbeddedInvoiceXml(Buffer.from('%PDF-1.4 broken', 'utf8')), null)
  assert.equal(await extractEmbeddedInvoiceXml(Buffer.alloc(0)), null)
  assert.equal(await extractEmbeddedInvoiceXml(Buffer.from([0xff, 0xd8, 0xff])), null, 'a JPEG')
})

test('[E-FACTUUR] a non-invoice attachment inside a PDF is not mistaken for one', async () => {
  const doc = await PDFDocument.create()
  doc.addPage()
  await doc.attach(Buffer.from('<Document><BkToCstmrStmt/></Document>', 'utf8'), 'statement.xml',
    { mimeType: 'text/xml' })
  const bytes = Buffer.from(await doc.save())
  assert.equal(await extractEmbeddedInvoiceXml(bytes), null, 'a CAMT statement is not an e-invoice')
})
