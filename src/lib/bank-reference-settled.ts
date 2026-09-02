// src/lib/bank-reference-settled.ts
// [AFSCHRIFT-NOEMT] The bank line names an invoice. Ask which one BEFORE guessing.
//
// ── WHAT WAS MEASURED, THREE TIMES, ON THIS OWNER'S OWN BOOKS ──
//
//   17-08-2026  −€ 797,86   description "2919045"   → invoice 2919045, HVO Meat, € 797,86, PAID
//   17-08-2026  −€1.056,87  description "2034382"   → invoice 2034382, CAN Vlees, €1.056,87, PAID
//   27-07-2026  −€   40,00  description "26 00623"  → invoice FAC/26-26/00623, € 40,00, PAID
//
// Each of the three was already settled by a MANUAL instalment carrying the same amount and the
// same date (a bank_tx_invoices row with no transaction_id): the owner ticked it off, and then the
// statement arrived. What the screen offered instead:
//
//   · HVO Meat  → three unrelated invoices of € 2.449,64 / € 2.822,27 / € 3.008,71
//   · CAN Vlees → invoice 2034534 as a PARTIAL payment, leaving € 161,05 "open" forever
//   · Coroama   → invoice FAC/2026/00296, under a green ✓
//
// Confirming any of them books a SECOND payment for money that moved once. Across this account, 43
// unlinked bank lines name a paid invoice of exactly their own amount (€ 30.580,56), and 10 more
// name an archived one (€ 10.503,71).
//
// ── WHY THE APP COULD NOT SEE IT ──
//
// Not a scoring weakness — a question that is asked too late. /api/bank/match reads invoices with
// `.neq("status", "paid")`, and isEligible drops paid/archived/draft/processing before a single
// signal is scored. So the reference — the strongest evidence there is, printed by the bank itself
// — is never compared against the very invoices it names. It does not lose; it is never entered.
//
// The route DOES own a pass that scores paid invoices ([BANK-PAID-EXPLAINED]), and its own comment
// bounds it: it runs only on lines with `outcome === 'none'`. All three cases above have a weak
// amount+counterparty candidate, so outcome is not 'none' and the pass never reaches them. "Is this
// already explained by an invoice you paid?" was asked only when nothing else answered — while the
// answer, when it exists, outranks everything else that could.
//
// ── WHAT THIS MODULE DOES, AND WHAT IT REFUSES TO DO ──
//
// Token lookup, not matching. It takes the numbers the bank printed (through the matcher's OWN
// parser — a second parser here would be a second opinion about what a reference is), and asks
// whether one of them names an invoice the matcher cannot see. It never scores, never ranks by
// name or date, and never reports a merely-plausible hit: without an exact amount it says so, and
// the caller keeps the wording honest.
//
// It answers about INVISIBLE invoices only. One the matcher can still offer is the matcher's
// business, and answering twice about the same invoice is how two screens start disagreeing.
//
// Pure. Run: npx tsx --test src/lib/bank-reference-settled.test.ts

/** One invoice the matcher will not offer — paid, archived, or otherwise out of the running. */
export interface InvisibleInvoice {
  id: string
  invoiceNumber: string | null
  /** Signed total as stored; compared on magnitude, like every other amount check here. */
  totalIncBtw: number | null
  amountPaid?: number | null
  /** 'paid' | 'archived' | … — carried through so the sentence can say which it is. */
  status: string | null
  clientName?: string | null
  invoiceDate?: string | null
}

export interface ReferencedInvoiceVerdict {
  invoiceId: string
  invoiceNumber: string
  clientName: string | null
  invoiceDate: string | null
  status: string
  /** What is still open on it. 0 = fully settled. */
  stillOpen: number
  /**
   * The line's amount equals this invoice's total to the cent.
   *
   * FALSE is not a smaller yes. A number in a reference can be a customer number, an order number
   * or a batch counter, and this module is read by a screen that will tell the owner money is
   * already accounted for. Without the amount the caller must say only that the reference names
   * this invoice — never that the payment is explained by it.
   */
  amountAgrees: boolean
}

