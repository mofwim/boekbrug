// [AFSCHRIFT-NOEMT] Pure node test — run: npx tsx --test src/lib/bank-reference-settled.test.ts
//
// Every case here is one this owner actually has, read off the production database on 2 September
// 2026. All three were settled by a manual instalment with the right amount on the right day; the
// statement then arrived, and the screen offered a DIFFERENT invoice — under a green ✓ in one case
// and as a partial payment in another. Confirming any of them books a second payment for money that
// moved once.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// The matcher's own parser and normalizer. Imported rather than re-implemented: a second opinion
// about what counts as a reference is how the screen and the server start disagreeing.
import { parseReferenceNumbers, normalizeRef } from './bank-matching'
import {
  referencedInvisibleInvoice,
  referenceOutranksSuggestion,
  type InvisibleInvoice,
} from './bank-reference-settled'

const look = (reference: string | null, amount: number, invisible: InvisibleInvoice[] | null) =>
  referencedInvisibleInvoice(reference, amount, invisible, parseReferenceNumbers, normalizeRef)

const PAID = (over: Partial<InvisibleInvoice> & { id: string; invoiceNumber: string; totalIncBtw: number }): InvisibleInvoice => ({
  status: 'paid', amountPaid: Math.abs(over.totalIncBtw), ...over,
})

test('[AFSCHRIFT-NOEMT] HVO Meat — the statement names a paid invoice, and three others were offered', () => {
  // Bank: 17-08-2026, −797,86, description "2919045". Offered on screen: 3420623 (€2.449,64),
  // 3219996 (€2.822,27), 3320359 (€3.008,71) — not one of them near the amount.
  const v = look('2919045', -797.86, [
    PAID({ id: 'hvo', invoiceNumber: '2919045', totalIncBtw: 797.86, clientName: 'HVO Meat', invoiceDate: '2026-07-17' }),
  ])
  assert.ok(v, 'the named invoice must be found')
  assert.equal(v!.invoiceId, 'hvo')
  assert.equal(v!.amountAgrees, true, 'same amount to the cent — this line IS that payment')
  assert.equal(v!.stillOpen, 0, 'and nothing is left on it, so nothing may be booked')
  assert.equal(v!.clientName, 'HVO Meat')
  // It outranks every one of the three that were shown.
  for (const offered of ['3420623', '3219996', '3320359']) {
    assert.equal(referenceOutranksSuggestion(v, offered), true, `must outrank ${offered}`)
  }
})

test('[AFSCHRIFT-NOEMT] CAN Vleesgroothandel — a partial payment that would never have closed', () => {
  // Bank: 17-08-2026, −1.056,87, description "2034382". Offered: 2034534 (€1.217,92) as a PARTIAL
  // payment leaving €161,05 open — on an invoice nobody had paid, for money already accounted for.
  const v = look('2034382', -1056.87, [
    PAID({ id: 'can', invoiceNumber: '2034382', totalIncBtw: 1056.87, clientName: 'CAN Vleesgroothandel B.V.' }),
  ])
  assert.ok(v && v.amountAgrees && v.stillOpen === 0)
  assert.equal(referenceOutranksSuggestion(v, 'ce7a353b'), true)
})

test('[AFSCHRIFT-NOEMT] Coroama — the bank truncates the number, and that still names it', () => {
  // Bank description "26 00623"; the invoice is FAC/26-26/00623. The token is CONTAINED in the
  // normalized number, which is why containment is the rule and not equality.
  const v = look('26 00623', -40, [
    PAID({ id: 'cor', invoiceNumber: 'FAC/26-26/00623', totalIncBtw: 40, clientName: 'Coroama Stefan Daniel' }),
  ])
  assert.ok(v, 'a truncated reference still names its invoice')
  assert.equal(v!.invoiceNumber, 'FAC/26-26/00623')
  assert.equal(v!.amountAgrees, true)
  // FAC/2026/00296 was offered instead, under a green ✓.
  assert.equal(referenceOutranksSuggestion(v, 'other'), true)
})

