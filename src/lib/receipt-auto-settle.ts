// src/lib/receipt-auto-settle.ts
// [BON-AUTO] A kassabon is proof that the counter was already paid. Pure logic, no I/O.
// Run: npx tsx --test src/lib/receipt-auto-settle.test.ts
//
// ── WHY THIS EXISTS ──
// You do not get a receipt for a bill you still owe. The till prints one BECAUSE the money left —
// that is what makes it a receipt rather than an invoice. intake-router.ts already says so in its
// own words ("the kind is itself the proof") and pre-suggests paid on every bon.
//
// And then both import doors did the opposite of automating it. Auto-advance can only land an
// invoice as 'received' — booked and UNPAID — which is the one status a settled bon must never
// get: it would stand in "nog te betalen" for money already gone, be dunned for it, and be payable
// a second time. So both doors switched auto-advance OFF for anything suggested paid, and EVERY
// receipt fell to a manual tap. The document class that needs the least human judgement got the
// most of it.
//
// ── WHAT MAKES IT SAFE TO DO WITHOUT A HUMAN ──
// Two questions, and only the first one answers itself.
//
//   · WAS it paid?  The kind answers that. A bon exists because the counter was paid.
//   · HOW was it paid?  The kind says nothing, and the answer has consequences that do not undo
//     themselves: 'kas' moves the cash drawer (cash-settle.ts writes a dated kasboek entry),
//     'bank' does not. Guessing it wrong puts a movement in the drawer that never happened, or
//     leaves out one that did — and a drawer that drifts by a few euros a week is a drawer nobody
//     can reconcile at year end.
//
// So this refuses unless the PAPER ITSELF names the method: a printed tender line — "Kontant",
// "Wisselgeld", "Bankpas", "PIN", "Maestro" — read by bon-betaalwijze.ts from the document's own
// characters. That is the same standard the rest of this import path holds: a figure or a fact is
// acted on automatically only when something other than the model's opinion attests to it.
//
// A bon whose paper is silent about the method keeps exactly today's behaviour: the verify queue,
// with the paid suggestion pre-filled and one tap to confirm. Guess cleverly, ask only when we do
// not know.
//
// ── WHAT IT DELIBERATELY DOES NOT COVER ──
// A pen-marked INVOICE ("betaald · kas · 16-2" in someone's handwriting). intake-router calls that
// suggestPaid too, and it is NOT the same evidence: a till line is printed by the machine that
// took the money, a pen mark is a reading of somebody's handwriting on a document whose whole
// purpose is to ask for payment. Those stay in the queue.
//
// ── AND IT NEVER WRITES THE MONEY ITSELF ──
// This file decides; apply_manual_payment books. That is the same audited, atomic, row-locking
// path the manual "Markeer als betaald" button uses — amount_paid, status, payment_method,
// marked_paid_at, payment_date AND the bank_tx_invoices instalment row that keeps
// amount_paid = SUM(amount_applied) true. Writing status='paid' straight onto the insert would
// have skipped that row, and recompute_invoice_amount_paid would then have reset amount_paid to
// zero on an invoice that says it is paid. Because the booking is the ordinary one, the ordinary
// undo button reverses it.

// [PAY-DATE-SANE] One definition of "can a payment really have happened on this date?", shared with
// every other door that writes a betaaldatum. A second copy here would be a second opinion, and the
// two would drift the first time either moved — which on a payment date means a booking landing in
// a quarter that is already filed.
import { paymentDateOutOfWindow } from './payment-date'

/** The two values the rest of the app knows. A third would be invisible to both reconcilers. */
export type SettleMethod = 'bank' | 'kas'

export interface ReceiptSettlePlan {
  /** Book it as paid, without a human. */
  settle: boolean
  /** Only set when settling — apply_manual_payment refuses anything else. */
  method: SettleMethod | null
  /** The date the money moved, ISO yyyy-mm-dd. Decides which quarter a kasstelsel places it in. */
  payDate: string | null
  /** Short tag naming what decided it, for the audit trail and for the tests. */
  reason: string
}

const HOLD = (reason: string): ReceiptSettlePlan => ({ settle: false, method: null, payDate: null, reason })

