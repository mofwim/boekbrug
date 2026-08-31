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
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib'

import {
  extractEmbeddedInvoiceXml,
  extractEmbeddedInvoiceXmlDetailed, parseEInvoice, eInvoiceContradicts, looksLikeInvoiceXml,
  eInvoiceSettlesAmounts,
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

test('[E-FACTUUR-XML] a Peppol invoice states everything an import needs, and no model reads it', () => {
  // The point of this half: a UBL invoice arriving on its own can be BOOKED without a model looking
  // at anything. Exact figures, exact vendor, exact dates, exact account — stated by the supplier.
  const xml = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cbc:ID>2026-0418</cbc:ID>
  <cbc:IssueDate>2026-03-12</cbc:IssueDate>
  <cbc:DueDate>2026-04-11</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Groothandel handelsnaam</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:RegistrationName>Groothandel Noord B.V.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>De Koper V.O.F.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentID>0123456789012345</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>NL65 RABO 0171 1362 76</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">799.45</cbc:TaxExclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">871.40</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  const f = parseEInvoice(xml)
  assert.ok(f)
  assert.equal(f?.invoiceNumber, '2026-0418')
  assert.equal(f?.invoiceDate, '2026-03-12')
  assert.equal(f?.dueDate, '2026-04-11')
  assert.equal(f?.totalIncBtw, 871.4)
  assert.equal(f?.btwAmount, 71.95)
  // The LEGAL name, and — the part that matters — the SUPPLIER's, not the buyer's. Both parties
  // carry the same element names, and the buyer booked as the supplier is a mistake nothing
  // downstream can catch: the invoice would look perfectly ordinary under the wrong crediteur.
  assert.equal(f?.vendorName, 'Groothandel Noord B.V.')
  // The IBAN is normalised, because it reaches the bank matcher and the payment sheet — the
  // costliest field on the whole invoice to get wrong.
  assert.equal(f?.vendorIban, 'NL65RABO0171136276')
  assert.equal(f?.paymentReference, '0123456789012345')
  assert.equal(f?.isCreditNote, false)
})

test('[E-FACTUUR-XML] a Factur-X header gives the same fields, in its own notation', () => {
  const xml = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram" xmlns:udt="urn:udt">
  <rsm:ExchangedDocument>
    <ram:ID>RE-99</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260312</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Lieferant GmbH</ram:Name></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>De Koper V.O.F.</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE89370400440532013000</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">20260411</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">21.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount currencyID="EUR">121.00</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
  const f = parseEInvoice(xml)
  assert.ok(f)
  assert.equal(f?.invoiceNumber, 'RE-99')
  assert.equal(f?.invoiceDate, '2026-03-12', 'the "102" format is yyyymmdd, not an ISO day')
  assert.equal(f?.dueDate, '2026-04-11')
  assert.equal(f?.vendorName, 'Lieferant GmbH', 'the SELLER, never the buyer')
  assert.equal(f?.vendorIban, 'DE89370400440532013000')
})

test('[E-FACTUUR-XML] the BUYER is never booked as the supplier', () => {
  // Both parties carry the same element names. On a well-formed document the supplier happens to
  // come first, so a document-wide search wins by luck and the scoping looks decorative — which is
  // exactly what the first version of this test proved, and nothing else.
  //
  // Here the customer is listed FIRST. A search that is not scoped now returns "De Koper V.O.F."
  // as the supplier: an invoice that looks perfectly ordinary, filed under a crediteur that does
  // not exist, with the wrong account on the payment sheet. Nothing downstream can catch that.
  const buyerFirst = `<?xml version="1.0"?>
<Invoice xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cbc:ID>2026-9</cbc:ID>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>De Koper V.O.F.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity><cbc:RegistrationName>Groothandel Noord B.V.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  assert.equal(parseEInvoice(buyerFirst)?.vendorName, 'Groothandel Noord B.V.')

  // The same trap in CII: BuyerTradeParty before SellerTradeParty.
  const buyerFirstCii = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:rsm" xmlns:ram="urn:ram">
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerTradeParty><ram:Name>De Koper V.O.F.</ram:Name></ram:BuyerTradeParty>
      <ram:SellerTradeParty><ram:Name>Lieferant GmbH</ram:Name></ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">21.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount currencyID="EUR">121.00</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
  assert.equal(parseEInvoice(buyerFirstCii)?.vendorName, 'Lieferant GmbH')
})

test('[E-FACTUUR-XML] a credit note says so, and a malformed IBAN is dropped rather than carried', () => {
  const credit = `<?xml version="1.0"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cbc:ID>CN-1</cbc:ID>
  <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>rekening onbekend</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</CreditNote>`
  const f = parseEInvoice(credit)
  assert.ok(f)
  assert.equal(f?.isCreditNote, true, 'money coming back, not going out')
  assert.equal(f?.vendorIban, null, 'a value that is not an IBAN never reaches the payment sheet')
})

test('[E-FACTUUR-XML] a field the document does not state stays null, never guessed', () => {
  // The whole value of this path is that nothing is interpreted. A missing vendor is a missing
  // vendor; inventing one would put a crediteur in the books that does not exist.
  const bare = `<Invoice xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  const f = parseEInvoice(bare)
  assert.ok(f, 'the money is complete, so the figures still stand')
  assert.equal(f?.vendorName, null)
  assert.equal(f?.invoiceDate, null)
  assert.equal(f?.dueDate, null)
  assert.equal(f?.vendorIban, null)
  assert.equal(f?.invoiceNumber, null)
})

// ── [E-FACTUUR-BESLECHT] Wanneer het bedrag geen lezing meer is ──────────────
//
// eInvoiceSettlesAmounts is de enige functie in dit bestand die iets TOESTAAT in plaats van
// tegenhoudt: hij zet drie poorten uit die alleen bestaan omdat een bedrag van een pagina wordt
// gelezen. Daarom is elke test hier een poging om hem ten onrechte "ja" te laten zeggen.

test('[E-FACTUUR-BESLECHT] alleen een volledige, kloppende e-factuur beslecht het bedrag', () => {
  const goed = { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: 'cii', contradicts: false }
  assert.equal(eInvoiceSettlesAmounts({ _einvoice: goed }), true)
  assert.equal(eInvoiceSettlesAmounts({ _einvoice: { ...goed, syntax: 'ubl' } }), true)

  // Een tegenspraak beslecht niets — daar hoort juist een mens naar te kijken.
  assert.equal(eInvoiceSettlesAmounts({ _einvoice: { ...goed, contradicts: true } }), false)
})

test('[E-FACTUUR-BESLECHT] afwezigheid van bewijs wordt nooit bewijs', () => {
  // Geen e-factuur, geen field_confidence, of rommel op de plek waar er een hoort te staan.
  // Elk van deze is "de vraag kon niet gesteld worden" en dat is niet hetzelfde als "het antwoord
  // was goed". Zonder deze regel kan de poort worden omzeild door onzin op te slaan.
  const nietBeslecht: unknown[] = [
    null, undefined, {}, 'nee', 42, [],
    { _einvoice: null },
    { _einvoice: {} },
    { _einvoice: { totalIncBtw: 121 } },
    { _einvoice: { totalIncBtw: 121, totalExBtw: 100 } },
    { _einvoice: { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21 } },                    // geen syntax
    { _einvoice: { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: 'xml' } },      // onbekende syntax
    { _einvoice: { totalIncBtw: '121', totalExBtw: 100, btwAmount: 21, syntax: 'cii' } },    // tekst, geen getal
    { _einvoice: { totalIncBtw: NaN, totalExBtw: 100, btwAmount: 21, syntax: 'cii' } },
    { _einvoice: { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: 'cii', contradicts: 'nee' } },
  ]
  for (const fc of nietBeslecht) {
    assert.equal(eInvoiceSettlesAmounts(fc), false, `beslecht niets: ${JSON.stringify(fc)}`)
  }
})

test('[E-FACTUUR-BESLECHT] contradicts moet EXPLICIET false zijn, niet alleen niet-true', () => {
  // eInvoiceOf leest contradicts als `o.contradicts === true`, dus een ontbrekende sleutel wordt
  // false. Dat is hier bewust: de lezer schrijft het veld altijd mee (ai.ts), dus een rij zonder
  // dat veld komt uit een oudere lezing waarin de vergelijking wél gedaan is met dezelfde functie.
  // Vastgelegd omdat het de enige plek is waar "afwezig" als "goed" leest, en dat hoort zichtbaar
  // te zijn in plaats van te worden ontdekt.
  const zonderVeld = { _einvoice: { totalIncBtw: 121, totalExBtw: 100, btwAmount: 21, syntax: 'cii' } }
  assert.equal(eInvoiceSettlesAmounts(zonderVeld), true)
})

test('[E-FACTUUR-BESLECHT] een creditnota beslecht niets, ook met perfecte XML', () => {
  // De naad tussen twee losse wijzigingen: [E-FACTUUR-XML] leerde de parser isCreditNote lezen,
  // [E-FACTUUR-BESLECHT] zet poorten uit. Los van elkaar allebei goed. Samen zou een creditnota
  // die de LEZER niet als creditnota herkende, door de bedragpoorten glippen op gezag van precies
  // het bestand dat net vertelde dat het teken omgekeerd is.
  const basis = { totalIncBtw: 33.87, totalExBtw: 31.07, btwAmount: 2.8, syntax: 'ubl', contradicts: false }
  assert.equal(eInvoiceSettlesAmounts({ _einvoice: basis }), true, 'een gewone factuur beslecht wel')
  assert.equal(eInvoiceSettlesAmounts({ _einvoice: { ...basis, isCreditNote: true } }), false)
})

test('[LEES] a factur-x.xml that will not inflate is REPORTED present, never silently "no XML"', async () => {
  // Build a real PDF with a real attachment, then reload it and corrupt the embedded stream's
  // bytes while its dict still claims FlateDecode — exactly what a truncated upload or a broken
  // producer ships. The supplier DID attach their own figures; "no e-invoice" would be a lie.
  const doc = await PDFDocument.create()
  doc.addPage()
  await doc.attach(Buffer.from(cii({ inc: '100.00', ex: '90.00', btw: '10.00' }), 'utf8'), 'factur-x.xml', { mimeType: 'text/xml' })
  const goed = Buffer.from(await doc.save())

  const herladen = await PDFDocument.load(goed, { updateMetadata: false })
  const names = herladen.catalog.lookup(PDFName.of('Names'), PDFDict)!
  const embedded = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict)!
  const list = embedded.lookup(PDFName.of('Names'), PDFArray)!
  const spec = list.lookup(1, PDFDict)!
  const ef = spec.lookup(PDFName.of('EF'), PDFDict)!
  const stream = (ef.lookup(PDFName.of('F')) ?? ef.lookup(PDFName.of('UF'))) as PDFRawStream
  stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
  ;(stream as unknown as { contents: Uint8Array }).contents = new Uint8Array([1, 2, 3, 4])
  const kapot = Buffer.from(await herladen.save())

  const detailed = await extractEmbeddedInvoiceXmlDetailed(kapot)
  assert.equal(detailed.xml, null, 'the sealed attachment yields no XML')
  assert.equal(detailed.unreadablePresent, true, '…but its PRESENCE is a fact the review screen gets to see')

  // And the ordinary cases stay exactly what they were: a healthy Factur-X reads, a plain PDF
  // answers no-and-nothing-hidden.
  const gezond = await extractEmbeddedInvoiceXmlDetailed(goed)
  assert.ok(gezond.xml, 'the healthy twin still reads')
  assert.equal(gezond.unreadablePresent, false)
  const plain = await PDFDocument.create()
  plain.addPage()
  const leeg = await extractEmbeddedInvoiceXmlDetailed(Buffer.from(await plain.save()))
  assert.equal(leeg.xml, null)
  assert.equal(leeg.unreadablePresent, false)
})

