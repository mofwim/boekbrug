// src/lib/bulk-confirm.ts
// [BULK-BEVESTIG] Which of the waiting purchase invoices an accountant may confirm in one go — and
// which must stay one tap each. Pure: no I/O, no clock.
//
// ── THE FRICTION THIS REMOVES ──
// /dashboard/accountant/bevestigen loads up to 500 rows, across every client that has authorised
// this accountant, and confirms them ONE AT A TIME. A bookkeeper with twenty clients therefore
// spends their quarter on a screen whose whole purpose is to be faster than the alternative,
// tapping a button four hundred times. That is the single largest time cost the accountant surface
// has, and it is entirely mechanical.
//
// ── WHY "SELECT ALL" WOULD BE THE WRONG ANSWER ──
// The screen's own doctrine, from its header: "Bevestigen is hier 'deze lezing klopt, boek hem'."
// And from the render gate that guards it: "a confirm button above a hidden doubt turns the
// accountant into a rubber stamp."
//
// A row carries `twijfels` — the fields the READER was not sure of, shown in words above its
// button. Those are precisely the rows where a human looking at the document is the entire value
// of the step. A checkbox invites sweeping them up with the rest, and a bulk action that can
// swallow a doubt is worse than no bulk action: it converts the one safeguard on this screen into
// a formality, at scale, in a single tap.
//
// So the split is not a preference, it is the doctrine expressed as code: rows the reader was
// CERTAIN about can be confirmed together; rows it was unsure about are refused from the selection
// and COUNTED, so the exclusion is visible rather than quiet. The accountant still confirms those,
// one at a time, having looked — which is the work, not the overhead.
//
// Nothing here books anything. It decides what may be offered; the existing single route
// (/api/accountant/bevestig) performs every confirmation, so the mandate check, the compare-and-
// swap on status, the confirmed_by trail and the client's notification are inherited rather than
// reimplemented. A second booking path is how two paths drift on the invariant that matters.

import { round2 } from './invoice-totals'

/** The row fields this reads. A structural subset of the confirm screen's list. */
export interface ConfirmCandidateRow {
  id: string
  clientId: string
  clientNaam: string
  leverancier: string
  factuurnummer: string | null
  totaalInc: number | null
  /** What the reader was NOT sure of. Empty = nothing flagged. */
  twijfels: string[]
}

export type ConfirmRefusal = 'leesonzekerheid'

export interface BulkConfirmPlan {
  /** Rows that may be confirmed together. */
  eligible: ConfirmCandidateRow[]
  /** Rows held back, with the reason — shown, never silently dropped. */
  refused: { row: ConfirmCandidateRow; reason: ConfirmRefusal }[]
  /** Total gross of the eligible rows — what is about to be booked. */
  total: number
  /** How many distinct clients the selection touches. */
  clientCount: number
}

/** May this row be part of a bulk confirmation at all? */
export function bulkConfirmable(row: ConfirmCandidateRow): boolean {
  return row.twijfels.length === 0
}

/**
 * What a bulk confirmation of these rows would do.
 *
 * `selectedIds` is what the accountant ticked. A row that is not bulk-confirmable is refused even
 * when selected: the checkbox is not rendered for it, so its presence here means something went
 * wrong, and the safe answer to that is the same as to a deliberate attempt.
 */
export function planBulkConfirm(
  rows: readonly ConfirmCandidateRow[],
  selectedIds: ReadonlySet<string>,
): BulkConfirmPlan {
  const eligible: ConfirmCandidateRow[] = []
  const refused: { row: ConfirmCandidateRow; reason: ConfirmRefusal }[] = []

  for (const r of rows) {
    if (!selectedIds.has(r.id)) continue
    if (!bulkConfirmable(r)) {
      refused.push({ row: r, reason: 'leesonzekerheid' })
      continue
    }
    eligible.push(r)
  }

  const total = eligible.reduce((sum, r) => {
    const n = Number(r.totaalInc)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  return {
    eligible,
    refused,
    total: round2(total),
    clientCount: new Set(eligible.map((r) => r.clientId)).size,
  }
}

/** € 1.234,56 — the notation the rest of the accountant surface uses. */
function eur(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)
}

/**
 * The confirm's one-line summary. Dutch, per AGENTS.md.
 *
 * The client count is in it whenever there is more than one, because "12 facturen bevestigen" reads
 * as one administration and this screen spans every client at once. Booking into the wrong client's
 * books is the mistake this sentence exists to prevent.
 */
export function bulkConfirmTitle(plan: BulkConfirmPlan): string {
  const n = plan.eligible.length
  const bedrag = eur(plan.total)
  if (n === 1) return `1 factuur bevestigen (${bedrag})?`
  return plan.clientCount > 1
    ? `${n} facturen bevestigen bij ${plan.clientCount} klanten (${bedrag})?`
    : `${n} facturen bevestigen (${bedrag})?`
}

/**
 * The sentences shown before it happens, in the order they matter.
 *
 * The held-back rows come FIRST when there are any: an exclusion the accountant does not notice is
 * the same as no exclusion, and this one is the whole reason the feature is safe.
 */
export function bulkConfirmWarnings(plan: BulkConfirmPlan): string[] {
  const out: string[] = []
  if (plan.refused.length > 0) {
    const n = plan.refused.length
    out.push(
      `${n === 1 ? '1 factuur blijft staan' : `${n} facturen blijven staan`}: daar kon de lezer niet ` +
      `alles zeker lezen. Die bevestig je één voor één, nadat je het document zelf hebt bekeken.`,
    )
  }
  out.push(
    'Je bevestigt de lezing — je verandert er niets aan. Bij elke bevestiging komt jouw naam te staan en krijgt je klant bericht; de verantwoordelijkheid blijft bij hem (art. 52 AWR).',
  )
  if (plan.clientCount > 1) {
    out.push(`Deze facturen horen bij ${plan.clientCount} verschillende klanten.`)
  }
  return out
}

/**
 * How a run that partly failed is reported.
 *
 * A bulk action over a per-row route WILL sometimes half-succeed — a mandate withdrawn mid-run, one
 * invoice already confirmed in another tab. Reporting "gelukt" over that is the failure this
 * codebase keeps correcting, so the caller gets both numbers and the screen says both.
 */
export function bulkConfirmResultText(done: number, failed: number): string {
  if (failed === 0) {
    return done === 1 ? '1 factuur bevestigd.' : `${done} facturen bevestigd.`
  }
  if (done === 0) {
    return failed === 1
      ? 'De factuur kon niet worden bevestigd — hij staat er nog.'
      : `Geen van de ${failed} facturen kon worden bevestigd — ze staan er nog.`
  }
  return `${done} bevestigd, ${failed} niet — die staan er nog en kun je apart proberen.`
}
