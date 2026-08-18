// [OPENSTAAND-BEWIJS] Pure node test — run: npx tsx --test src/lib/open-invoice-proof.test.ts
//
// The owner knows the app read their invoices right and still does not quite believe the list of
// what they owe. That is not irrational: every screen shows a conclusion and none shows its
// working. What is held here is therefore mostly the SCOPE — the sentence that turns "we found no
// payment" from an absence into a proof — and the one direction the app never asked before: is
// something we call open perhaps already paid?

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { proveOpenInvoices, describeProof, describeHit, isProvingCandidate } from './open-invoice-proof'
// [HERINNER-BEWIJS] The sentence a held reminder is explained with — same module, same rule.
import { describeChaseBlock } from './open-invoice-proof-text'
import type { InvoiceForMatching } from './bank-matching'
import type { BankTransaction } from './bank-parser'

const invoice = (over: Partial<InvoiceForMatching> = {}): InvoiceForMatching => ({
  id: 'inv-1',
  invoice_number: '264091',
  total_inc_btw: 1224.75,
  amount_paid: 0,
  invoice_date: '2026-08-13',
  due_date: '2026-08-13',
  client_name: 'BALKIP B.V.',
  direction: 'incoming',
  status: 'received',
  accountant_status: null,
  vendor_iban: 'NL48INGB0000810658',
  ...over,
})

const tx = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  date: '2026-08-20',
  amount: -1224.75,           // negative = money out, which is what pays a purchase invoice
  currency: 'EUR',
  description: 'FACTUUR 264091 BALKIP',
  counterpartName: 'BALKIP B.V.',
  counterpartIban: 'NL48INGB0000810658',
  reference: null,
  transactionId: 'tx-1',
  rawLine: '',
  ...over,
})

test('[OPENSTAAND-BEWIJS] an invoice we call open, whose payment is sitting in the bank', () => {
  // The fear this whole feature exists for, and the case the app could never answer.
  const proof = proveOpenInvoices([invoice()], [tx()])
  assert.equal(proof.checkedInvoices, 1)
  assert.equal(proof.checkedTransactions, 1)
  assert.equal(proof.hits.length, 1)
  assert.equal(proof.hits[0].invoiceNumber, '264091')
  assert.equal(proof.hits[0].openAmount, 1224.75)
  assert.ok(proof.hits[0].confidence > 0)
  // Both numbers reach the sentence, and the bank text is quoted as the owner will recognise it.
  const line = describeHit(proof.hits[0])
  assert.match(line, /€\s?1\.224,75/)
  assert.match(line, /20 augustus 2026/)
  assert.match(line, /BALKIP/)
  // Curly quotes, as the rest of the catalogue writes them — the QUOTES are the app's punctuation,
  // the string between them is the bank's, and only the second one may never be touched.
  assert.match(line, /\u201cFACTUUR 264091 BALKIP\u201d/, 'the statement text, verbatim')
})

test('[OPENSTAAND-BEWIJS] a payment to somebody else is not a hit', () => {
  // The noise test, and the one that decides whether this feature survives contact with a real
  // administratie: a bill of the same size to a different supplier must not raise an alarm.
  const other = tx({ counterpartName: 'Enka Horeca B.V.', counterpartIban: 'NL02RABO0123456789',
    description: 'Bestelling 88213' })
  const proof = proveOpenInvoices([invoice()], [other])
  assert.equal(proof.hits.length, 0, 'same amount, different party — not a payment of this invoice')
  assert.equal(proof.checkedTransactions, 1, '…and the scope still reports that it was looked at')
})

test('[OPENSTAAND-BEWIJS] money coming IN never settles a purchase invoice', () => {
  // A credit of the same size is a customer paying US. Reading it as "your bill is paid" would be
  // the app inventing a payment out of a receipt.
  const credit = tx({ amount: 1224.75 })
  assert.equal(proveOpenInvoices([invoice()], [credit]).hits.length, 0)
})

