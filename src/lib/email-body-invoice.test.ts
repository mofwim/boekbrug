// [MAILTEKST] Pure node test — run: npx tsx --test src/lib/email-body-invoice.test.ts
//
// A hosting bill, a phone subscription, a parking app: the invoice IS the e-mail. Both fetchers
// listed on "has an attachment", so those messages were never seen — not skipped, not reported,
// not counted. The cost never entered the books, every month, for as long as the subscription runs.
//
// This is also the most dangerous path in the whole import, because it starts from ORDINARY MAIL.
// Almost everything in a mailbox that carries a euro amount is not an invoice. So most of what is
// held here is what the filter must REFUSE — a false positive becomes a cost that never existed and
// a voorbelasting claim on it, sitting in the queue looking exactly like every real row.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { htmlToReadableText, bodyLooksLikeInvoice, bodyDocumentName } from './email-body-invoice'

/** A real shape: the amounts live in a table, which is what makes the text conversion load-bearing. */
const hostingInvoice = `<html><body>
<p>Beste klant,</p>
<p>Hierbij ontvang je factuur <strong>2026-04188</strong> voor je hosting.</p>
<table>
  <tr><td>Omschrijving</td><td>Bedrag</td></tr>
  <tr><td>Webhosting maart 2026</td><td>&euro;&nbsp;100,00</td></tr>
  <tr><td>Subtotaal</td><td>&euro; 100,00</td></tr>
  <tr><td>BTW 21%</td><td>&euro; 21,00</td></tr>
  <tr><td>Totaal te betalen</td><td>&euro; 121,00</td></tr>
</table>
<p>Met vriendelijke groet</p>
</body></html>`

test('[MAILTEKST] a table becomes readable lines, not one welded string', () => {
  // THE BUG THIS PREVENTS. The naive replace(/<[^>]+>/g,'') welds cells together: "21%€ 21,00"
  // is a token no amount parser can read, and "Totaal€ 121,00" stops the grounding check finding
  // the total that IS on the page — so a correct invoice reads as one whose total is not printed.
  const text = htmlToReadableText(hostingInvoice)
  assert.match(text, /BTW 21% € 21,00/, 'cells are separated by a space, never nothing')
  assert.match(text, /Totaal te betalen € 121,00/)
  // Rows are lines, because the placement check reads "does this amount follow a total word".
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  assert.ok(lines.some((l) => /^Totaal te betalen € 121,00$/.test(l)), 'the total is its own line')
  assert.ok(lines.some((l) => /^BTW 21% € 21,00$/.test(l)), 'and so is the BTW')
})

test('[MAILTEKST] script and style never contribute numbers', () => {
  const text = htmlToReadableText(
    '<style>.a{width:999px;margin:21px}</style><script>var t=99999.99;</script><p>Factuur € 12,10</p>',
  )
  assert.doesNotMatch(text, /999/, 'no CSS pixel values')
  assert.doesNotMatch(text, /99999/, 'no script literals')
  assert.match(text, /Factuur € 12,10/)
})

test('[MAILTEKST] entities are decoded, including the euro sign itself', () => {
  assert.equal(htmlToReadableText('<p>&euro;&nbsp;121,00 &amp; meer</p>'), '€ 121,00 & meer')
  assert.equal(htmlToReadableText('<p>&#8364; 50,00</p>'), '€ 50,00')
})

test('[MAILTEKST] a real body-only invoice is a candidate', () => {
  const text = htmlToReadableText(hostingInvoice)
  const v = bodyLooksLikeInvoice(text, 'Je factuur 2026-04188')
  assert.equal(v.candidate, true, v.reason)
  assert.equal(v.reason, 'body_invoice_candidate')
})

test('[MAILTEKST] everything that merely MENTIONS money is refused', () => {
  // The whole reason this filter can be trusted. Each of these carries a euro amount, most carry a
  // BTW line, and several literally contain the word "factuur" — and not one of them is a bill the
  // owner owes.
  const cases: Array<[string, string]> = [
    ['orderbevestiging', 'Bedankt voor je bestelling! Orderbevestiging. Totaal € 121,00 incl. 21% btw. Factuur volgt.'],
    ['verzendbevestiging', 'Je pakket is onderweg. Verzendbevestiging factuur € 121,00 incl btw 21%.'],
    ['offerte', 'Vrijblijvende offerte voor uw project. Prijsopgave € 1.210,00 incl. 21% btw. Geen factuur.'],
    ['betaling ontvangen', 'Betaling ontvangen! Wij hebben je betaling van € 121,00 incl btw voor factuur 12 verwerkt.'],
    ['betaalverzoek', 'Betaalverzoek: gelieve € 121,00 incl. btw te voldoen voor factuur 998.'],
    ['nieuwsbrief', 'Onze nieuwsbrief! Deze maand korting. Alles vanaf € 121,00 incl. btw. Factuur bij levering. Uitschrijven kan altijd.'],
    ['aanmaning', 'Herinnering: factuur 2026-001 van € 121,00 incl. 21% btw staat nog open.'],
    ['proforma', 'Proforma factuur 2026-001, € 121,00 incl. 21% btw. Dit is geen definitieve factuur.'],
    ['wachtwoord', 'Stel je wachtwoord opnieuw in om je factuur van € 121,00 incl btw te bekijken.'],
  ]
  for (const [label, body] of cases) {
    const v = bodyLooksLikeInvoice(body, label)
    assert.equal(v.candidate, false, `"${label}" must be refused, got ${v.reason}`)
    assert.match(v.reason, /^not_an_invoice:/, `"${label}" must say which shape caught it`)
  }
})

