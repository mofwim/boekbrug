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