// [PAY-INTENT] Pure node test — run: npx tsx --test src/lib/pay-intent.test.ts
//
// Every tier in bank-matching reasons BACKWARDS from the bank statement to a conclusion the owner
// had already stated: when they opened the pay sheet on an invoice, the app stamped
// payment_prepared_at. That is a declaration of which bill was about to be paid, made before the
// money moved — and the matcher never heard it.
//
// What is held here is the pair of properties that make it safe to use:
//   · it RANKS, and never books. autoConfirmTier is untouched, so nothing auto-books that did not
//     before — the tiers still require a printed number, a matching IBAN, or a strong name;
//   · and it never outranks the bank statement itself. A declaration of what you MEANT to pay is
//     weaker evidence than a payment that names the bill you DID pay.
//
// Plus the three conditions on the signal: exact amount, not before the intent, inside the window.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  scorePair,
  autoConfirmTier,
  matchTransactions,
  PREPARED_WINDOW_DAYS,
  DEFAULT_OPTIONS,
  type InvoiceForMatching,
  type MatchOptions,
} from './bank-matching'
import type { BankTransaction } from './bank-parser'

// The app's own defaults, so this test measures the matcher the owner actually runs.
const OPTS: MatchOptions = { ...DEFAULT_OPTIONS, amountEpsilon: 0.02 }

const inv = (o: Partial<InvoiceForMatching> = {}): InvoiceForMatching => ({
  id: 'i1',
  invoice_number: '26302050',
  total_inc_btw: 500,
  amount_paid: 0,
  invoice_date: '2026-06-01',
  due_date: '2026-06-30',
  client_name: 'ATAPACK Cash & Carry B.V.',
  direction: 'incoming',
  status: 'received',
  accountant_status: null,
  vendor_iban: null,
  payment_prepared_at: null,
  ...o,
})

const tx = (o: Partial<BankTransaction> = {}): BankTransaction => ({
  date: '2026-06-20',
  amount: -500,
  currency: 'EUR',
  description: 'SEPA overboeking',
  counterpartName: null,
  counterpartIban: null,
  reference: null,
  transactionId: null,
  rawLine: '',
  ...o,
})

test('[PAY-INTENT] the invoice the owner declared scores above one they did not', () => {
  const declared = scorePair(tx(), inv({ payment_prepared_at: '2026-06-19T09:00:00Z' }), OPTS)
  const silent = scorePair(tx(), inv({ id: 'i2', payment_prepared_at: null }), OPTS)

  assert.ok(declared.signals.includes('prepared'), 'the declaration is a signal of its own')
  assert.ok(declared.confidence > silent.confidence, 'and it ranks the declared invoice higher')
  assert.match(declared.reason, /klaargezet om te betalen/, 'the reason says why, in the owner\'s terms')
})

test('[PAY-INTENT-BOOK] a declared, unambiguous payment books — at the FLAGGED tier', () => {
  // The gap the other two tiers leave: an MT940 line with no counterparty name and no printed
  // number. 'certain' needs the bank to name the bill or the account; 'amount_only' needs the
  // name. So a payment the owner had explicitly queued sat in the manual pile beside twenty others.
  const m = matchTransactions([tx()], [inv({ payment_prepared_at: '2026-06-19T09:00:00Z' })], OPTS).matches[0]
  assert.equal(
    autoConfirmTier(m), 'amount_only',
    'booked, and marked "controleer" — never silently, because intent is what the owner MEANT',
  )
  assert.notEqual(autoConfirmTier(m), 'certain', 'the bank naming the bill is a different kind of evidence')
})

test('[PAY-INTENT-BOOK] and every clause of the conjunction is load-bearing', () => {
  const prepared = '2026-06-19T09:00:00Z'
  const declared = () => inv({ payment_prepared_at: prepared })

  // A printed document number that is NOT this invoice's vetoes — the bank naming another bill
  // outranks what the owner meant. Same rule the name tier already applies.
  const contradicted = matchTransactions(
    [tx({ reference: '99999999' })], [declared()], OPTS,
  ).matches[0]
  assert.equal(autoConfirmTier(contradicted), null, 'a payment naming another bill is not this one')

  // A counterparty name that is PRESENT and points elsewhere is a contradiction too. Absent is
  // fine — that absence is the whole reason this tier exists.
  const wrongName = matchTransactions(
    [tx({ counterpartName: 'Volledig Andere Leverancier B.V.' })], [declared()], OPTS,
  ).matches[0]
  assert.equal(autoConfirmTier(wrongName), null, 'a name pointing elsewhere blocks the booking')

  // TWO declared siblings of the same amount tie, so the shared gate never reaches 'auto' — the
  // owner queued both and only they know which one this debit was. This is the UNIQUENESS clause of
  // the margin waiver, and it is what keeps the waiver from being a blanket "intent wins": a
  // declaration that points at two invoices at once points at neither.
  const tie = matchTransactions(
    [tx()], [declared(), inv({ id: 'other', invoice_number: '26302362', payment_prepared_at: prepared })], OPTS,
  ).matches[0]
  assert.equal(tie.outcome, 'choice', 'two declarations cancel out — the waiver needs a unique one')
  assert.equal(autoConfirmTier(tie), null, 'ambiguity still stops at the human')

  // And an invoice nobody declared is untouched by all of this.
  const undeclared = matchTransactions([tx()], [inv({ payment_prepared_at: null })], OPTS).matches[0]
  assert.equal(autoConfirmTier(undeclared), null)
})

