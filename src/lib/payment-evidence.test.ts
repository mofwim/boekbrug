// [BETAALBEWIJS] Pure node test — run: npx tsx --test src/lib/payment-evidence.test.ts
//
// The pay screen has always shown "Betaald" and never once read bank_tx_invoices, so the word
// carried no evidence: to check it the owner had to open their bank in another tab — the work the
// app exists to remove, handed back at the exact moment trust is being asked for.
//
// Held here: that the three kinds of claim stay THREE, and that the one the app cannot answer
// never borrows the language of the ones it can.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPaymentEvidenceLine, classifyPayment, describePayment, isBankProven, settledInvoiceIds, type PaymentLink } from './payment-evidence'

const bankLink = (over: Partial<PaymentLink> = {}): PaymentLink => ({
  transactionId: 'tx-1',
  amountApplied: 1224.75,
  paidOn: '2026-08-20',
  method: 'bank',
  transaction: {
    date: '2026-08-20', amount: -1224.75,
    description: 'FACTUUR 264091 BALKIP', counterpartName: 'BALKIP B.V.',
    counterpartIban: 'NL48INGB0000810658',
  },
  ...over,
})

const handLink = (over: Partial<PaymentLink> = {}): PaymentLink => ({
  transactionId: null, amountApplied: 1224.75, paidOn: '2026-08-20', method: 'bank',
  transaction: null, ...over,
})

test('[BETAALBEWIJS] a bank-proven payment quotes the statement the owner recognises', () => {
  const ev = classifyPayment([bankLink()])
  assert.equal(ev.kind, 'bank')
  assert.equal(isBankProven(ev), true)
  const text = describePayment(ev)
  assert.match(text, /€\s?1\.224,75/)
  assert.match(text, /20 augustus 2026/)
  assert.match(text, /BALKIP B\.V\./)
  // Curly quotes, as the rest of the catalogue writes them — the QUOTES are the app's punctuation,
  // the string between them is the bank's, and only the second one may never be touched.
  assert.match(text, /\u201cFACTUUR 264091 BALKIP\u201d/, 'verbatim — recognition is the whole mechanism')
  // The default direction is a purchase invoice: the money LEFT.
  assert.match(text, /afgeschreven/)
})

test('[BETAALBEWIJS] a hand-recorded payment says so, and does not borrow the bank', () => {
  // Usually perfectly true. It is simply not the same claim, and rendering the two identically
  // lends a third party's authority to the owner's own memory.
  const ev = classifyPayment([handLink()])
  assert.equal(ev.kind, 'manual')
  assert.equal(isBankProven(ev), false)
  const text = describePayment(ev)
  // The AMOUNT is named here too now. apply_manual_payment always records one, and on a partly
  // settled invoice an instalment without its figure is exactly the term you cannot check.
  assert.match(text, /€\s?1\.224,75 door jou afgevinkt/)
  assert.match(text, /geen bankregel/)
  assert.doesNotMatch(text, /afgeschreven/, 'nothing was demonstrably debited')
})

test('[BETAALBEWIJS] contant is named as contant', () => {
  assert.match(describePayment(classifyPayment([handLink({ method: 'kas' })])), /contant/)
})

test('[BETAALBEWIJS] part bank, part tick — both halves are said', () => {
  const ev = classifyPayment([bankLink({ amountApplied: 600 }), handLink({ amountApplied: 624.75 })])
  assert.equal(ev.kind, 'mixed')
  assert.equal(isBankProven(ev), true, 'a bank line does carry part of it')
  const text = describePayment(ev)
  assert.match(text, /afgeschreven/)
  assert.match(text, /door jou zelf afgevinkt/i, 'and the other half is not hidden behind it')
})

test('[BETAALBEWIJS] several bank lines are counted, not silently dropped', () => {
  const ev = classifyPayment([bankLink(), bankLink({ transactionId: 'tx-2', amountApplied: 100 })])
  assert.equal(ev.kind, 'bank')
  assert.match(describePayment(ev), /\+ 1 andere betaling/)
})