test('[OPENSTAAND-BEWIJS] the remaining balance is what is reported, not the full total', () => {
  // Half settled by an earlier instalment. Telling the owner € 1.224,75 may already be paid, when
  // € 612,37 of it demonstrably is, is wrong in the direction that costs money.
  const half = invoice({ amount_paid: 612.38 })
  const rest = tx({ amount: -612.37 })
  const proof = proveOpenInvoices([half], [rest])
  assert.equal(proof.hits.length, 1)
  assert.equal(proof.hits[0].openAmount, 612.37)
})

test('[OPENSTAAND-BEWIJS] one line per invoice, the strongest one', () => {
  // Two plausible payments for one bill is a research project, not an answer. The owner gets the
  // likeliest, and the rest of the truth is one tap away on the bank screen.
  const weak = tx({ transactionId: 'tx-2', date: '2026-09-30', description: 'overboeking',
    counterpartName: 'BALKIP B.V.' })
  const proof = proveOpenInvoices([invoice()], [tx(), weak])
  assert.equal(proof.hits.length, 1)
  assert.equal(proof.hits[0].transaction.description, 'FACTUUR 264091 BALKIP')
})

// ── The sentence that does the real work ─────────────────────────────────────

test('[OPENSTAAND-BEWIJS] the scope is stated even when nothing was found — especially then', () => {
  const clean = describeProof({ direction: 'incoming' as const, checkedInvoices: 12, checkedTransactions: 340, hits: [] }, '2026-08-15')
  assert.match(clean, /12 openstaande inkoopfacturen/)
  assert.match(clean, /340 banktransacties/)
  assert.match(clean, /t\/m 15 augustus 2026/, 'the horizon — where the app stops knowing')
  assert.match(clean, /Geen betaling gevonden/)
})

test('[OPENSTAAND-BEWIJS] no bank data is never reported as a clean check', () => {
  // The failure this sentence exists to prevent: "geen betaling gevonden" over an administratie
  // with no bank statements imported at all reads as reassurance and is the opposite of one.
  const none = describeProof({ direction: 'incoming' as const, checkedInvoices: 12, checkedTransactions: 0, hits: [] }, null)
  assert.doesNotMatch(none, /Geen betaling gevonden/)
  assert.match(none, /nog niet vergeleken/)
  assert.match(none, /importeer je bankafschrift/, 'and it says what would fix it')
})

test('[OPENSTAAND-BEWIJS] an empty list says so instead of implying a search', () => {
  assert.match(describeProof({ direction: 'incoming' as const, checkedInvoices: 0, checkedTransactions: 340, hits: [] }, '2026-08-15'),
    /geen inkoopfacturen open/)
})

test('[OPENSTAAND-BEWIJS] a hit changes the sentence but never removes the scope', () => {
  const hit = { direction: 'incoming' as const, checkedInvoices: 12, checkedTransactions: 340, hits: [{
    invoiceId: 'a', invoiceNumber: '264091', clientName: 'BALKIP B.V.', openAmount: 1224.75,
    transaction: { date: '2026-08-20', amount: -1224.75, description: 'x', counterpartName: 'BALKIP B.V.' },
    confidence: 0.9, reason: 'bedrag en tegenpartij komen overeen',
  }] }
  const text = describeProof(hit, '2026-08-15')
  assert.match(text, /12 openstaande inkoopfacturen vergeleken met 340 banktransacties/)
  assert.match(text, /Bij 1 factuur vonden we tóch een betaling/)
})

test('[OPENSTAAND-BEWIJS] singulars read like Dutch', () => {
  const one = describeProof({ direction: 'incoming' as const, checkedInvoices: 1, checkedTransactions: 1, hits: [] }, '2026-01-02')
  assert.match(one, /1 openstaande inkoopfactuur vergeleken met 1 banktransactie t\/m 2 januari 2026/)
  // The plural of `factuur` is `facturen` — the double u collapses. Appending a suffix produced
  // "inkoopfactuuren", which is not a word and reached the screen before both forms were written out.
  const many = describeProof({ direction: 'incoming' as const, checkedInvoices: 2, checkedTransactions: 2, hits: [] }, '2026-01-02')
  assert.match(many, /2 openstaande inkoopfacturen/)
  assert.doesNotMatch(many, /factuuren/)
  // …and the sales side names itself, so two panels in one session never read as the same sentence.
  const sales = describeProof({ direction: 'outgoing' as const, checkedInvoices: 3, checkedTransactions: 9, hits: [] }, '2026-01-02')
  assert.match(sales, /3 openstaande verkoopfacturen/)
  assert.match(describeProof({ direction: 'outgoing' as const, checkedInvoices: 1, checkedTransactions: 9, hits: [] }, null), /1 openstaande verkoopfactuur/)
})