test('[MAILTEKST] all four conditions are required, not any of them', () => {
  // Each one alone admits far too much, so removing any single one has to change the answer.
  const full = 'Hierbij je factuur 2026-1 voor maart. Subtotaal € 100,00. BTW 21% € 21,00. Totaal € 121,00.'
  assert.equal(bodyLooksLikeInvoice(full, 'Factuur').candidate, true)

  assert.equal(
    bodyLooksLikeInvoice('Hierbij je overzicht voor maart. Subtotaal € 100,00. BTW 21% € 21,00.', 'Overzicht').reason,
    'no_invoice_word', 'a document that never calls itself an invoice',
  )
  assert.equal(
    bodyLooksLikeInvoice('Hierbij je factuur 2026-1 voor maart. Totaal € 121,00 te voldoen.', 'Factuur').reason,
    'no_tax_line', 'no BTW line means nothing to deduct — and it is what a real invoice always states',
  )
  assert.equal(
    bodyLooksLikeInvoice('Hierbij je factuur 2026-1. BTW 21% is van toepassing. Bedrag volgt.', 'Factuur').reason,
    'no_euro_amount', 'an invoice announcement is not an invoice',
  )
  assert.equal(bodyLooksLikeInvoice('Factuur btw € 121,00', 'x').reason, 'body_too_short')
})

test('[MAILTEKST] "btw" and "vat" must be words, not fragments', () => {
  // "vat" inside "private", "privatevat.com" or a tracking URL is not a tax line. Matching it as a
  // substring turns every marketing mail with a link into an invoice candidate.
  assert.equal(
    bodyLooksLikeInvoice(
      'Hierbij je factuur 2026-1 van onze private cloud dienst. Totaal € 121,00 voor deze maand.',
      'Factuur',
    ).reason,
    'no_tax_line',
    '"private" contains "vat" and must not count',
  )
  // …and a genuine one still passes, in either language.
  assert.equal(bodyLooksLikeInvoice(
    'Hierbij je factuur 2026-1. Bedrag € 121,00 waarvan BTW € 21,00 over deze periode.', 'Factuur',
  ).candidate, true)
  assert.equal(bodyLooksLikeInvoice(
    'Please find invoice 2026-1 below. Amount EUR 121.00 including VAT of EUR 21.00 for this period.', 'Invoice',
  ).candidate, true)
})

test('[MAILTEKST] an amount needs cents — a newsletter price is not a total', () => {
  assert.equal(
    bodyLooksLikeInvoice(
      'Hierbij je factuur 2026-1 met btw over deze periode. Bedrag € 50 voor de dienst van maart.',
      'Factuur',
    ).reason,
    'no_euro_amount',
  )
  // Every notation these mails actually use.
  for (const amount of ['€ 1.234,56', '€1.234,56', 'EUR 1234.56', '1.234,56 EUR', '€ 121,00']) {
    assert.equal(
      bodyLooksLikeInvoice(`Hierbij je factuur 2026-1, btw inbegrepen. Totaal ${amount} voor maart.`, 'Factuur').candidate,
      true, `${amount} must be recognised`,
    )
  }
})

test('[MAILTEKST] the stored name is stable and recognisable a year later', () => {
  // It is half of the `${messageId}:${filename}` key that stops the same mail importing twice, so
  // it may never contain a clock — and it is what the owner scans for in bestanden.
  assert.equal(bodyDocumentName('Je factuur 2026-04188'), 'Je factuur 2026-04188.pdf')
  assert.equal(bodyDocumentName('Factuur maart/april'), 'Factuur maart-april.pdf')
  assert.equal(bodyDocumentName(''), 'factuur in e-mailtekst.pdf')
  assert.equal(bodyDocumentName(null), 'factuur in e-mailtekst.pdf')
  assert.equal(bodyDocumentName('a'.repeat(200)).length, 84, 'bounded, and still ends in .pdf')
  assert.equal(
    bodyDocumentName('Factuur 2026-1'), bodyDocumentName('Factuur 2026-1'),
    'the same subject always yields the same name — the dedup key depends on it',
  )
})

test('[MAILTEKST] a plain-text body works too, not only HTML', () => {
  const text = 'Factuur 2026-1\n\nWebhosting maart\nSubtotaal EUR 100.00\nVAT 21% EUR 21.00\nTotal EUR 121.00'
  assert.equal(htmlToReadableText(text), text, 'text without tags passes through unchanged')
  assert.equal(bodyLooksLikeInvoice(text, 'Invoice 2026-1').candidate, true)
})