test('[BETAALBEWIJS] paid with nothing recording how — the app says it does not know', () => {
  // Rare, real, and the case that keeps the other two worth believing.
  const ev = classifyPayment([])
  assert.equal(ev.kind, 'none')
  assert.equal(isBankProven(ev), false)
  assert.match(describePayment(ev), /geen betaling aan gekoppeld/)
})

test('[BETAALBEWIJS] a failed read is NEVER the same answer as "nothing recorded"', () => {
  // The direction that matters: collapsing these two makes a busy database assert that an
  // invoice has no payment evidence.
  const ev = classifyPayment(null)
  assert.equal(ev.kind, 'unknown')
  assert.equal(isBankProven(ev), false)
  assert.match(describePayment(ev), /konden niet nakijken/)
  assert.notEqual(describePayment(ev), describePayment(classifyPayment([])))
})

test('[BETAALBEWIJS] a zero-amount link is not a payment', () => {
  // A link row that applies nothing settles nothing; counting it would make "Betaald" true on an
  // invoice where no money moved.
  assert.equal(classifyPayment([bankLink({ amountApplied: 0 })]).kind, 'none')
})

test('[BETAALBEWIJS] the direction of the money is not a nicety', () => {
  // "afgeschreven naar Kiwi Food Market" under an invoice Kiwi PAID describes the owner paying
  // their own customer — on the one line that exists to be believed. The pay screen and the sales
  // list ask the same question of opposite money, so the words have to be opposite too.
  const ev = classifyPayment([{
    transactionId: 'tx-9', amountApplied: 2420, paidOn: '2026-07-14', method: 'bank',
    transaction: {
      date: '2026-07-14', amount: 2420, description: 'FACTUUR 2026-014',
      counterpartName: 'Kiwi Food Market', counterpartIban: 'NL91ABNA0417164300',
    },
  }])

  const verkoop = describePayment(ev, 'outgoing')
  assert.match(verkoop, /bijgeschreven/, 'money that ARRIVED')
  assert.match(verkoop, /van Kiwi Food Market/)
  assert.doesNotMatch(verkoop, /afgeschreven|naar Kiwi/)

  const inkoop = describePayment(ev, 'incoming')
  assert.match(inkoop, /afgeschreven/, 'money that LEFT')
  assert.match(inkoop, /naar Kiwi Food Market/)
  assert.doesNotMatch(inkoop, /bijgeschreven|van Kiwi/)

  // Absent argument = the pay screen, which is what every existing call site meant.
  assert.equal(describePayment(ev), inkoop)
})