test('[AFSCHRIFT-NOEMT] a reference naming the invoice already being offered is not a contradiction', () => {
  // The bank agreeing with the matcher is the matcher's own evidence. Reporting it as an override
  // would put a warning on the one case where everything is right.
  const v = look('2919045', -797.86, [
    PAID({ id: 'hvo', invoiceNumber: '2919045', totalIncBtw: 797.86 }),
  ])
  assert.equal(referenceOutranksSuggestion(v, 'hvo'), false)
  assert.equal(referenceOutranksSuggestion(null, 'hvo'), false, 'nothing named, nothing to say')
})

test('[AFSCHRIFT-NOEMT] a number without the amount is named, never "explained"', () => {
  // A reference can carry a customer number, an order number or a batch counter. Without the amount
  // this module says only that the number names the invoice — the caller may not tell the owner
  // their payment is already accounted for on that alone.
  const v = look('2919045', -500, [
    PAID({ id: 'hvo', invoiceNumber: '2919045', totalIncBtw: 797.86 }),
  ])
  assert.ok(v)
  assert.equal(v!.amountAgrees, false, 'the amounts differ — this is not that payment')
})

test('[AFSCHRIFT-NOEMT] the exact amount wins over a longer token', () => {
  // Two invoices whose numbers both occur in the reference. The one the money fits is the answer,
  // whatever the token lengths say.
  const v = look('99012345, 2919045', -797.86, [
    PAID({ id: 'lang', invoiceNumber: '99012345', totalIncBtw: 3000 }),
    PAID({ id: 'juist', invoiceNumber: '2919045', totalIncBtw: 797.86 }),
  ])
  assert.equal(v!.invoiceId, 'juist')
  assert.equal(v!.amountAgrees, true)
})

test('[AFSCHRIFT-NOEMT] with nothing to separate them, the answer is still the same every time', () => {
  // Two invoices of one amount, both named. The order rows come back in must not decide which the
  // owner is shown — a screen that reshuffles between two loads is one nobody can act on.
  const a = PAID({ id: 'a', invoiceNumber: '2919045', totalIncBtw: 797.86 })
  const b = PAID({ id: 'b', invoiceNumber: '2919046', totalIncBtw: 797.86 })
  const forward = look('2919045, 2919046', -797.86, [a, b])
  const reversed = look('2919045, 2919046', -797.86, [b, a])
  assert.deepEqual(forward, reversed)
})

test('[AFSCHRIFT-NOEMT] free text and short tokens name nothing', () => {
  // isReferenceNumberToken already refuses these; asserted here because this module is what a
  // screen believes, and "Huur juli" must never resolve to an invoice.
  assert.equal(look('Huur juli, Kerkstraat 12', -40, [PAID({ id: 'x', invoiceNumber: '12', totalIncBtw: 40 })]), null)
  assert.equal(look(null, -40, [PAID({ id: 'x', invoiceNumber: '2919045', totalIncBtw: 40 })]), null)
  assert.equal(look('2919045', -40, []), null)
  assert.equal(look('2919045', -40, null), null)
  // An invoice with no number of its own cannot be named by one.
  assert.equal(look('2919045', -40, [{ id: 'x', invoiceNumber: null, totalIncBtw: 40, status: 'paid' }]), null)
})

test('[AFSCHRIFT-NOEMT] an archived invoice is named too — it is just as invisible to the matcher', () => {
  // 10 lines on this account name an archived invoice of exactly their own amount (€10.503,71).
  // Archived means the owner set it aside, and that is worth saying rather than silently offering
  // some other bill.
  const v = look('2034999', -250, [
    { id: 'arch', invoiceNumber: '2034999', totalIncBtw: 250, amountPaid: 0, status: 'archived', clientName: 'Trimex' },
  ])
  assert.ok(v)
  assert.equal(v!.status, 'archived')
  assert.equal(v!.amountAgrees, true)
  assert.equal(v!.stillOpen, 250, 'archived is not paid — the sentence must not claim it is')
})
