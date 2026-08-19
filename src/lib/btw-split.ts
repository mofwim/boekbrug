// src/lib/btw-split.ts
// [BTW-SPLIT] Is the stored btw amount corroborated by anything, or does it only agree with itself?
//
// ── THE INVOICE THAT MADE THIS NECESSARY ──
// Enka Horeca B.V., factuur 26701681. The paper closes with a per-rate summary block:
//
//     Totaal exclusief BTW   € 1.213,50
//     €  1.101,38   BTW  9% excl.   €  99,06
//     €    112,12   BTW 21% excl.   €  23,58
//     Totaal te voldoen      € 1.336,14
//
// We stored excl € 1.213,50 · btw € 122,18 · totaal € 1.335,68. The excl is exactly right. The btw
// is € 0,46 short, and so is the total — because the total was made to follow the btw.
//
// Every gate in the app passed it, and each of them was right to:
//   · the arithmetic gate asks excl + btw = totaal. 1.213,50 + 122,18 = 1.335,68. It holds.
//   · the rate gate asks whether btw/excl lands in 0–21%. It is 10,07%, and a mix of 9% and 21%
//     blends to something in between, so a blend is exactly what a legal invoice looks like here.
//     The true numbers give 10,11%. Both are legal. The gate cannot separate them, ever.
//   · [BTW-SUM-FIX] (fixMisSummedBtw) only fires on a CONTRADICTION — a stated btw implying a rate
//     above 21% while the two printed anchors imply a legal one. Here nothing contradicts.
//
// So all seven checks in invoice-checks.ts showed green on an invoice with a wrong deductible btw.
// That is the failure that file's own header was written to prevent, and it happened because the
// checklist reported the one axis that CANNOT see this as though it had.
//
// ── WHAT IS ACTUALLY GOING ON ──
// On a SINGLE-rate invoice there are two independent constraints: the sum identity, and the fact
// that btw/excl must be exactly 9% or exactly 21%. Two constraints over three numbers is real
// corroboration — misread one figure and one of them breaks.
//
// On a MIXED-rate invoice the second constraint evaporates. Any blend in 0–21% is legal, so the
// rate check silently self-disables and only the sum identity is left. And the sum identity is
// worth nothing on its own, because whoever produced the triplet can always satisfy it by moving
// the third number — which is precisely what happens (see the prompt note at [PRINTED-TOTAL] in
// ai.ts: we used to instruct the reader to make the three agree).
//
// One constraint, three unknowns. The check does not fail — it stops existing, without saying so.
//
// ── WHAT THIS MODULE DOES ──
// It names that state. Four answers, and the middle one is the whole point:
//
//   single-rate       btw/excl is exactly a legal NL rate → corroborated, a tick is earned
//   blend-verified    a per-rate block was read AND its columns sum to what we stored → corroborated
//   blend-unverified  a blend, and no per-rate block to check it against → NOT CHECKED, say so
//   blend-mismatch    a per-rate block was read and it does NOT match → the Enka case, flagged
//   impossible        a rate no blend of 0/9/21 can reach → flagged (safecore already holds it)
//
// It REPAIRS nothing, deliberately, and that is not caution for its own sake. Repairing Enka means
// writing btw 122,64 AND totaal 1.336,14 — changing what the owner PAYS, from a read we have just
// established was wrong about this very invoice. The two printed anchors are named in the reason
// instead, and the human decides. Same rule as btw-reconcile.ts: this file only computes.
//
// Pure: no I/O, no clock, no database.

import { round2 } from './invoice-totals'

/** One row of the per-rate summary block, as printed. */
export interface BtwSplitRow {
  /** The rate as printed — 0, 9 or 21 on a Dutch invoice. */
  rate: number
  /** The grondslag: the amount taxed at that rate (the LEFT column). */
  base: number
  /** The btw charged over it (the RIGHT column). */
  btw: number
}