// ── The gate itself ──────────────────────────────────────────────────────────

test('[OPENSTAAND-BEWIJS] evidence is identity plus amount — never arithmetic alone', () => {
  // Measured, and the reason this is not a confidence threshold. Against the real engine:
  //   € 1.224,75 to a DIFFERENT supplier, no invoice number  → 0.711  (amount + date)
  //   € 612,37 quoting "FACTUUR 264091", exact remainder     → 0.600  (reference + amount)
  // The coincidence outscores the evidence, so any score that admits the second admits the first.
  assert.equal(isProvingCandidate(['amount', 'date']), false, 'the 0.711 coincidence')
  assert.equal(isProvingCandidate(['reference', 'amount']), true, 'the 0.600 evidence')

  // Every identity signal counts, and each still needs the amount to fit.
  for (const id of ['reference', 'iban', 'supplier_iban', 'counterpart', 'memory', 'prepared'] as const) {
    assert.equal(isProvingCandidate([id, 'amount']), true, id)
    assert.equal(isProvingCandidate([id, 'near_amount']), true, `${id} + near`)
    assert.equal(isProvingCandidate([id, 'date']), false, `${id} without an amount that fits`)
    assert.equal(isProvingCandidate([id]), false, `${id} alone`)
  }
  // A date is never evidence of anything on its own, in either role.
  assert.equal(isProvingCandidate(['date']), false)
  assert.equal(isProvingCandidate(['amount']), false, 'the right size is not the right invoice')
  assert.equal(isProvingCandidate([]), false)
})

test('[OPENSTAAND-BEWIJS] the preposition follows the direction of the money', () => {
  // Not decoration. On a purchase invoice the owner looks for money that LEFT ("aan de
  // leverancier"); on a sales invoice for money that ARRIVED ("van de klant"). One wrong word on
  // the screen that has to be trusted most is a sentence read twice and believed half.
  const hit = {
    invoiceId: 'a', invoiceNumber: '2026-014', clientName: 'Kiwi Food Market', openAmount: 2420,
    transaction: { date: '2026-07-14', amount: 2420, description: 'Factuur 2026-014', counterpartName: 'Kiwi Food Market' },
    confidence: 0.9, reason: 'x',
  }
  assert.match(describeHit(hit, 'outgoing'), /van Kiwi Food Market/)
  assert.match(describeHit(hit, 'incoming'), /aan Kiwi Food Market/)
  assert.match(describeHit(hit), /aan Kiwi Food Market/, 'a caller that says nothing gets the purchase side')
})

test('[OPENSTAAND-BEWIJS] a customer payment settles a SALES invoice, and only that', () => {
  // The mirror of the purchase case, proved against the real engine rather than assumed: the sign
  // decides, so a debit of the same size to the same party never settles an invoice we issued.
  const sale = {
    id: 'out-1', invoice_number: '2026-014', total_inc_btw: 2420, amount_paid: 0,
    invoice_date: '2026-07-01', due_date: '2026-07-15', client_name: 'Kiwi Food Market',
    direction: 'outgoing' as const, status: 'sent', accountant_status: null, vendor_iban: null,
  }
  const credit: BankTransaction = {
    date: '2026-07-14', amount: 2420, currency: 'EUR', description: 'Factuur 2026-014',
    counterpartName: 'Kiwi Food Market', counterpartIban: 'NL91ABNA0417164300',
    reference: null, transactionId: 'tx-c', rawLine: '',
  }
  assert.equal(proveOpenInvoices([sale], [credit], 'outgoing').hits.length, 1)
  assert.equal(proveOpenInvoices([sale], [{ ...credit, amount: -2420 }], 'outgoing').hits.length, 0,
    'money going OUT never settles an invoice we issued')
  assert.equal(
    proveOpenInvoices([sale], [{ ...credit, counterpartName: 'Ander Bedrijf B.V.',
      counterpartIban: 'NL02RABO0123456789', description: 'bestelling' }], 'outgoing').hits.length, 0,
    'another customer paying the same amount is not this invoice',
  )
  assert.equal(proveOpenInvoices([sale], [credit], 'outgoing').direction, 'outgoing',
    'the direction travels with the answer — the sentence needs it')
})

