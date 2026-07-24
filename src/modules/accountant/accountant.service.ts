// src/modules/accountant/accountant.service.ts
// [BOEK-028] Accountant Portal — business logic — May 2026
// Pure functions only — no DB, no Supabase, no side effects.
// Repository calls these; pages/components call repository.

import type { QuarterRange } from './accountant.types'

// ─────────────────────────────────────────────────────────
// [READINESS] The old computeClientStatus (klaar/bijna_klaar/wacht) was removed.
// It could assert a false "klaar" (ready) — it counted only PAID invoices, ignored
// unpaid sent/received receivables, treated any single bank file as full coverage,
// and used doc_type='bank' which no write path ever stores. In a financial-truth
// app a false "ready" is the cardinal sin, so readiness is now reported as honest
// facts (ClientReadiness), computed in accountant.repository.ts, not a verdict here.
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// Quarter helpers
// ─────────────────────────────────────────────────────────

/**
 * Returns the current quarter based on today's date.
 * Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec
 */
export function getCurrentQuarter(): { year: number; quarter: number } {
  const now = new Date()
  const month = now.getMonth() + 1  // 1-based
  const year = now.getFullYear()
  const quarter = Math.ceil(month / 3)
  return { year, quarter }
}

/**
 * Returns inclusive start and end dates for a given quarter.
 *
 * @example getQuarterRange(2026, 2) → { start: '2026-04-01', end: '2026-06-30' }
 */
export function getQuarterRange(year: number, quarter: number): QuarterRange {
  const startMonths: Record<number, number> = { 1: 1, 2: 4, 3: 7, 4: 10 }
  const endMonths: Record<number, number>   = { 1: 3, 2: 6, 3: 9, 4: 12 }

  const startMonth = startMonths[quarter]
  const endMonth   = endMonths[quarter]

  // Last day of end month — using day 0 of next month trick
  const lastDay = new Date(year, endMonth, 0).getDate()

  const pad = (n: number) => String(n).padStart(2, '0')

  return {
    start: `${year}-${pad(startMonth)}-01`,
    end:   `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  }
}

/**
 * Returns the Dutch label for a quarter number.
 * @example quarterLabel(2) → 'Q2 2026'
 */
export function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`
}

// ─────────────────────────────────────────────────────────
// [AANGIFTE-AGENDA] BTW filing deadlines
// ─────────────────────────────────────────────────────────
// The Belastingdienst deadline for a quarterly BTW-aangifte is the LAST day of
// the month AFTER the quarter ends. This is the same rule the closing package
// already assumes ("aangifte deadline is the month after"):
//   Q1 (Jan–Mar) → 30 apr    Q2 (Apr–Jun) → 31 jul
//   Q3 (Jul–Sep) → 31 okt    Q4 (Oct–Dec) → 31 jan (next year)

/**
 * Returns the previous quarter (wrapping the year at Q1).
 * @example getPreviousQuarter(2026, 1) → { year: 2025, quarter: 4 }
 */
export function getPreviousQuarter(
  year: number,
  quarter: number,
): { year: number; quarter: number } {
  if (quarter === 1) return { year: year - 1, quarter: 4 }
  return { year, quarter: quarter - 1 }
}

/**
 * BTW-aangifte deadline (ISO date, inclusive) for a filed quarter.
 * @example getAangifteDeadline(2026, 2) → '2026-07-31'
 */
export function getAangifteDeadline(year: number, quarter: number): string {
  const endMonths: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 }
  let deadlineMonth = endMonths[quarter] + 1 // month after the quarter ends
  let deadlineYear = year
  if (deadlineMonth > 12) {
    deadlineMonth = 1
    deadlineYear = year + 1
  }
  // Last day of the deadline month (day 0 of the next month).
  const lastDay = new Date(deadlineYear, deadlineMonth, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${deadlineYear}-${pad(deadlineMonth)}-${pad(lastDay)}`
}

/**
 * Whole days from today (local, midnight) until an ISO date.
 * Positive = still to come, 0 = today, negative = overdue.
 * @example daysUntil('2026-07-31')  // on 2026-07-24 → 7
 */
export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/**
 * The BTW-aangifte the accountant is filing right now: the quarter that just
 * ended (previous quarter) plus its deadline and days remaining. Its deadline
 * can be in the future (urgent) or already passed (overdue) — the caller colours
 * accordingly. This is the single period the whole agenda is scoped to.
 */
export function getActiveAangifte(): {
  year: number
  quarter: number
  deadline: string
  daysUntilDeadline: number
} {
  const now = getCurrentQuarter()
  const { year, quarter } = getPreviousQuarter(now.year, now.quarter)
  const deadline = getAangifteDeadline(year, quarter)
  return { year, quarter, deadline, daysUntilDeadline: daysUntil(deadline) }
}