test('[PAY-INTENT] the margin waiver does not reopen the duplicate-payment hole', () => {
  // The shape [BANK-ELIMINATION-NO-PROMOTE] exists for: rent paid twice, the first debit prints
  // "2026-07" and claims July, and the leftover debit is then alone with June — a "single clear
  // winner" that elimination MANUFACTURED. Booking it marks a never-paid June invoice as settled.
  //
  // The waiver added for intent must not hand that back. It does not, and the reason is the whole
  // argument for it: the stamp is written before any matching runs, so a leftover that nobody
  // declared has no stamp to inherit.
  const rent = (o: Partial<InvoiceForMatching>): InvoiceForMatching =>
    inv({ total_inc_btw: 1200, client_name: 'Verhuur B.V.', ...o })
  const debit = (o: Partial<BankTransaction>) =>
    tx({ amount: -1200, counterpartName: 'Verhuur B.V.', date: '2026-07-02', ...o })

  const juli = rent({ id: 'juli', invoice_number: '2026-07', invoice_date: '2026-07-01', due_date: '2026-07-31' })
  const leftover = (juniPrepared: string | null) =>
    matchTransactions(
      [debit({ reference: '2026-07' }), debit({ date: '2026-07-03' })],
      [juli, rent({ id: 'juni', invoice_number: '2026-06', payment_prepared_at: juniPrepared })],
      OPTS,
    ).matches[1]

  const undeclared = leftover(null)
  assert.equal(undeclared.outcome, 'choice', 'elimination alone still never manufactures a winner')
  assert.equal(autoConfirmTier(undeclared), null, 'and nothing is booked on it')

  const declared = leftover('2026-07-01T09:00:00Z')
  assert.equal(declared.best?.invoiceId, 'juni', 'a June the owner DID queue is a real answer')
  assert.equal(autoConfirmTier(declared), 'amount_only', 'booked — flagged, never silent')
})

test('[PAY-INTENT] it never outranks the statement naming the bill', () => {
  // The identity hierarchy this file already documents: a printed invoice number (0.97) beats a
  // matching IBAN (0.96) beats a coincidence (0.95). Intent is a statement about what the owner
  // MEANT; the bank text is what actually happened, and it stays on top.
  const printed = scorePair(
    tx({ reference: '26302050' }),
    inv({ id: 'named' }),
    OPTS,
  )
  const declared = scorePair(tx(), inv({ id: 'declared', payment_prepared_at: '2026-06-19T09:00:00Z' }), OPTS)
  assert.ok(
    printed.confidence > declared.confidence,
    'a payment that prints the invoice number outranks one the owner merely prepared',
  )
})

test('[PAY-INTENT] the three conditions on the signal', () => {
  const prepared = '2026-06-19T09:00:00Z'

  // 1. The amount must be exact. Intent about the wrong sum says nothing about THIS payment.
  assert.ok(
    !scorePair(tx({ amount: -499 }), inv({ payment_prepared_at: prepared }), OPTS).signals.includes('prepared'),
    'a different amount is a different payment',
  )

  // 2. A payment cannot precede the intent that produced it.
  assert.ok(
    !scorePair(tx({ date: '2026-06-18' }), inv({ payment_prepared_at: prepared }), OPTS).signals.includes('prepared'),
    'a debit dated before the stamp is not this payment',
  )

  // 3. And it stays inside the window, so an unrelated same-amount debit weeks later is not swept in.
  const justInside = new Date(Date.parse(prepared) + (PREPARED_WINDOW_DAYS - 1) * 86_400_000)
    .toISOString().slice(0, 10)
  const wellOutside = new Date(Date.parse(prepared) + (PREPARED_WINDOW_DAYS + 20) * 86_400_000)
    .toISOString().slice(0, 10)
  assert.ok(scorePair(tx({ date: justInside }), inv({ payment_prepared_at: prepared }), OPTS).signals.includes('prepared'))
  assert.ok(!scorePair(tx({ date: wellOutside }), inv({ payment_prepared_at: prepared }), OPTS).signals.includes('prepared'))

  // And an invoice that was never prepared carries no signal at all.
  assert.ok(!scorePair(tx(), inv({ payment_prepared_at: null }), OPTS).signals.includes('prepared'))
})

test('[PAY-INTENT] two same-amount siblings: the declared one wins the suggestion', () => {
  // The everyday case this exists for. Two open invoices from one supplier for the same amount,
  // a bank line with nothing to tell them apart — before this, the owner picked from a list of
  // identical rows. The one they had already opened the pay sheet on is now on top.
  const m = matchTransactions(
    [tx({ counterpartName: 'ATAPACK Cash & Carry B.V.' })],
    [
      inv({ id: 'other', invoice_number: '26302362' }),
      inv({ id: 'declared', invoice_number: '26302050', payment_prepared_at: '2026-06-19T09:00:00Z' }),
    ],
    OPTS,
  ).matches[0]
  assert.equal(m.candidates[0]?.invoiceId, 'declared', 'the invoice the owner named is first')
  // And the declaration DECIDES it: one of the two was queued by the owner and the other was not,
  // which is exactly the disambiguation the bank line could not provide. Booked at the flagged
  // tier — marked "controleer", one tap to reverse — never silently.
  assert.equal(m.outcome, 'auto', 'the declared sibling is the answer, not a question')
  assert.equal(m.best?.invoiceId, 'declared')
  assert.equal(autoConfirmTier(m), 'amount_only', 'booked, and flagged for a look')
})
