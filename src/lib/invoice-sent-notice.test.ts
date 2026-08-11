// [VERSTUURD] Pure node test — run: npx tsx --test src/lib/invoice-sent-notice.test.ts
//
// This notice is the only thing the app says at the moment an invoice becomes a legal document.
// What is tested here is therefore not layout but PROMISES: that it never claims a send that did
// not happen, that it names the thing that cannot be undone, and that it says nothing about a
// mailbox the owner does not have.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { invoiceSentNotice } from './invoice-sent-notice'

const FACTS = {
  invoiceNumber: '2026-014',
  invoiceType: 'factuur',
  converted: false,
  clientName: 'Stichting Contour de Twern',
  clientEmail: 'info@example.nl',
  totalInc: 394.99,
  replyTo: 'mo@boekbrug.nl',
}

test('[VERSTUURD] no number, no confirmation', () => {
  // The number IS the event: it is what the route mints, what makes the document legal, and what
  // cannot be taken back. A panel that said "verstuurd" without one would be asserting something
  // the response never said — and the owner has no way to check it from there.
  assert.equal(invoiceSentNotice({ ...FACTS, invoiceNumber: null }), null)
  assert.equal(invoiceSentNotice({ ...FACTS, invoiceNumber: '' }), null)
  assert.equal(invoiceSentNotice({ ...FACTS, invoiceNumber: '   ' }), null, 'whitespace is not a number')
  assert.equal(invoiceSentNotice({}), null)
})

test('[VERSTUURD] the number and the irreversibility are both stated', () => {
  const n = invoiceSentNotice(FACTS)!
  assert.ok(n.lead.includes('2026-014'), 'the number belongs in the first line')
  assert.ok(n.definitief.includes('2026-014'))
  // Art. 35 Wet OB. This is the sentence the whole modal exists to make unmissable: a sent invoice
  // is not editable, and the correction path is a creditnota. Losing it would turn the panel into
  // a pat on the back.
  assert.match(n.definitief, /ligt vast/)
  assert.match(n.definitief, /creditnota/)
  assert.ok(n.rows.some(([l, v]) => l === 'Factuurnummer' && v === '2026-014'))
})

test('[VERSTUURD] it says where the document went, and what it cost', () => {
  const n = invoiceSentNotice(FACTS)!
  const rows = Object.fromEntries(n.rows)
  assert.equal(rows['Aan'], 'Stichting Contour de Twern')
  assert.equal(rows['Verstuurd naar'], 'info@example.nl')
  assert.equal(rows['Bedrag'], '€ 394,99', 'Dutch comma, on the screen the owner reads')
})

test('[VERSTUURD] a fact that is missing is left out, never filled with a dash', () => {
  // "Verstuurd naar —" reads as "it went nowhere", which is the opposite of what happened. An
  // absent row asks no question; a dash answers one wrongly.
  const n = invoiceSentNotice({ ...FACTS, clientEmail: null, clientName: '  ', totalInc: null })!
  const labels = n.rows.map(([l]) => l)
  assert.deepEqual(labels, ['Factuurnummer'])
  assert.equal(n.lead, 'Factuur 2026-014 is verstuurd.', 'no name, so no "onderweg naar"')
})

test('[VERSTUURD] a non-finite amount never reaches the screen', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const n = invoiceSentNotice({ ...FACTS, totalInc: bad })!
    assert.ok(!n.rows.some(([l]) => l === 'Bedrag'), `€ ${bad} may not be shown as an amount`)
  }
})

test('[VERSTUURD] the reply line appears only when there IS a reply address', () => {
  // The route sets Reply-To from profiles.email and reports it back. Without one, a reply goes to
  // the noreply sender — so telling the owner "replies come to you" would send them watching an
  // inbox that will never receive anything. With one, the address is NAMED, because "it comes to
  // you" cannot be checked and "it comes to mo@boekbrug.nl" can.
  const met = invoiceSentNotice(FACTS)!
  assert.ok(met.controle.some((r) => r.includes('mo@boekbrug.nl')))

  for (const zonder of [null, '', '   ']) {
    const n = invoiceSentNotice({ ...FACTS, replyTo: zonder })!
    assert.ok(!n.controle.some((r) => /[Aa]ntwoord/.test(r)), `replyTo=${JSON.stringify(zonder)}: no promise about replies`)
  }
})

test('[VERSTUURD] it does not claim the customer received or read anything', () => {
  // The route knows one thing: the mail provider accepted the message. Not that it was delivered,
  // not that it was opened, and there is no bounce handling to lean on. Every sentence here has to
  // survive a customer saying "I never got it".
  const n = invoiceSentNotice(FACTS)!
  const all = [n.title, n.lead, n.definitief, ...n.controle].join(' ').toLowerCase()
  for (const overclaim of ['ontvangen', 'gelezen', 'bezorgd', 'aangekomen', 'in de inbox']) {
    assert.ok(!all.includes(overclaim), `may not claim "${overclaim}" — the app cannot know that`)
  }
  assert.ok(all.includes('verstuurd') || all.includes('onderweg'))
})

test('[VERSTUURD] it points at things the owner can go and look at', () => {
  // The question this answers is "how do I know it arrived correctly?". An answer that is only
  // reassurance is worthless; each line has to name somewhere they can actually look.
  const n = invoiceSentNotice(FACTS)!
  assert.ok(n.controle.some((r) => r.includes('Facturen') && r.includes('Verzonden')))
  assert.ok(n.controle.some((r) => r.includes('PDF')))
  // And the honest limit that makes the rest trustworthy: a failed send does not land here.
  assert.ok(n.controle.some((r) => r.includes('mislukt')))
})

test('[VERSTUURD] a creditnota says creditnota, everywhere', () => {
  // A panel that calls a credit note a "factuur" is telling the owner they just billed a customer
  // they were in fact refunding — at exactly the moment the number becomes permanent.
  const n = invoiceSentNotice({ ...FACTS, invoiceType: 'creditnota' })!
  assert.equal(n.title, 'Creditnota verstuurd')
  assert.match(n.lead, /^Creditnota 2026-014/)
  assert.ok(n.rows.some(([l]) => l === 'Creditnotanummer'))
  assert.ok(n.controle.some((r) => r.includes('creditnota')))
  // An unknown type reads as a factuur, which is what the send route mints by default.
  assert.equal(invoiceSentNotice({ ...FACTS, invoiceType: null })!.title, 'Factuur verstuurd')
})

test('[VERSTUURD] a converted offerte is told what happened to the offerte', () => {
  // From this screen the same button also converts a quote. The owner's mental model is "my
  // offerte", so the sentence starts there — and the irreversibility still lands.
  const n = invoiceSentNotice({ ...FACTS, converted: true })!
  assert.match(n.definitief, /offerte is nu factuur 2026-014/)
  assert.match(n.definitief, /creditnota/)
})
