// src/lib/open-invoice-proof.ts
// [OPENSTAAND-BEWIJS] The other direction: is anything we call OPEN already paid?
//
// ── WHY THIS EXISTS ──
//
// The owner knows the app read their invoices correctly. They still do not quite believe the list
// of what they owe, and that is not irrational — every screen in this app shows a CONCLUSION and
// none of them shows its working. "Openstaand: € 8.914" is an assertion. To check it, the owner
// has to do by hand exactly the work the app was bought to do.
//
// The app already asks one direction of the question, at import time: given this bank line, which
// invoice does it pay? Nothing has ever asked the other direction, which is the one that keeps
// somebody awake: given this invoice I am about to pay AGAIN, is the money perhaps already gone?
//
// ── WHY THE ANSWER MUST INCLUDE THE SEARCH ──
//
// "We found no payment" is an ABSENCE, and an absence proves nothing unless you know how hard it
// was looked for. So this returns the scope with the finding, always, and the screen says it:
//
//     "12 openstaande facturen vergeleken met 340 banktransacties t/m 15 augustus."
//
// A number the owner can sanity-check against their own bank in four seconds. That sentence is the
// product here — the hits are the exception, the scope is what is true every day.
//
// ── ONE DEFINITION OF "THIS PAYMENT FITS THIS INVOICE" ──
//
// It reuses matchTransactions, the engine the bank screen runs. A second, private notion of a
// match would drift from it, and then two screens would disagree about the same euro — which
// destroys more trust than the silence it replaced. This module only INVERTS the result: the
// engine answers per transaction, and the owner's question is per invoice.
//
// It writes nothing and books nothing. Every hit is a question with both numbers on it.
//
// Pure: no I/O, no clock, no database.

import { matchTransactions, type InvoiceForMatching, type MatchCandidate, type MatchSignal } from './bank-matching'
import type { BankTransaction } from './bank-parser'
import { round2 } from './invoice-totals'
import type { OpenInvoiceHit, OpenInvoiceProof, ProofDirection } from './open-invoice-proof-types'

export type { OpenInvoiceHit, OpenInvoiceProof, ProofDirection } from './open-invoice-proof-types'

/**
 * What a payment must prove before it is put in front of the owner as "this bill may already be
 * paid": that it went to THIS party, or quotes THIS invoice. Not that it is the right size.
 *
 * ── WHY A CONFIDENCE THRESHOLD IS THE WRONG GATE HERE, MEASURED ──
 *
 * The engine's score is calibrated for a different question. On the bank screen the owner is
 * already looking at a payment and asking which invoice it belongs to; there, amount + a nearby
 * date is a perfectly good suggestion. Run the same scale against a list the owner believes is
 * settled and it inverts:
 *
 *     € 1.224,75 to a DIFFERENT supplier, different IBAN, no invoice number   → 0.711
 *     € 612,37 quoting "FACTUUR 264091" in the description, exact remainder   → 0.600
 *
 * The first is a coincidence — on a wholesale administratie, recurring amounts to different
 * suppliers are everywhere — and it outscores real evidence. Any confidence bar that admits the
 * second admits the first, and a bar that excludes the first excludes the second.
 *
 * So the gate is the SIGNALS. At least one of these has to identify the party or the document:
 *
 *   reference       the invoice number (or betalingskenmerk) is in the payment's own text
 *   iban            the payment went to the account printed on this invoice
 *   supplier_iban   …or to the account this supplier is known to bill from
 *   counterpart     the counterparty name identifies them
 *   memory          the owner has confirmed a payment between these two parties before
 *   prepared        the owner opened the pay sheet on this very invoice before the money moved
 *
 * And the amount must fit: `amount` (exact) or `near_amount` (a bank fee, a betalingskorting).
 * Date proximity alone proves nothing and is deliberately absent from both lists.
 *
 * The same lesson as the totals-block filter in amount-candidates.ts: an arithmetic coincidence is
 * not evidence, identity is. A false alarm on this list is not a suggestion — it is the app crying
 * wolf about its own bookkeeping, and after two of those nobody reads the third.
 */
const IDENTITY_SIGNALS = new Set<MatchSignal>([
  'reference', 'iban', 'supplier_iban', 'counterpart', 'memory', 'prepared',
])
const AMOUNT_SIGNALS = new Set<MatchSignal>(['amount', 'near_amount'])

/** Does this pairing carry evidence, rather than arithmetic? */
export function isProvingCandidate(signals: readonly MatchSignal[]): boolean {
  return signals.some((s) => IDENTITY_SIGNALS.has(s)) && signals.some((s) => AMOUNT_SIGNALS.has(s))
}



/**
 * Every open invoice for which one of these bank lines looks like its payment.
 *
 * The engine answers per transaction; this inverts it and keeps, per invoice, the single strongest
 * pairing. One line per invoice on purpose: the question is "is this bill perhaps already paid",
 * and three candidate payments under one invoice is a research project rather than an answer.
 *
 * Sorted by confidence, so the most likely mistake is the first thing read.
 */
export function proveOpenInvoices(
  openInvoices: readonly InvoiceForMatching[],
  transactions: readonly BankTransaction[],
  direction: ProofDirection = 'incoming',
): OpenInvoiceProof {
  const checkedInvoices = openInvoices.length
  const checkedTransactions = transactions.length
  if (checkedInvoices === 0 || checkedTransactions === 0) {
    return { direction, checkedInvoices, checkedTransactions, hits: [] }
  }

  const result = matchTransactions([...transactions], [...openInvoices])

  // invoiceId → the strongest pairing found for it, with the line that produced it.
  const best = new Map<string, { candidate: MatchCandidate; tx: BankTransaction }>()
  for (const m of result.matches) {
    for (const c of m.candidates) {
      if (!isProvingCandidate(c.signals)) continue
      const seen = best.get(c.invoiceId)
      if (!seen || c.confidence > seen.candidate.confidence) {
        best.set(c.invoiceId, { candidate: c, tx: m.transaction })
      }
    }
  }

  const byId = new Map(openInvoices.map((i) => [i.id, i]))
  const hits: OpenInvoiceHit[] = []
  for (const [invoiceId, { candidate, tx }] of best) {
    const inv = byId.get(invoiceId)
    if (!inv) continue
    // What is STILL open, not the full total: an invoice half settled by an earlier instalment is
    // open for the remainder, and telling the owner the whole amount may already be paid would be
    // wrong in exactly the direction that costs money.
    const paid = Math.max(0, inv.amount_paid ?? 0)
    const openAmount = round2(Math.max(0, Math.abs(inv.total_inc_btw ?? 0) - paid))
    hits.push({
      invoiceId,
      invoiceNumber: inv.invoice_number,
      clientName: inv.client_name,
      openAmount,
      transaction: {
        date: tx.date,
        amount: tx.amount,
        description: tx.description,
        counterpartName: tx.counterpartName,
      },
      confidence: candidate.confidence,
      reason: candidate.reason,
    })
  }
  hits.sort((a, b) => b.confidence - a.confidence)

  return { direction, checkedInvoices, checkedTransactions, hits }
}

// [OPENSTAAND-BEWIJS] The sentences live in open-invoice-proof-text.ts and are re-exported here,
// so a caller that wants both gets one import while a SCREEN can take the text alone. This module
// reaches matchTransactions and therefore the whole matching engine; a client component importing
// it for two sentences would drag that engine into the browser bundle.
export { describeProof, describeHit } from './open-invoice-proof-text'