export type BtwSplitVerdict =
  /** btw/excl is exactly a legal NL rate. Two constraints hold — the amounts corroborate each other. */
  | { kind: 'single-rate'; rate: number }
  /**
   * [RIJ-KLOPT-NIET] A per-rate row that contradicts ITSELF: base x rate is not the btw beside it.
   *
   * Such a row is not corroboration, however neatly its columns add up to what we stored. Measured
   * on BALKIP B.V. 264091, whose block prints two rows — 21% over 0,00, and 9% over 1.123,62 giving
   * 101,13. The reader returned ONE row: rate 21 with the 9% row's amounts. Its columns then
   * reproduced our excl and our btw exactly, so it was accepted as a verified blend and the
   * checklist put a green tick beside "Btw-bedrag nagerekend — 21%".
   *
   * 21% of 1.123,62 is 235,96. The row disagreed with its own rate by € 134,83 and nothing looked.
   */
  | { kind: 'row-inconsistent'; rate: number; rows: readonly BtwSplitRow[]; offenders: readonly BtwSplitRow[] }
  /** A blend, and the per-rate block we read adds up to what we stored. */
  | { kind: 'blend-verified'; rate: number; rows: readonly BtwSplitRow[] }
  /** A blend, and nothing to check it against. The rate axis could not run. */
  | { kind: 'blend-unverified'; rate: number }
  /** A per-rate block was read and its columns do NOT match what we stored. */
  | {
      kind: 'blend-mismatch'
      rate: number
      rows: readonly BtwSplitRow[]
      /** Sum of the btw column of the printed block. */
      rowsBtw: number
      /** Sum of the grondslag column. */
      rowsBase: number
      /** Does the grondslag column match the stored excl? Decides how much the block is worth. */
      baseAgrees: boolean
    }
  /** btw/excl is outside 0–21%: no Dutch rate and no blend of them can reach it. */
  | { kind: 'impossible'; rate: number }
  /** There is no base to reason about — nothing this module can say. */
  | { kind: 'no-basis' }

/** Cent-rounding tolerance on a summed comparison. Same value the arithmetic gate uses. */
const SUM_TOLERANCE = 0.02

/** The legal Dutch rates. A single-rate invoice sits exactly on one of them. */
const NL_RATES = [0, 9, 21] as const

/**
 * How far the btw may sit from an exact rate and still count as THAT rate rather than a blend.
 *
 * Expressed in money over the base rather than in percentage points, because a percentage-point
 * tolerance means something different on a € 12 bon than on a € 12.000 wholesale invoice. Half a
 * per mille of the base absorbs per-line rounding (a supplier who rounds each line and then adds
 * up drifts a few cents) while still separating 9% from a 9,4% blend — on a € 1.000 base that is
 * € 0,50 of slack against a € 4,00 difference.
 */
function rateTolerance(base: number): number {
  return Math.max(SUM_TOLERANCE, Math.abs(base) * 0.0005)
}

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** The blended rate in whole percent, the way safecore computes it. */
function impliedRate(btw: number, base: number): number {
  return Math.round(Math.abs(btw / base) * 100)
}

/**
 * Classify what the stored btw is worth as evidence.
 *
 * `rows` is the per-rate summary block if the reader returned one. Absent or empty means the
 * invoice printed none, or we could not read it — both are "nothing to check against", which is a
 * different answer from "checked and fine" and is returned as such.
 */
export function classifyBtwSplit(input: {
  totalExBtw?: number | null
  btwAmount?: number | null
  rows?: readonly BtwSplitRow[] | null
}): BtwSplitVerdict {
  const ex = isNum(input.totalExBtw) ? input.totalExBtw : null
  const btw = isNum(input.btwAmount) ? input.btwAmount : null

  // Without both figures there is no ratio, and the arithmetic row already says the split is
  // missing. A second row repeating it would be noise, not honesty.
  if (ex === null || btw === null) return { kind: 'no-basis' }

  // A btw charged over essentially nothing implies an infinite rate. safecore's creditnota branch
  // already calls this out; saying it here too keeps the checklist from going quiet on it.
  if (Math.abs(ex) < 0.005) {
    return Math.abs(btw) > SUM_TOLERANCE ? { kind: 'impossible', rate: 0 } : { kind: 'no-basis' }
  }

  const rate = impliedRate(btw, ex)

  // ── The printed block, when we have one ──
  const rows = (input.rows ?? []).filter(
    (r): r is BtwSplitRow => !!r && isNum(r.rate) && isNum(r.base) && isNum(r.btw),
  )
  if (rows.length > 0) {
    // [RIJ-KLOPT-NIET] Ask each row about itself BEFORE asking the block about our totals.
    //
    // The column sums are a weak test on their own: any misread that preserves the two totals
    // passes them, and taking a rate from one printed row and the amounts from another is exactly
    // such a misread. A row carries its own second constraint — base x rate = btw — and it is free
    // to check. A row that fails it is not evidence about anything.
    //
    // The 0%-over-0 row every Dutch block prints is consistent by definition (0 x 0% = 0), so this
    // never fires on an empty rate line.
    const offenders = rows.filter((r) => {
      const expected = Math.abs(r.base) * (r.rate / 100)
      return Math.abs(Math.abs(r.btw) - expected) > rateTolerance(r.base)
    })
    if (offenders.length > 0) return { kind: 'row-inconsistent', rate, rows, offenders }

    const rowsBase = round2(rows.reduce((s, r) => s + r.base, 0))
    const rowsBtw = round2(rows.reduce((s, r) => s + r.btw, 0))
    const baseAgrees = Math.abs(rowsBase - ex) <= SUM_TOLERANCE
    const btwAgrees = Math.abs(rowsBtw - btw) <= SUM_TOLERANCE
    if (baseAgrees && btwAgrees) {
      // Both columns of the printed block reproduce what we stored. That is a second, independent
      // reading of the same two numbers — the corroboration a blend otherwise cannot get.
      return { kind: 'blend-verified', rate, rows }
    }
    return { kind: 'blend-mismatch', rate, rows, rowsBtw, rowsBase, baseAgrees }
  }

  // ── No block: the rate is the only thing left to ask ──
  if (rate < 0 || rate > 21) return { kind: 'impossible', rate }

  const tol = rateTolerance(ex)
  for (const r of NL_RATES) {
    if (Math.abs(Math.abs(btw) - Math.abs(ex) * (r / 100)) <= tol) {
      return { kind: 'single-rate', rate: r }
    }
  }
  return { kind: 'blend-unverified', rate }
}