/** One cent, the same epsilon the matcher and apply_bank_payment use. */
const CENT = 0.01

/**
 * Does one printed token name this invoice?
 *
 * The same rule [BANK-REF-CONTRADICTS] applies in reverse: a token matches when it IS the
 * normalized number or is CONTAINED in it. Containment is needed because a bank truncates —
 * "26 00623" is what the statement carries for FAC/26-26/00623 — and it is safe here because a
 * token is at least four characters with a digit (isReferenceNumberToken), and because the amount
 * has to agree before anything is claimed.
 */
function tokenNames(normalizedNumber: string, token: string): boolean {
  if (!normalizedNumber || !token) return false
  return normalizedNumber === token || normalizedNumber.includes(token)
}

/**
 * The invoice this bank line NAMES, when the matcher cannot see it.
 *
 * Ranked, because a statement can carry more than one number and an owner may have two invoices
 * whose numbers share a tail: an exact amount first, then the longest token match (the most
 * specific), then the number itself so the answer never depends on row order.
 *
 * Returns null when nothing is named — which is the ordinary case and must stay silent.
 */
export function referencedInvisibleInvoice(
  reference: string | null | undefined,
  /** The bank line's own amount, signed as stored. */
  amount: number,
  invisible: readonly InvisibleInvoice[] | null | undefined,
  /** The matcher's parseReferenceNumbers. Injected so there is ONE definition of "a reference". */
  parseReferenceNumbers: (reference: string | null) => string[],
  /** The matcher's normalizeRef, for the same reason. */
  normalizeRef: (s: string) => string,
): ReferencedInvoiceVerdict | null {
  const tokens = parseReferenceNumbers(reference ?? null)
  if (tokens.length === 0 || !invisible || invisible.length === 0) return null

  const lineAmount = Math.abs(Number(amount))
  if (!Number.isFinite(lineAmount)) return null

  type Scored = { verdict: ReferencedInvoiceVerdict; tokenLength: number }
  const hits: Scored[] = []

  for (const inv of invisible) {
    const number = normalizeRef(inv.invoiceNumber ?? '')
    if (!number) continue
    let best = 0
    for (const t of tokens) if (tokenNames(number, t) && t.length > best) best = t.length
    if (best === 0) continue

    const total = Math.abs(Number(inv.totalIncBtw ?? 0))
    const paid = Math.max(0, Number(inv.amountPaid ?? 0))
    hits.push({
      tokenLength: best,
      verdict: {
        invoiceId: inv.id,
        invoiceNumber: (inv.invoiceNumber ?? '').trim(),
        clientName: (inv.clientName ?? '').trim() || null,
        invoiceDate: inv.invoiceDate ?? null,
        status: (inv.status ?? '').trim(),
        stillOpen: Math.max(0, Math.round((total - paid) * 100) / 100),
        amountAgrees: Number.isFinite(total) && Math.abs(total - lineAmount) < CENT,
      },
    })
  }
  if (hits.length === 0) return null

  hits.sort((a, b) =>
    Number(b.verdict.amountAgrees) - Number(a.verdict.amountAgrees) ||
    b.tokenLength - a.tokenLength ||
    a.verdict.invoiceNumber.localeCompare(b.verdict.invoiceNumber),
  )
  return hits[0].verdict
}

/**
 * Does this verdict OUTRANK the suggestion the matcher produced?
 *
 * Only when the bank named a different invoice than the one being offered. A statement naming the
 * candidate itself is the candidate's own evidence, not a contradiction — and a line with no
 * suggestion at all is outranked by anything, which is the point.
 *
 * Deliberately independent of how strong the suggestion looked. The measured cases scored well
 * enough to be shown under a green ✓ and one of them offered a partial payment; "strong" is exactly
 * what a wrong answer looks like when the evidence for the right one was never entered.
 */
export function referenceOutranksSuggestion(
  verdict: ReferencedInvoiceVerdict | null,
  suggestedInvoiceId: string | null | undefined,
): boolean {
  if (!verdict) return false
  return verdict.invoiceId !== (suggestedInvoiceId ?? null)
}