test('[HERINNER-BEWIJS] the sentence that stops a reminder names the bank line and what to do', () => {
  // A reminder — and on the cron's last tier a statutory aanmaning naming incassokosten — sent to
  // a customer who already paid is the most expensive mistake this product can make. The app may
  // not decide that on its own: it read two numbers off a statement. So it says what it saw, and
  // leaves the call with the owner.
  const sale: InvoiceForMatching = {
    id: 'out-1', invoice_number: '2026-014', total_inc_btw: 2420, amount_paid: 0,
    invoice_date: '2026-07-01', due_date: '2026-07-15', client_name: 'Kiwi Food Market',
    direction: 'outgoing', status: 'sent', accountant_status: null, vendor_iban: null,
  }
  const credit: BankTransaction = {
    date: '2026-07-14', amount: 2420, currency: 'EUR', description: 'Factuur 2026-014',
    counterpartName: 'Kiwi Food Market', counterpartIban: 'NL91ABNA0417164300',
    reference: null, transactionId: 'tx-c', rawLine: '',
  }
  const hit = proveOpenInvoices([sale], [credit], 'outgoing').hits[0]
  assert.ok(hit, 'the pairing itself still holds')

  const zin = describeChaseBlock(hit)
  // The evidence, in the owner's own bank's words.
  assert.match(zin, /€\s?2\.420,00/)
  assert.match(zin, /14 juli 2026/)
  assert.match(zin, /van Kiwi Food Market/, 'money that ARRIVED — never "aan"')
  // …and the two ways forward. A block with no exit is its own defect: an owner who knows that
  // bank line is for something else must still be able to chase their customer.
  assert.match(zin, /Koppel die betaling/)
  assert.match(zin, /toch/)
  // It never claims the invoice IS paid. The app compared two readings; it did not settle a debt.
  assert.doesNotMatch(zin, /is betaald|al betaald door/)
})

test('[HERINNER-BEWIJS] narrowing to one invoice narrows the ANSWER, never the search', () => {
  // The reminder path asks about one invoice. It may not ask by querying only that invoice: a bank
  // line becomes evidence only once the engine has seen it beside every open invoice, and a
  // per-invoice query would call a payment that fits four invoices "the payment for this one".
  //
  // Held on the pure function, because that is where the property lives — the collector's filter
  // runs on hits that were produced with the whole set in hand.
  const a: InvoiceForMatching = {
    id: 'a', invoice_number: '2026-014', total_inc_btw: 2420, amount_paid: 0,
    invoice_date: '2026-07-01', due_date: '2026-07-15', client_name: 'Kiwi Food Market',
    direction: 'outgoing', status: 'sent', accountant_status: null, vendor_iban: null,
  }
  const b: InvoiceForMatching = { ...a, id: 'b', invoice_number: '2026-015', total_inc_btw: 1100 }
  const credit: BankTransaction = {
    date: '2026-07-14', amount: 2420, currency: 'EUR', description: 'Factuur 2026-014',
    counterpartName: 'Kiwi Food Market', counterpartIban: 'NL91ABNA0417164300',
    reference: null, transactionId: 'tx-c', rawLine: '',
  }
  const whole = proveOpenInvoices([a, b], [credit], 'outgoing')
  // The scope counts BOTH invoices even though only one is being asked about — the number on the
  // panel is the size of the search, and shrinking it to the caller's shortlist would turn the one
  // honest figure into a flattering one.
  assert.equal(whole.checkedInvoices, 2)
  const forA = whole.hits.filter((h) => h.invoiceId === 'a')
  assert.equal(forA.length, 1, 'the invoice the payment quotes is held')
  assert.equal(whole.hits.filter((h) => h.invoiceId === 'b').length, 0,
    'the other invoice of the same customer is not, and a per-invoice query could not tell')
})
