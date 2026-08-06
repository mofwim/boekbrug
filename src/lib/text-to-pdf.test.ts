// [MAILTEKST] Node test — run: npx tsx --test src/lib/text-to-pdf.test.ts
//
// A body-only invoice has to become a real document: for the bewaarplicht, so the rest of the
// pipeline (byte-hash gate, storage, evidence package, re-read) needs no new case, and — the part
// that matters most here — so the TEXT LAYER exists and [GEGROND] can still ask whether the total
// is really in the document's own characters.
//
// So the test that counts is the round trip: what goes in must come back out of the finished PDF.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { textToPdf } from './text-to-pdf'
import { readPdfTextLayer } from './pdf-text'

const header = { subject: 'Je factuur 2026-04188', from: 'Hosting BV <fact@hosting.nl>', date: '2026-03-12' }

test('[MAILTEKST] the amounts survive into the PDF\'s text layer', async () => {
  // The whole reason this is a PDF and not a picture. If the total is not in the text layer,
  // [GEGROND] goes blind and a correct invoice reads as one whose total is not printed.
  const body = 'Webhosting maart 2026\nSubtotaal € 100,00\nBTW 21% € 21,00\nTotaal te betalen € 121,00'
  const pdf = await textToPdf(body, header)
  assert.ok(pdf && pdf.length > 500, 'a PDF came back')

  const text = (await readPdfTextLayer(pdf)).text ?? ''
  assert.match(text, /121,00/, 'the total is readable')
  assert.match(text, /21,00/, 'and the BTW')
  assert.match(text, /€/, 'including the euro sign, which is the one character WinAnsi must keep')
  assert.match(text, /Totaal te betalen/, 'and the words that let the placement check work')
})

test('[MAILTEKST] the document says what it is, so it cannot pass as the supplier\'s own', async () => {
  const pdf = await textToPdf('Factuur € 121,00', header)
  const text = (await readPdfTextLayer(pdf as Buffer)).text ?? ''
  assert.match(text, /tekst van een ontvangen e-mail/, 'stated in plain Dutch on page one')
  assert.match(text, /Je factuur 2026-04188/, 'with the subject')
  assert.match(text, /fact@hosting\.nl/, 'and the sender, so the trail is complete')
})

test('[MAILTEKST] an emoji in a signature cannot take down the import', async () => {
  // pdf-lib THROWS on a character the standard fonts cannot encode. Unhandled, one emoji in a
  // supplier's footer would lose the whole message — and it would look exactly like "no invoice
  // here", which is the failure mode this entire line of work exists to end.
  const pdf = await textToPdf('Totaal € 121,00 🎉\nGroeten 中文 ☎\nBTW € 21,00', header)
  assert.ok(pdf, 'it still renders')
  const text = (await readPdfTextLayer(pdf as Buffer)).text ?? ''
  assert.match(text, /121,00/, 'and the money is still there')
  assert.match(text, /21,00/)
})

test('[MAILTEKST] a very long line is broken, never dropped', async () => {
  // A quoted history or a tracking URL is wider than A4. Dropping the line would silently remove
  // whatever was on it — including, on a one-line HTML body, the total.
  const url = `https://example.com/${'x'.repeat(400)}`
  const pdf = await textToPdf(`${url}\nTotaal € 121,00`, header)
  const text = (await readPdfTextLayer(pdf as Buffer)).text ?? ''
  assert.match(text, /121,00/, 'the money after a monster line is still there')
  assert.ok(text.includes('xxxxxxxxxx'), 'and the long line itself was kept, wrapped')
})

test('[MAILTEKST] a runaway mail is capped, and says it was capped', async () => {
  // Bounded, because this input is untrusted. But a silent truncation would let an owner believe
  // they were looking at the whole message.
  const huge = Array.from({ length: 2500 }, (_, i) => `regel ${i}`).join('\n')
  const pdf = await textToPdf(huge, header)
  const text = (await readPdfTextLayer(pdf as Buffer)).text ?? ''
  assert.match(text, /niet meegenomen \(te lang\)/, 'the cut is named')
  assert.doesNotMatch(text, /regel 2499/, 'and it really did stop')
})

test('[MAILTEKST] an empty body still produces an openable document', async () => {
  const pdf = await textToPdf('', header)
  assert.ok(pdf && pdf.length > 500)
  const text = (await readPdfTextLayer(pdf as Buffer)).text ?? ''
  assert.match(text, /Onderwerp: Je factuur 2026-04188/, 'the header alone is still a record')
})
