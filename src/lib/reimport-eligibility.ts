// src/lib/reimport-eligibility.ts
// [REREAD-CONFIRMED] Which invoices may be read again, and what happens to the one that is. Pure.
//
// ── THE GAP THIS CLOSES ──
// "Opnieuw inlezen" was allowed only while status = 'processing', with the reason written on the
// guard: never overwrite human work. Sound as far as it goes — and it left the moment that matters
// most uncovered.
//
// A confirmed, unpaid purchase invoice is exactly where a misread amount is about to cost money:
// the owner is looking at the pay screen, the figure is wrong, and the payment has not gone out
// yet. What the screen offered there was "Bedragen corrigeren" — type the right numbers yourself —
// while the app holds the paper and can simply read it again. The Enka Horeca invoice is the case:
// € 122,18 of btw where the paper says € 122,64, sitting on the pay list, waiting to be paid wrong.
//
// ── WHAT ACTUALLY HAS TO BE TRUE ──
// Not "the human has not confirmed it". Three things, and they are about MONEY and OWNERSHIP:
//
//   · no money booked against it — changing the total of an invoice that carries payments breaks
//     the invariant amount_paid = Σ bank_tx_invoices.amount_applied, and can leave a row paid for
//     more than it is worth. Same predicate the amount-correction route uses (hasSettledMoney), so
//     the two cannot drift apart;
//   · the accountant has not processed it — a 'verwerkt' row belongs to someone else's work now;
//   · it is still an incoming invoice with a file to read. Without the file there is nothing to do.
//
// Status then reduces to: 'processing' (the queue) or 'received' (confirmed, unpaid). 'archived'
// stays refused — re-reading a discarded row silently revives it — and 'paid' is already excluded
// by the money rule, but is named separately so the refusal can say something useful.
//
// ── AND THE ONE THING A RE-READ MUST NEVER DO ──
// Change what the owner is about to pay without them seeing it. So a re-read of a CONFIRMED
// invoice sends it back to the verify queue: the fresh numbers land in front of a human who
// confirms them, exactly as they did the first time. That is the same rule the old guard was
// protecting — "never auto-verify" — applied to the case it had simply refused instead.
//
// Pure: no I/O, no clock. The route re-checks the same predicate server-side; the screens use it
// to decide whether to offer the button at all, so a button never opens on a refusal.

/** The invoice fields the decision reads. A structural subset of the row. */
export interface ReimportInvoice {
  direction?: string | null
  status?: string | null
  amount_paid?: number | null
  accountant_status?: string | null
  /** The stored file. Either column may carry it depending on the ingestion path. */
  pdf_url?: string | null
  document_id?: string | null
}

export type ReimportRefusal =
  | 'not_incoming'
  | 'no_file'
  | 'money_booked'
  | 'accountant_locked'
  | 'archived'
  | 'wrong_status'

export type ReimportDecision =
  | {
      allowed: true
      /**
       * True when the invoice was already confirmed, so the re-read puts it back in the queue.
       * The screens say so BEFORE the tap — an invoice disappearing off the pay list is a
       * surprise unless it was announced.
       */
      returnsToQueue: boolean
    }
  | { allowed: false; reason: ReimportRefusal; message: string }

/** Cent tolerance — the same bar hasSettledMoney uses. */
const CENT = 0.005

/**
 * May this invoice be read again, and does doing so send it back to the queue?
 *
 * Dutch messages: they are shown to the entrepreneur (AGENTS.md).
 */
export function reimportDecision(inv: ReimportInvoice): ReimportDecision {
  const status = (inv.status ?? '').trim()

  if ((inv.direction ?? '') !== 'incoming') {
    return {
      allowed: false,
      reason: 'not_incoming',
      message: 'Alleen inkomende facturen kunnen opnieuw ingelezen worden.',
    }
  }
  if (!((inv.pdf_url ?? '').trim() || (inv.document_id ?? '').trim())) {
    return {
      allowed: false,
      reason: 'no_file',
      message: 'Er hangt geen bestand aan deze factuur, dus er valt niets opnieuw te lezen.',
    }
  }
  // Money first: it is the only refusal that cannot be argued with, and it outranks the status
  // because a row can carry payments while its status still says otherwise.
  if (status === 'paid' || Math.max(0, Number(inv.amount_paid ?? 0)) > CENT) {
    return {
      allowed: false,
      reason: 'money_booked',
      message:
        'Er is al geld op deze factuur afgeboekt. Draai die betaling eerst terug; daarna kun je ' +
        'hem opnieuw laten inlezen.',
    }
  }
  if ((inv.accountant_status ?? '') === 'verwerkt') {
    return {
      allowed: false,
      reason: 'accountant_locked',
      message: 'Je boekhouder heeft deze factuur al verwerkt. Vraag hem eerst om die verwerking terug te draaien.',
    }
  }
  if (status === 'archived') {
    return {
      allowed: false,
      reason: 'archived',
      message: 'Deze factuur staat bij Genegeerd. Zet hem eerst terug voordat je hem opnieuw laat inlezen.',
    }
  }
  if (status !== 'processing' && status !== 'received') {
    return {
      allowed: false,
      reason: 'wrong_status',
      message: 'Deze factuur kan nu niet opnieuw ingelezen worden.',
    }
  }

  return { allowed: true, returnsToQueue: status === 'received' }
}

/**
 * What the owner is told BEFORE they tap, on a row that qualifies.
 *
 * The confirmed case has to announce the consequence: the invoice leaves the pay list and turns up
 * in the verify queue. Discovering that afterwards reads like the invoice was lost.
 *
 * Dutch: owner-facing.
 */
export function reimportPromptText(d: ReimportDecision): string | null {
  if (!d.allowed) return null
  return d.returnsToQueue
    ? 'Klopt er iets niet aan deze factuur? Laat hem opnieuw inlezen — hij gaat dan terug naar de controlewachtrij zodat je de nieuwe bedragen bevestigt.'
    : 'Klopt er iets niet aan deze factuur? Laat hem opnieuw inlezen.'
}