test('[VOORUITBETALING] a deposit already paid does not shrink the voorbelasting', () => {
  // A conformant Peppol invoice with a EUR 200 deposit on it. EN 16931 keeps the two figures
  // apart on purpose:
  //   BR-CO-15  TaxInclusiveAmount = TaxExclusiveAmount + TaxAmount        1210 = 1000 + 210
  //   BR-CO-16  PayableAmount      = TaxInclusiveAmount - PrepaidAmount    1010 = 1210 -  200
  // This parser preferred the PAYABLE and defined the tax as payable - ex, so it read btw 10 on an
  // invoice that states 210 — EUR 200 of deductible BTW gone from rubriek 5b, on a document that
  // stands the money gates down and auto-books, so no human ever sees the figure.
  const withDeposit = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>F-2026-88</cbc:ID>
  <cbc:IssueDate>2026-03-10</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cbc:ID>NL001234567B01</cbc:ID></cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="EUR">200.00</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="EUR">1010.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  const got = parseEInvoice(withDeposit)
  assert.equal(got?.totalExBtw, 1000)
  assert.equal(got?.btwAmount, 210, 'the BTW the supplier states, not the payable minus the net')
  assert.equal(got?.totalIncBtw, 1210, 'the invoice gross, not what is left to pay')

  // A larger deposit used to flip the sign on an ordinary purchase invoice.
  const bigger = parseEInvoice(withDeposit.replace('200.00', '500.00').replace('1010.00', '710.00'))
  assert.equal(bigger?.btwAmount, 210, 'a bigger deposit is still not negative BTW')
  assert.equal(bigger?.totalIncBtw, 1210)
})

