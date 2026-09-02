// src/lib/bank-rejections.ts
// [NIET-DEZE-FACTUUR] What a bank line's card shows after the owner has said "not this invoice".
//
// ── WHY THIS EXISTS ──
//
// The card offered an invoice and one button: Bevestig betaling. There was no way to say the
// suggestion was WRONG. Reported on a card proposing invoice FAC/2026/00296 for a payment whose own
// bank description reads "26 00623" — a different invoice — under a green check. The owner could
// confirm it or leave the line sitting there, and leaving it means the same wrong pair is offered
// again on every visit.
//
// ── THE ONE RULE THAT MAKES THIS SAFE ──
//
// A rejection may REMOVE a suggestion. It may never PROMOTE one.
//
// If the owner rules out the winner of an 'auto' line, the runner-up does not inherit the tap. It
// was the runner-up precisely because the evidence for it was weaker, and a screen that answers
// "no" by pre-selecting the next-best answer is arguing rather than listening. So an 'auto' whose
// winner is refused becomes a 'choice': the remaining invoices are still shown — they may well be
// right — but the owner picks one deliberately, and the app never books on its own.
//
// And a line with nothing left is 'none', which is honest: this payment has no invoice the app can
// suggest. That is a different sentence from "we did not look", and the Geen-factuur tab already
// says the right things about it.
//
// ── WHAT A REJECTION IS NOT ──
//
// Not a judgement about the supplier. It is the narrowest true statement — this invoice, this line
// — and it must stay that way. The matcher's memory is derived from CONFIRMATIONS
// (match-memory.ts); if a refusal taught it something general, one mis-tap would change how a whole
// counterparty is read for months.
//
// Pure. Run: npx tsx --test src/lib/bank-rejections.test.ts

/** The shape this needs off a match — a structural subset of the route's own DTO. */
export interface RejectableMatch<C extends { invoiceId: string }> {
  outcome: string
  best: C | null
  candidates: readonly C[]
}

export interface AfterRejections<C extends { invoiceId: string }> {
  outcome: string
  best: C | null
  candidates: C[]
  /** True when something was actually removed — the screen may then say why the card changed. */
  removed: boolean
}

/**
 * Apply this owner's refusals to one line's suggestions.
 *
 * `rejected` holds the invoice ids refused FOR THIS TRANSACTION. The caller looks them up per line;
 * passing a global set here would silently hide an invoice on every line the owner has, which is
 * the one mistake this feature could make that is worse than the problem it solves.
 */
export function applyRejections<C extends { invoiceId: string }>(
  match: RejectableMatch<C>,
  rejected: ReadonlySet<string> | null | undefined,
): AfterRejections<C> {
  const candidates = [...(match.candidates ?? [])]
  if (!rejected || rejected.size === 0) {
    return { outcome: match.outcome, best: match.best ?? null, candidates, removed: false }
  }

  const kept = candidates.filter((c) => !rejected.has(c.invoiceId))
  const bestRefused = match.best != null && rejected.has(match.best.invoiceId)
  const removed = kept.length !== candidates.length || bestRefused
  if (!removed) {
    return { outcome: match.outcome, best: match.best ?? null, candidates, removed: false }
  }

  // Nothing left to offer. Not a failure — a fact, and one the Geen-factuur tab already knows how
  // to phrase.
  if (kept.length === 0) return { outcome: 'none', best: null, candidates: [], removed: true }

  // The winner survived: the rest of the card is unchanged, minus what was refused.
  if (!bestRefused) return { outcome: match.outcome, best: match.best ?? null, candidates: kept, removed: true }

  // The winner is gone. What is left is SHOWN, never pre-chosen — see the rule at the top.
  return { outcome: 'choice', best: null, candidates: kept, removed: true }
}

/**
 * Group flat rejection rows into "which invoices are refused for this transaction".
 *
 * Keyed per transaction on purpose. A rejection is about a PAIR, and flattening it to a set of
 * invoice ids would make one refusal hide that invoice from every other line as well.
 */
export function rejectionsByTransaction(
  rows: readonly { transaction_id: string | null; invoice_id: string | null }[] | null | undefined,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const r of rows ?? []) {
    const tx = (r.transaction_id ?? '').trim()
    const inv = (r.invoice_id ?? '').trim()
    if (!tx || !inv) continue
    const set = out.get(tx) ?? new Set<string>()
    set.add(inv)
    out.set(tx, set)
  }
  return out
}