/**
 * Does this verdict mean the stored btw was actually checked against something?
 *
 * The one question the checklist needs answered, kept here so the answer cannot drift between
 * callers. `blend-unverified` is deliberately NOT a pass: nothing was compared.
 */
export function btwSplitCorroborated(v: BtwSplitVerdict): boolean {
  return v.kind === 'single-rate' || v.kind === 'blend-verified'
}

/** € 1.234,56 — the same notation as the screen. */
function eur(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)
}

/**
 * The owner-facing line under the check, or null when a plain tick says everything.
 *
 * Dutch: this is read by the entrepreneur, per the language rule in AGENTS.md.
 */
export function btwSplitDetail(v: BtwSplitVerdict, storedBtw?: number | null): string | null {
  switch (v.kind) {
    case 'single-rate':
      return `${v.rate}% over het hele bedrag`
    case 'blend-verified':
      return `${v.rows.map((r) => `${r.rate}%`).join(' en ')} — de uitsplitsing op de factuur telt hierop op`
    case 'row-inconsistent': {
      // Both numbers, so the owner can settle it against the paper in a glance: what the row says
      // its rate is, and what that rate would actually produce over the amount beside it.
      const r = v.offenders[0]
      const expected = round2(Math.abs(r.base) * (r.rate / 100))
      return (
        `de btw-specificatie op deze factuur lezen wij als ${r.rate}% over ${eur(Math.abs(r.base))}, ` +
        `maar dat zou ${eur(expected)} btw zijn en er staat ${eur(Math.abs(r.btw))}. ` +
        `Kijk even welk tarief er op de factuur staat`
      )
    }
    case 'blend-unverified':
      // The Enka state, said out loud. Never a tick: a blend can be any value between the rates,
      // so the amount was compared with nothing at all.
      return (
        `deze factuur mengt btw-tarieven (samen ${v.rate}%). Het btw-bedrag zelf konden we ` +
        `daardoor niet apart nagaan — vergelijk het even met de btw-specificatie op de factuur`
      )
    case 'blend-mismatch': {
      const printed = `Op de factuur telt de btw-specificatie op tot ${eur(v.rowsBtw)}`
      const stored = isNum(storedBtw) ? `, wij hebben ${eur(storedBtw)} gelezen` : ''
      // When the grondslag column DOES reproduce our excl, the block is corroborated on its own
      // terms and the btw column is the figure to trust. Say so; that is the actionable half.
      const which = v.baseAgrees
        ? `. Het bedrag excl. btw klopt wél met die specificatie, dus ${eur(v.rowsBtw)} is waarschijnlijk de juiste btw`
        : `. Ook het bedrag excl. btw wijkt af van die specificatie (${eur(v.rowsBase)}) — controleer de hele uitsplitsing`
      return `${printed}${stored}${which}.`
    }
    case 'impossible':
      return `een btw-tarief van ${v.rate}% bestaat niet in Nederland — controleer de bedragen`
    case 'no-basis':
      return null
  }
}
