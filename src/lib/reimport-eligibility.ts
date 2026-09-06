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

// ── [SPLIT-ALSNOG] The other kind of re-read: one that overwrites nothing ─────────────────────
//
// Measured on the live administration: 31 incoming invoices carry a BLENDED btw rate, and 29 of
// them hold no per-rate specification block — € 2.758,01 of voorbelasting on which the only check
// that can see a mis-read (btw-split.ts) never ran. Every one of those 29 was imported before the
// reader learned to read that block; both mixed-rate invoices since carry it. So nothing is broken
// going forward, and there was no way BACK.
//
// The full re-read above cannot be that way back. It REPLACES the amounts, and on these invoices
// the amounts are the part we have no reason to doubt — Enka Horeca 26710525 stores exactly what
// the paper prints. Handing those figures to a fresh read to win a checkmark is trading a number
// we trust for one we have not looked at. It also refuses paid and processed rows, which is
// exactly where an unverifiable deduction is worth the most to check.
//
// So this decision is a different question about a different act: read the document again and take
// ONLY the per-rate block. No amount, no total, no status, no direction — one key.
//
// ── WHY THE MONEY REFUSALS DO NOT APPLY ──
// Every refusal above exists because a re-read changes what the owner pays or what the accountant
// has processed. This one changes neither: field_confidence._btw_rows is EVIDENCE about the paper,
// not a figure anyone books. A paid invoice, an archived one, an invoice the accountant marked
// 'verwerkt' — all may be checked, and the deduction already taken is precisely the reason to.
//
// ── AND WHY IT NEVER OVERWRITES A BLOCK WE ALREADY HAVE ──
// A stored block is either what the reader saw or what the owner typed in the correction sheet
// ([SPLIT-CORRECTIE]). Replacing either with a fresh model read means the second opinion silently
// wins over a human's, which is backwards. Nothing to do is an answer.

export type BtwRowsRefusal = 'not_incoming' | 'no_file' | 'already_known'

export type BtwRowsDecision =
  | { allowed: true }
  | { allowed: false; reason: BtwRowsRefusal; message: string }

/** Does this invoice already carry a per-rate block? An empty array counts: we looked, and there was none. */
export function hasBtwRows(fieldConfidence: unknown): boolean {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return false
  return '_btw_rows' in (fieldConfidence as Record<string, unknown>)
}

/**
 * May we read this document again for its btw specification alone?
 *
 * Dutch messages: shown to the entrepreneur (AGENTS.md).
 */
export function btwRowsReadDecision(
  inv: ReimportInvoice & { field_confidence?: unknown },
): BtwRowsDecision {
  if ((inv.direction ?? '') !== 'incoming') {
    return {
      allowed: false,
      reason: 'not_incoming',
      message: 'Alleen bij inkomende facturen kunnen we de btw-specificatie nalezen.',
    }
  }
  if (!((inv.pdf_url ?? '').trim() || (inv.document_id ?? '').trim())) {
    return {
      allowed: false,
      reason: 'no_file',
      message: 'Er hangt geen bestand aan deze factuur, dus er valt niets na te lezen.',
    }
  }
  if (hasBtwRows(inv.field_confidence)) {
    return {
      allowed: false,
      reason: 'already_known',
      message: 'De btw-specificatie van deze factuur is al bekend.',
    }
  }
  return { allowed: true }
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
