// src/lib/statiegeld.ts
// [STATIEGELD-GAT] The deposit line the reader dropped, found back on the paper. Pure — no I/O.
//
// ── THE INVOICE THIS IS FOR ──
//
// Elegance Brands 2026080832, reported by the owner:
//
//   Subtotaal          € 835,30
//   BTW 9%             €  75,22
//   Totaal Statiegeld  € 176,40
//   Totaal             € 1.086,92
//
// The reader returned the Subtotaal as "excl. btw" and left the deposit out — so the app held the
// invoice with "excl. + btw komt niet uit op het totaal" and the owner was left to work out what
// was missing. The extraction prompt already spells this case out at length (see STATIEGELD /
// EMBALLAGE in ai.ts) and the model still dropped it, which is the point: a rule the reader is
// ASKED to follow needs a mechanical net underneath it, because on a drinks wholesaler's invoice
// this is not an edge case — it is most invoices.
//
// ── THE MECHANICAL PART ──
//
// The identity fixes the amount with no judgement at all: whatever is missing is exactly
// total − (excl + btw). Here that is € 176,40. The only open question is WHAT that difference is,
// and the document answers it: € 176,40 stands printed next to the word "Statiegeld". Two
// independent facts meeting on the same number is a stronger statement than either alone, and
// neither of them is a model's opinion.
//
// Deposits carry no btw (a waarborgsom is outside the levy), so folding the difference into the
// base leaves the btw untouched — which is why this is a safe repair to OFFER: it changes what is
// booked as cost, never what is claimed as voorbelasting.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──
//
// It does not repair anything. It reports a difference and the evidence for what it is; the owner
// taps once and the confirm screen applies it. Same rule as btw-reconcile.ts and books-audit.ts:
// where two sources disagree, stating it is ours and deciding is theirs. And it stays silent
// unless the paper corroborates — an unexplained difference must keep reading as unexplained,
// because "we think this is deposit" over a misread total is the one outcome worse than the
// message the owner complained about.
//
// Dutch words in the label list are DATA (they are what suppliers print), not UI text.

import { amountOccurrences } from './amount-grounding'
import { round2 } from './invoice-totals'

/** Same cent tolerance as the arithmetic gate in safecore.ts. */
const SUM_TOLERANCE = 0.02

/**
 * How far from the amount the label may stand. A totals block prints "Totaal Statiegeld" a few
 * characters before its figure; a column layout can put a header a line or two away. Wide enough
 * for both, narrow enough that a deposit line elsewhere on a long invoice does not vouch for an
 * unrelated number.
 */
const LABEL_WINDOW = 160

/**
 * What a Dutch supplier calls a deposit. `borg` and `fust` are whole words on purpose — "borg"
 * lives inside "Borgman" and "Denenborg", and a supplier NAME must never vouch for an amount.
 */
const DEPOSIT_LABEL =
  /(statiegeld|emballage|stortgeld|leengeld|waarborg|\bborg\b|\bfust\b|\bfusten\b|\bkrat\b|\bkratten\b|verpakkingsgeld|retouremballage)/i

export interface DepositGap {
  /**
   * total − (excl + btw): what the breakdown is missing, signed. Positive on a deposit charged
   * (the ordinary case); NEGATIVE when a returned deposit was dropped ("Retour container −408,00"),
   * where the base is too HIGH by that amount. Either way, adding this to excl closes the identity.
   */
  gap: number
  /** The deposit word as printed beside the amount, so the sentence can quote the paper. */
  label: string
  /** What excl becomes once the difference is folded in. The figure the owner is agreeing to. */
  correctedExcl: number
}

/**
 * Is the gap in this breakdown a deposit line that stands printed on the document?
 *
 * `text` is the document's own characters (a PDF text layer) or a transcription of a photo — the
 * same witness amount-grounding uses. Without text there is nothing to corroborate with and the
 * answer is null: a check that cannot run reports nothing, it does not guess.
 */
export function detectDepositGap(input: {
  totalExBtw?: number | null
  btwAmount?: number | null
  totalIncBtw?: number | null
  text?: string | null
}): DepositGap | null {
  const ex = input.totalExBtw
  const btw = input.btwAmount
  const total = input.totalIncBtw
  if (typeof ex !== 'number' || !Number.isFinite(ex)) return null
  if (typeof btw !== 'number' || !Number.isFinite(btw)) return null
  if (typeof total !== 'number' || !Number.isFinite(total)) return null

  const gap = round2(total - ex - btw)
  // It already adds up — nothing missing, nothing to explain.
  if (Math.abs(gap) <= SUM_TOLERANCE) return null

  const t = (input.text ?? '').trim()
  if (!t) return null

  // The MAGNITUDE is what stands on the paper; the sign comes from the arithmetic, because a
  // returned deposit is printed as a positive figure under a "Retour" heading just as often as
  // with a minus in front of it.
  for (const at of amountOccurrences(Math.abs(gap), t)) {
    const window = t.slice(Math.max(0, at - LABEL_WINDOW), at + LABEL_WINDOW)
    const hit = window.match(DEPOSIT_LABEL)
    if (hit) {
      return { gap, label: hit[1], correctedExcl: round2(ex + gap) }
    }
  }
  return null
}

/** € 1.234,56 — the notation the rest of the screens use. */
function eur(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)
}

/**
 * The owner-facing sentence. Dutch: the entrepreneur reads it (AGENTS.md).
 *
 * It names the difference, what the paper calls it, and the figure the base BECOMES — because the
 * complaint this answers was not "I do not know that something is wrong", it was "I cannot do
 * anything with being told that something is wrong".
 */
export function depositGapText(d: DepositGap): string {
  const richting = d.gap > 0 ? 'erbij' : 'eraf'
  return (
    `het verschil van ${eur(Math.abs(d.gap))} staat op de factuur als ${d.label} — dat hoort ${richting} ` +
    `in het bedrag excl. btw, dat wordt dan ${eur(d.correctedExcl)}. De btw verandert niet: over ` +
    `statiegeld wordt geen btw gerekend`
  )
}