test('[VOORUITBETALING] a producer that omits BT-112 is still read exactly', () => {
  // Not conformant, but readable: BR-CO-16 run backwards recovers the gross from the payable.
  const noInclusive = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>F-2026-89</cbc:ID>
  <cbc:IssueDate>2026-03-10</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cbc:ID>NL001234567B01</cbc:ID></cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:PrepaidAmount currencyID="EUR">200.00</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="EUR">1010.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  assert.equal(parseEInvoice(noInclusive)?.btwAmount, 210)
  assert.equal(parseEInvoice(noInclusive)?.totalIncBtw, 1210)
})

test('[VOORUITBETALING] a rounding line moves the payable, not the invoice', () => {
  // BR-CO-16 has a third term: PayableAmount = TaxInclusiveAmount - PrepaidAmount + Rounding.
  // A supplier who rounds the amount due to whole cents (or to 0,05 in some templates) states it
  // in BT-114, and the reconstruction has to SUBTRACT it. Nothing exercised that sign until a
  // negative control flipped it and every test still passed — so the line was unproven.
  const rounded = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>F-2026-90</cbc:ID>
  <cbc:IssueDate>2026-03-10</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cbc:ID>NL001234567B01</cbc:ID></cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:PayableRoundingAmount currencyID="EUR">0.03</cbc:PayableRoundingAmount>
    <cbc:PayableAmount currencyID="EUR">1210.03</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`
  assert.equal(parseEInvoice(rounded)?.totalIncBtw, 1210, 'the three cents belong to the payment, not the invoice')
  assert.equal(parseEInvoice(rounded)?.btwAmount, 210)

  // And both terms at once, which is the case that gets the signs wrong if either is guessed.
  const both = rounded
    .replace('<cbc:PayableRoundingAmount currencyID="EUR">0.03</cbc:PayableRoundingAmount>',
             '<cbc:PrepaidAmount currencyID="EUR">200.00</cbc:PrepaidAmount>\n    <cbc:PayableRoundingAmount currencyID="EUR">0.03</cbc:PayableRoundingAmount>')
    .replace('1210.03', '1010.03')
  assert.equal(parseEInvoice(both)?.totalIncBtw, 1210)
  assert.equal(parseEInvoice(both)?.btwAmount, 210)
})

test('[VOORUITBETALING] the ordinary invoice — no deposit, no rounding — is untouched', () => {
  // The whole point of the change is that it moves nothing on a normal file: with no PrepaidAmount
  // and no PayableRoundingAmount, BR-CO-16 says the payable IS the gross.
  const plain = ubl({ inc: '1210.00', ex: '1000.00' })
  const got = parseEInvoice(plain)
  assert.equal(got?.totalExBtw, 1000)
  assert.equal(got?.btwAmount, 210)
  assert.equal(got?.totalIncBtw, 1210)
})