test('[BETAALBEWIJS] a bank line without its own row still proves a bank line', () => {
  // The collector keeps the LINKS when the bank_transactions read fails — the shape of the payment
  // is known, only the statement text is missing. Reporting 'unknown' there would throw away a
  // true answer, so the sentence has to survive without a name, without a date, or without both.
  const naked = classifyPayment([{
    transactionId: 'tx-1', amountApplied: 500, paidOn: null, method: 'bank', transaction: null,
  }])
  const zin = describePayment(naked, 'outgoing')
  assert.match(zin, /€\s?500,00 bijgeschreven\./)
  assert.doesNotMatch(zin, /\{/, 'no placeholder survives into the sentence')

  // …and with a date but no counterparty, and a name but no date.
  const zonderNaam = classifyPayment([{
    transactionId: 'tx-1', amountApplied: 500, paidOn: '2026-07-14', method: 'bank',
    transaction: { date: '2026-07-14', amount: 500, description: null, counterpartName: null, counterpartIban: null },
  }])
  assert.match(describePayment(zonderNaam, 'outgoing'), /bijgeschreven op 14 juli 2026\./)
  const zonderDatum = classifyPayment([{
    transactionId: 'tx-1', amountApplied: 500, paidOn: null, method: 'bank',
    transaction: { date: null, amount: 500, description: null, counterpartName: 'Kiwi', counterpartIban: null },
  }])
  assert.match(describePayment(zonderDatum, 'outgoing'), /bijgeschreven van Kiwi\./)
})

test('[BETAALBEWIJS] the panel model tells the four claims apart, and says nothing about none', () => {
  // The tone is not decoration. A bank-proven payment is corroborated by a third party; the
  // owner's tick is a memory; a marked-paid invoice with no link at all is the one worth
  // interrupting for; and a failed read is never the same answer as "nothing is recorded".
  const bank = buildPaymentEvidenceLine(classifyPayment([bankLink()]), 'incoming')
  assert.equal(bank?.tone, 'bank')
  const hand = buildPaymentEvidenceLine(classifyPayment([handLink()]), 'incoming')
  assert.equal(hand?.tone, 'hand')
  assert.equal(buildPaymentEvidenceLine(classifyPayment([]), 'incoming')?.tone, 'geen')
  assert.equal(buildPaymentEvidenceLine(classifyPayment(null), 'incoming')?.tone, 'onbekend')

  // An invoice the screen sent no evidence for gets NO line — the row then looks exactly as it did
  // before this feature existed, which is the only honest thing to do with an answer nobody has.
  assert.equal(buildPaymentEvidenceLine(undefined, 'incoming'), null)

  // The direction travels with the words, so a component cannot render the two out of step.
  assert.equal(bank?.dir, 'ltr')
  assert.equal(buildPaymentEvidenceLine(classifyPayment([bankLink()]), 'incoming', 'ar')?.dir, 'rtl')
})

test('[BETAALBEWIJS] only the rows that CLAIM to be settled are asked about', () => {
  // A screen that asked for every row would read the whole ledger's payment links to draw a line
  // under a handful of them. Deliberately not capped — the reads it feeds are chunked by id — so a
  // long list costs more queries, never a silently shorter answer.
  const ids = settledInvoiceIds([
    { id: 'a', status: 'paid', amount_paid: 1000 },
    { id: 'b', status: 'sent', amount_paid: 0 },
    // Partly paid: it is NOT claiming to be settled, and the instalment the owner is asked to
    // believe deserves the same evidence as a full one.
    { id: 'c', status: 'sent', amount_paid: 250 },
    { id: 'd', status: 'draft', amount_paid: null },
    { id: null, status: 'paid', amount_paid: 5 },
  ])
  assert.deepEqual(ids, ['a', 'c'])
  // Sorted and deduplicated, so a screen can use it as a cache key: the loader's page order is not
  // guaranteed, and an unstable key re-reads the same rows on every render.
  assert.deepEqual(settledInvoiceIds([
    { id: 'z', status: 'paid' }, { id: 'a', status: 'paid' }, { id: 'z', status: 'paid' },
  ]), ['a', 'z'])
})

test('[DEELBETALING-BEWIJS] a NULL amount_applied settled the invoice in full, and is never zero', () => {
  // bank_tx_invoices rows created before the column carry NULL. bank-line-budget.ts has always
  // valued such a link at the invoice's own total — reading it as 0 there would let the same euros
  // be spent twice. Read as 0 HERE, the link was filtered out and the invoice reported "als betaald
  // gemarkeerd, maar er is geen betaling aan gekoppeld": a false alarm about an invoice with a bank
  // line on it, on the one line that may never cry wolf.
  const legacy: PaymentLink[] = [{
    transactionId: 'tx-old', amountApplied: null, paidOn: '2025-11-04', method: 'bank',
    transaction: { date: '2025-11-04', amount: -1210, description: 'FACTUUR 2025-088',
      counterpartName: 'BALKIP B.V.', counterpartIban: null },
  }]

  // `assert.equal` from node:assert/strict is an assertion signature, so each line below narrows
  // the union for the next — no defensive ternary needed, and TypeScript rejects one as dead.
  const valued = classifyPayment(legacy, -1210)
  assert.equal(valued.kind, 'bank', 'a link IS a payment, whatever its column says')
  assert.equal(valued.total, 1210, 'valued at the invoice magnitude, exactly as allocatedOnLine does')
  assert.equal(valued.totalKnown, true)

  // Without an invoice total the link still counts — it exists — but the sum is not knowable, and
  // the panel says so rather than letting a 0 pass for a figure.
  const unvalued = classifyPayment(legacy)
  assert.equal(unvalued.kind, 'bank')
  assert.equal(unvalued.totalKnown, false)
  const line = buildPaymentEvidenceLine(unvalued, 'incoming', 'nl',
    { status: 'paid', total_inc_btw: -1210, amount_paid: 1210 })
  assert.match(line!.warning!, /niet na te rekenen/, 'an unverifiable total may not read as a verified one')

  // A genuine zero is still nothing: a link that applied 0 settles nothing, and counting it would
  // make "Betaald" true on an invoice where no money moved.
  assert.equal(classifyPayment([{ ...legacy[0], amountApplied: 0 }], -1210).kind, 'none')
})

test('[DEELBETALING-BEWIJS] the cached amount_paid is held against the rows it caches', () => {
  // invoices.amount_paid is Σ bank_tx_invoices.amount_applied, maintained by a database function
  // that also CLAMPS at the invoice magnitude. Nothing had ever compared the two — so a link
  // removed outside the app's own paths, or a total corrected downward after payments were booked,
  // left a remainder no instalment supports, shown as fact.
  const links: PaymentLink[] = [
    { transactionId: 'tx-1', amountApplied: 500, paidOn: '2026-07-03', method: 'bank' },
    { transactionId: null, amountApplied: 250, paidOn: '2026-07-14', method: 'bank' },
  ]
  const ev = classifyPayment(links, 1210)

  // Agreement is silence.
  assert.equal(
    buildPaymentEvidenceLine(ev, 'outgoing', 'nl', { status: 'sent', total_inc_btw: 1210, amount_paid: 750 })!.warning,
    null,
  )
  // Disagreement names BOTH figures — never a silent preference for one of them.
  const drift = buildPaymentEvidenceLine(ev, 'outgoing', 'nl', { status: 'sent', total_inc_btw: 1210, amount_paid: 800 })!
  assert.match(drift.warning!, /€\s?800,00/)
  assert.match(drift.warning!, /€\s?750,00/)
  // A cent of float dust is not a divergence.
  assert.equal(
    buildPaymentEvidenceLine(ev, 'outgoing', 'nl', { status: 'sent', total_inc_btw: 1210, amount_paid: 750.004 })!.warning,
    null,
  )
  // No invoice to compare against → no claim either way.
  assert.equal(buildPaymentEvidenceLine(ev, 'outgoing', 'nl')!.warning, null)
})

test('[DEELBETALING-BEWIJS] the terms are listed only when there is more than one', () => {
  const one = classifyPayment([{ transactionId: 'tx-1', amountApplied: 500, paidOn: '2026-07-03', method: 'bank' }], 500)
  const single = buildPaymentEvidenceLine(one, 'outgoing', 'nl', { status: 'paid', total_inc_btw: 500, amount_paid: 500 })!
  assert.deepEqual(single.entries, [], 'one payment has nothing to add up')

  const two = classifyPayment([
    { transactionId: 'tx-1', amountApplied: 500, paidOn: '2026-07-03', method: 'bank' },
    { transactionId: null, amountApplied: 250, paidOn: '2026-07-14', method: 'bank' },
  ], 1210)
  const many = buildPaymentEvidenceLine(two, 'outgoing', 'nl', { status: 'sent', total_inc_btw: 1210, amount_paid: 750 })!
  assert.equal(many.entries.length, 2)
  // Each term carries its own amount AND its own kind of proof — bank and hand are different
  // claims, and one line about "€ 750 betaald" would flatten them into the stronger one.
  assert.match(many.entries[0], /€\s?500,00 bijgeschreven/)
  assert.match(many.entries[1], /€\s?250,00 door jou afgevinkt/)
})

test('[DEELBETALING-BEWIJS] the sentence survives an evidence object it did not build', () => {
  // describePayment runs inside a LIST ROW. A throw there does not blank one line, it blanks the
  // screen — which is the entire reason tests/render/ exists. An evidence object assembled
  // anywhere but classifyPayment carries no `applied`, and the link's own amount answers the same
  // question, so it falls back instead of reaching into undefined.
  const handmade = {
    kind: 'bank' as const, total: 500, totalKnown: true,
    links: [{ transactionId: 'tx-1', amountApplied: 500, paidOn: '2026-07-03', method: 'bank' }],
  } as unknown as ReturnType<typeof classifyPayment>
  assert.match(describePayment(handmade, 'outgoing'), /€\s?500,00 bijgeschreven/)
  assert.equal(buildPaymentEvidenceLine(handmade, 'outgoing')!.entries.length, 0)
})
