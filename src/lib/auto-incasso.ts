// src/lib/auto-incasso.ts
// [AUTO-INCASSO] A supplier whose invoices the BANK pays, not the owner.
//
// ── WHAT THIS IS FOR ──
// Rent, energy, insurance, the accountant's monthly fee: an automatische incasso leaves the
// account on its own. The invoice still arrives, still has to be booked, and still carries a
// vervaldatum — but there is nothing for the owner to DO. Until now the app could not tell the
// difference, and treated those invoices exactly like the ones you owe:
//
//   · they wore "2 dagen te laat" — the owner was not late, the bank simply had not run yet;
//   · they sat in Vandaag's "Te betalen" every day, above the invoices that did need paying;
//   · and they offered a "Betalen" button. That one is not noise, it is a DOUBLE PAYMENT: the
//     money had already left, and the button hands the supplier a second copy of it. The most
//     dangerous thing on the screen was the primary action.
//
// The old way out was "Verbergen", which is a useState — it comes back on the next load. So the
// owner hid the same two rent invoices every single time they opened the app.
//
// ── WHY THE SUPPLIER, AND NOT THE AMOUNT ──
// The obvious rule is "same supplier + same amount = also collected". It reads as the careful
// version, and it is the one that fails. Two things break it, and both are ordinary:
//
//   · a supplier sends more than one invoice. The screenshot that started this carries two
//     WonenBreburg invoices on the same day, € 83,70 and € 74,96 — an amount rule keyed on the
//     first one would have covered one and silently left the other wearing "te laat";
//   · the amount CHANGES. Rent is indexed every 1 July, energy is re-estimated, insurance is
//     adjusted yearly. On exactly that day the rule stops matching and says nothing, which is the
//     worst possible moment for a quiet failure: the owner has stopped watching precisely because
//     the app has been handling it for a year.
//
// Being direct-debited is a property of the RELATIONSHIP — a mandate the owner signed once — not
// of an amount. So the flag lives on the supplier and the amount is never a condition.
//
// ── WHAT IS ASSUMED, AND WHAT IS NOT ──
// This books a payment nobody observed. That is a real claim about money, so it is fenced:
//
//   · it never fires BEFORE the money is gone. A collection runs on the vervaldatum, so nothing
//     is booked until that day has passed;
//   · payment_date is the VERVALDATUM, not the day the app got round to it. Under the kasstelsel
//     that date picks the BTW quarter (vat-scheme.ts), and "the day the cron ran" is not a fact
//     about the payment;
//   · every hold below is a case where the amount, the direction or the recipient is in doubt.
//     An auto-booking is only as honest as the invoice it settles, and a wrong one here is money
//     the books say left and never did;
//   · what it books is an ASSUMPTION and is recorded as one (field_confidence._auto_incasso), so
//     a later bank line can confirm it and the owner can always undo it.
//
// Doing nothing is not the neutral option. An invoice the bank paid weeks ago, still standing in
// "nog te betalen", is just as wrong as one marked paid too early — it is the same error with the
// sign flipped, and it is the error the app makes today, on every single incasso, forever.

import { classifyImportHealth, type HealthInput } from '@/lib/import-health'
import { creditStance, payableAsDebt } from '@/lib/creditnota-signal'

/** The invoice fields this module judges. A structural subset of the row — no client needed. */
export interface IncassoInvoice extends HealthInput {
  id: string
  status: string | null
  direction: string | null
  accountant_status: string | null
  due_date: string | null
  client_name: string | null
  amount_paid?: number | null
  // [INCASSO-ONGEDAAN] field_confidence is NOT redeclared here: HealthInput already carries it,
  // and the decision below reads it to see the marker this module itself writes.
}

/**
 * Why an invoice from an incasso supplier was NOT booked automatically.
 *
 * Every one of these is a case where booking would state something the app does not know. They
 * are separate values rather than one 'held' because the owner has to be told WHICH — a held
 * invoice keeps standing open, and an unexplained one looks like the feature is broken.
 */
export type IncassoHold =
  | 'not-incoming'      // an outgoing invoice — nobody collects from us
  | 'not-open'          // already paid, still in the queue, archived: not a settleable state
  | 'verwerkt'          // the accountant closed it; the database refuses the write anyway
  | 'creditnota'        // money coming back, not going out — a credit is never collected
  | 'no-due-date'       // no date to book the payment ON, and today would be a guess
  | 'not-yet-due'       // the collection has not run — the money is still in the account
  | 'no-amount'         // nothing to settle
  | 'duplicate'         // [DEDUP-SOFT] booking both copies pays a debt that exists once
  | 'iban-changed'      // [IBAN-WISSEL] the fraud signature — the LAST thing to auto-pay
  | 'multiple-invoices' // one of several invoices in the file was read; the rest exist nowhere
  | 'arithmetic'        // the breakdown does not add up, so the amount itself is not a fact
  | 'undone'            // [INCASSO-ONGEDAAN] we booked this once and the owner put it back open

