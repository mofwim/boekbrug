// src/lib/statement-reversal.ts
// [REVERSAL-SET] Which invoices does deleting a bank statement un-pay? Pure.
//
// ── WHY THIS IS A MODULE AND NOT TEN LINES IN THE ROUTE ──
// Deleting a statement is the most destructive button in the app: it removes bank lines and marks
// invoices unpaid again. Both directions of being wrong cost the owner real money, and they cost
// it differently:
//
//   · TOO NARROW — an invoice this statement paid is left claiming 'paid' while the line that paid
//     it is gone. It reads settled, drops out of the debtor list and out of dunning, and nobody
//     ever chases it.
//   · TOO WIDE — an invoice that was genuinely paid some OTHER way is un-paid. The owner chases a
//     customer who already paid, or pays a supplier bill twice.
//
// The decision was inline in the route, tangled with three database reads, and therefore untested.
// This module is that decision alone, so both directions can be pinned.
//
// ── THE TWO TIERS ARE NOT THE SAME KIND OF EVIDENCE ──
// This is the whole design, and getting it wrong is how a safe-looking widening becomes the
// dangerous direction:
//
//   ID-LINKED — a bank_tx_invoices row, or tx.invoice_id, says this statement's transaction paid
//   this invoice. That is proof. It holds whatever payment_method the invoice ended up carrying,
//   and that matters: an invoice settled in two instalments (a bank payment from this statement,
//   then a cash payment) ends up as payment_method 'kas' — apply_manual_payment writes the method
//   of the LAST payment. Filtering the reversal set on payment_method = 'bank' silently excluded
//   exactly those invoices. Deleting the statement then cascaded their link away, and
//   recompute_invoice_amount_paid lowered amount_paid to the cash part — correct money — while
//   `status` stayed 'paid'. Nothing re-derives status. The invoice sat marked fully settled with
//   half of it still owed.
//
//   NUMBER-MATCHED (gap-fill) — no link row exists; the only tie is that the statement's payment
//   description PRINTS this invoice's number, and the direction agrees. That is a guess, and it is
//   deliberately restricted to invoices that were paid BY BANK. An invoice paid in cash has no
//   bank link by construction, so it cannot be a sibling of a pre-migration bank batch — and
//   un-paying it because a deleted statement happened to mention its number is precisely the
//   too-wide failure above. The tier exists only to recover historical batch siblings whose
//   representative id the migration could not reconstruct.
//
// So: widen the proven tier, never the guessed one. The caller still has to exclude gap candidates
// that are id-linked to a transaction OUTSIDE this statement (they belong to another payment) —
// that needs a database read and stays in the route.

/** The invoice fields the decision reads. A structural subset of the row. */
export interface ReversalInvoice {
  id: string
  invoice_number: string | null
  direction: string | null
  payment_method: string | null
}

/** The transaction fields the decision reads. */
export interface ReversalTx {
  reference: string | null
  amount: number | null
}

export interface ReversalPlan<T> {
  /** Proven by a link row: reverse these, whatever paid them. */
  idLinked: T[]
  /** Matched on printed number + direction only. The caller must still exclude foreign claims. */
  gapCandidates: T[]
}

/**
 * Split the account's paid invoices into the two reversal tiers for one statement.
 *
 * @param paid       every paid invoice of this user (the route pages the read; order is irrelevant)
 * @param idSet      invoice ids this statement's transactions are linked to
 * @param txs        this statement's transactions
 * @param refNumbers extracts the invoice numbers a payment description names
 * @param normalize  folds a printed number for comparison
 */
export function planStatementReversal<T extends ReversalInvoice>(
  paid: readonly T[],
  idSet: ReadonlySet<string>,
  txs: readonly ReversalTx[],
  refNumbers: (reference: string | null) => string[],
  normalize: (n: string) => string,
): ReversalPlan<T> {
  const idLinkedMap = new Map<string, T>()
  // No payment_method filter here, and that omission is the fix — see the header. The link row IS
  // the evidence; how the invoice was finally settled says nothing about whether this statement
  // paid part of it.
  for (const inv of paid) if (idSet.has(inv.id)) idLinkedMap.set(inv.id, inv)

  const covered = new Set<string>()
  for (const inv of idLinkedMap.values()) covered.add(normalize(inv.invoice_number ?? ''))

  const gapMap = new Map<string, T>()
  for (const t of txs) {
    const named = refNumbers(t.reference)
    // One number named is the ordinary case and it is already id-linked; the gap-fill exists for a
    // BATCH payment, where the migration could only backfill one representative id.
    if (named.length <= 1) continue
    const dir: 'incoming' | 'outgoing' | null =
      (t.amount ?? 0) < 0 ? 'incoming' : (t.amount ?? 0) > 0 ? 'outgoing' : null
    // A zero/absent amount has no direction, and without the direction guard a same-number invoice
    // of the opposite direction could be un-paid. Skip rather than guess.
    if (!dir) continue
    const uncovered = new Set(named.filter((n) => !covered.has(n)))
    if (uncovered.size === 0) continue
    for (const inv of paid) {
      if (idLinkedMap.has(inv.id)) continue
      if (inv.direction !== dir) continue
      // BANK ONLY on this tier. The tie here is a printed number, not a link — and an invoice
      // settled some other way was never part of a bank batch, so matching it can only be a
      // coincidence of numbering. Un-paying it would be the too-wide failure.
      if (inv.payment_method !== 'bank') continue
      if (!uncovered.has(normalize(inv.invoice_number ?? ''))) continue
      gapMap.set(inv.id, inv)
    }
  }

  return { idLinked: [...idLinkedMap.values()], gapCandidates: [...gapMap.values()] }
}