export interface ReceiptSettleInput {
  /** The reader's document_kind. Only 'receipt' can settle itself — see the header. */
  documentKind: string | null | undefined
  /** From paymentSuggestion() — the ONE place both doors ask whether this was paid. */
  suggestion: {
    suggestPaid: boolean
    paidMethod: SettleMethod | null
    /** true ONLY when the paper printed the tender line. This is the whole gate. */
    paidMethodZeker: boolean
    paidDate: string | null
  }
  /** The bon's own date, used when the tender line carried no date of its own. */
  invoiceDate: string | null
  /** The gross that will be settled. */
  totalIncBtw: number | null
  /** Today, ISO. Injected so this stays pure and the boundary is testable. */
  today: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * May this receipt be booked as paid with no human in the loop?
 *
 * Says nothing about whether the READ is trustworthy — that is shouldAutoAdvanceInvoice's job, and
 * the callers must pass both. This answers only the payment question.
 */
export function planReceiptSettlement(input: ReceiptSettleInput): ReceiptSettlePlan {
  const kind = (input.documentKind ?? '').trim().toLowerCase()
  // A bon, and nothing else. A pen mark on an invoice is not a till line — see the header.
  if (kind !== 'receipt') return HOLD('not_a_receipt')

  // An explicit is_paid:false over a silent paper. The reader saw something; respect it.
  if (input.suggestion.suggestPaid !== true) return HOLD('receipt_read_as_unpaid')

  // THE GATE. Without a printed tender line we do not know whether the drawer moved, and a wrong
  // guess is a kasboek that cannot be reconciled. The queue asks; that is what the queue is for.
  if (input.suggestion.paidMethodZeker !== true) return HOLD('method_not_printed')
  const method = input.suggestion.paidMethod
  if (method !== 'bank' && method !== 'kas') return HOLD('method_not_printed')

  // A real, positive gross. apply_manual_payment refuses a total of zero, and a NEGATIVE total is
  // a creditnota shape — money coming back, which is not what a settlement books.
  const total = input.totalIncBtw
  if (!(typeof total === 'number' && Number.isFinite(total) && total >= 0.01)) {
    return HOLD('no_settleable_total')
  }

  // The date the money moved. The tender line's own date when it printed one, otherwise the bon's
  // date — at a counter those are the same day, which is exactly why a bon may use its own date
  // where an invoice may not.
  const payDate = pickPayDate(input.suggestion.paidDate, input.invoiceDate)
  if (!payDate) return HOLD('no_usable_date')

  // [PAY-DATE-SANE] A misread year ("2062") files the payment in a quarter that has not happened,
  // where nothing reconciles it and nobody goes looking; "1926" does the mirror image. The database
  // refuses both as a backstop, so passing one through here would not corrupt the books — it would
  // turn a silent hold into a failed import, which is worse for an automation nobody is watching.
  if (paymentDateOutOfWindow(payDate, input.today)) return HOLD('pay_date_impossible')

  return {
    settle: true,
    method,
    payDate,
    reason: method === 'kas' ? 'bon_tender_cash' : 'bon_tender_card',
  }
}

function pickPayDate(fromTender: string | null, fromDocument: string | null): string | null {
  if (fromTender && ISO_DATE.test(fromTender)) return fromTender
  if (fromDocument && ISO_DATE.test(fromDocument)) return fromDocument
  return null
}

/**
 * The sentence the owner reads on a bon that booked itself. Dutch, per AGENTS.md.
 *
 * It names the WORD ON THE PAPER, not our conclusion. "Wij dachten dat het contant was" is an
 * opinion the owner cannot check; "op de bon staat Wisselgeld" is a claim they can settle by
 * looking at the bon, which is the difference between a report and a reassurance.
 */
export function settleNoticeText(plan: ReceiptSettlePlan, evidence: string | null): string | null {
  if (!plan.settle || !plan.method) return null
  const how = plan.method === 'kas' ? 'contant' : 'met de pas'
  const basis = evidence?.trim()
    ? ` — op de bon staat "${evidence.trim()}"`
    : ' — de bon vermeldt de betaalwijze zelf'
  return `Deze bon is al afgerekend ${how}${basis}. Wij hebben hem daarom meteen als betaald ` +
    'geboekt; klopt dat niet, dan zet je hem met één tik terug op openstaand.'
}