/** Dutch, because the owner reads it. One sentence per hold, said the way a person would. */
export const INCASSO_HOLD_REASON: Record<IncassoHold, string> = {
  'not-incoming': 'dit is een verkoopfactuur — daar wordt niets van afgeschreven',
  'not-open': 'deze factuur staat niet open',
  'verwerkt': 'je boekhouder heeft deze factuur al verwerkt',
  'creditnota': 'dit is een creditnota — dat geld komt terug, het wordt niet afgeschreven',
  'no-due-date': 'er staat geen vervaldatum op, dus we weten niet wanneer het is afgeschreven',
  'not-yet-due': 'de vervaldatum is nog niet geweest — het geld staat nog op je rekening',
  'no-amount': 'er staat geen bedrag op deze factuur',
  'duplicate': 'deze factuur lijkt op een factuur die je al hebt — kijk er eerst zelf naar',
  'undone': 'je hebt deze afschrijving zelf teruggezet op openstaand — we boeken hem niet opnieuw',
  'iban-changed': 'het rekeningnummer van deze leverancier is veranderd — controleer dit eerst zelf',
  'multiple-invoices': 'er lijken meerdere facturen in dit bestand te zitten',
  'arithmetic': 'de bedragen op deze factuur kloppen niet met elkaar',
}

/** Book it (with the date the money left), or hold it (with the reason). */
export type IncassoDecision =
  | { settle: true; paymentDate: string }
  | { settle: false; hold: IncassoHold }

/**
 * Should this invoice be booked as collected today?
 *
 * Pure, and the clock is INJECTED — `today` is the caller's Amsterdam day (format-nl.ts), never a
 * clock read here, so the rule is testable and the cron, the toggle and the screen all judge
 * against the same day.
 *
 * The order of the checks is the order of certainty: the states that make the question moot come
 * first, then the ones about timing, then the ones about whether the invoice can be trusted at
 * all. That last group is the reason this function is not three lines.
 */
export function incassoDecision(inv: IncassoInvoice, today: string): IncassoDecision {
  if (inv.direction !== 'incoming') return { settle: false, hold: 'not-incoming' }
  if (inv.status !== 'received') return { settle: false, hold: 'not-open' }
  // [INCASSO-ONGEDAAN] We already booked this one, and it is open again. Somebody put it back.
  //
  // The marker is written only AFTER a successful booking, so carrying it while standing at
  // 'received' can mean exactly one thing: the payment we assumed was reversed — by the owner
  // (which is what the cron's own notification tells them to do after a storno: "kloppen ze niet?
  // Zet ze terug op openstaand"), or by the accountant.
  //
  // Without this check that correction does not survive the hour. The idempotency key is derived
  // from the invoice and its vervaldatum, so it is identical on every run — but it is STORED in
  // the bank_tx_invoices row, and the undo deletes that row. The replay lookup then misses, the
  // selection still matches (status 'received', direction incoming), and the pass books the whole
  // balance again. Hourly, indefinitely, until the owner switches the supplier off entirely.
  //
  // What that costs is not a duplicate: amount_paid is clamped, so the books stay self-consistent
  // while asserting a payment that never happened. The invoice leaves 'nog te betalen', and under
  // the kasstelsel the restored payment_date — the vervaldatum — decides which quarter the
  // voorbelasting is claimed in, so it is deducted on money that never left the account.
  //
  // Holding is the safe side, and it is the side this whole function already takes: the invoice
  // stays open and visible, and the owner is told why instead of watching it flip back.
  if (wasAutoIncasso(inv.field_confidence)) return { settle: false, hold: 'undone' }

  if (inv.accountant_status === 'verwerkt') return { settle: false, hold: 'verwerkt' }

  // [CREDIT-SAFE] The same single answer the manage screen reads. A creditnota — or an invoice
  // that behaves as one, whichever way the supplier put it on paper — is money coming BACK. There
  // is no collection to assume, and marking it "paid" would settle a debt that runs the other way.
  if (!payableAsDebt(creditStance({
    invoiceNumber: inv.invoice_number ?? null,
    totalIncBtw: inv.total_inc_btw,
    invoiceType: inv.invoice_type ?? null,
    vendorNumbers: [],
  }))) return { settle: false, hold: 'creditnota' }

  if (!inv.due_date) return { settle: false, hold: 'no-due-date' }
  // Strictly AFTER the vervaldatum. On the day itself the collection may still be running, and
  // booking a payment that has not happened yet is precisely what this module must not do.
  if (inv.due_date >= today) return { settle: false, hold: 'not-yet-due' }

  const total = Math.abs(inv.total_inc_btw ?? 0)
  if (!(total > 0)) return { settle: false, hold: 'no-amount' }

  // [ARITHMETIC-VISIBLE] The invoice's own health verdict, computed from the same classifier the
  // queue and the manage screen use. Each of these flags means a specific thing is unknown, and
  // an automatic booking cannot ask. A human still can, which is why these HOLD instead of skip:
  // the invoice stays open and visible, exactly where the owner can answer it.
  const health = classifyImportHealth(inv)
  if (health.flags.ibanChanged) return { settle: false, hold: 'iban-changed' }
  if (health.flags.possibleDuplicate) return { settle: false, hold: 'duplicate' }
  if (health.flags.multipleInvoices) return { settle: false, hold: 'multiple-invoices' }
  if (health.flags.arithmetic) return { settle: false, hold: 'arithmetic' }

  // The vervaldatum, not today: that is the day the bank moved the money, and under the
  // kasstelsel it is the day that decides which aangifte the voorbelasting lands in.
  return { settle: true, paymentDate: inv.due_date }
}

/**
 * What an incasso invoice looks like on screen, before anything is booked.
 *
 * `awaiting`  — the collection has not run yet. No "te laat", no "Betalen".
 * `collected` — the vervaldatum has passed; the money is gone and the booking is on its way (the
 *               hourly cron, or the next time the owner opens the app).
 * `null`      — this invoice is not on an incasso at all.
 *
 * Deliberately NOT the full decision: a row held back for a duplicate or a changed IBAN still
 * reads as an incasso invoice on the card, and its hold is shown next to it. Hiding the incasso
 * badge because of a hold would put the "Betalen" button back on an invoice the bank collects.
 */
export function incassoDisplayState(
  inv: Pick<IncassoInvoice, 'status' | 'direction' | 'due_date'>,
  isIncassoSupplier: boolean,
  today: string,
): 'awaiting' | 'collected' | null {
  if (!isIncassoSupplier) return null
  if (inv.direction !== 'incoming') return null
  if (inv.status !== 'received') return null
  if (inv.due_date && inv.due_date < today) return 'collected'
  return 'awaiting'
}

/**
 * The line on the card. Dutch, owner-facing — this is product text, not code (AGENTS.md).
 *
 * It says who does it and when, because the whole point is that the owner stops wondering. No
 * date at all is still worth saying: it is the difference between "the app forgot this one" and
 * "this one is handled".
 */
export function incassoLabel(state: 'awaiting' | 'collected', dueDateText: string | null): string {
  if (state === 'collected') return 'Automatisch afgeschreven'
  return dueDateText ? `Wordt automatisch afgeschreven op ${dueDateText}` : 'Wordt automatisch afgeschreven'
}

/**
 * The marker written into invoices.field_confidence when a payment was ASSUMED rather than seen.
 *
 * It matters that this is on the invoice and not only in the audit log. `payment_method` stays
 * 'bank' because that is simply true — the money left the bank account — so nothing in the row
 * itself would otherwise distinguish a payment the app watched arrive from one it inferred. A
 * later bank line can then confirm this one, and a storno (a collection reversed for want of
 * funds) is findable instead of invisible.
 */
export const AUTO_INCASSO_MARKER = '_auto_incasso' as const

export interface AutoIncassoMark {
  /** When the app booked it. */
  at: string
  /** The date it booked it ON — the vervaldatum the collection ran against. */
  paid_on: string
  /** The supplier whose mandate this was, as it stood on the invoice. */
  supplier: string | null
}

/** Merge the marker into an existing field_confidence object without disturbing the rest. */
export function withIncassoMark(
  existing: Record<string, unknown> | null | undefined,
  mark: AutoIncassoMark,
): Record<string, unknown> {
  return { ...(existing ?? {}), [AUTO_INCASSO_MARKER]: mark }
}

/** Was this payment assumed by [AUTO-INCASSO] rather than observed? */
export function wasAutoIncasso(fieldConfidence: unknown): boolean {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return false
  return AUTO_INCASSO_MARKER in (fieldConfidence as Record<string, unknown>)
}
