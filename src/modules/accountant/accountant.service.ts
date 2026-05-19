// src/modules/accountant/accountant.service.ts
// [BOEK-028] Accountant Portal — business logic — May 2026
// Pure functions only — no DB, no Supabase, no side effects.
// Repository calls these; pages/components call repository.

import type { ClientStatus, QuarterRange } from './accountant.types'

// ─────────────────────────────────────────────────────────
// Client status
// ─────────────────────────────────────────────────────────

interface ComputeClientStatusParams {
  /** Does the client have a bank file for the current quarter? */
  hasBank: boolean
  /** Total paid invoices in the current quarter */
  totalInvoices: number
  /** Invoices with accountant_status = 'verwerkt' */
  processedInvoices: number
  /** Days since last document upload — null if never uploaded */
  lastUploadDaysAgo: number | null
}

/**
 * Computes client readiness for the current quarter.
 * Never stored — always derived from live data.
 *
 * klaar       = bank file present + all invoices processed + at least 1 invoice
 * bijna_klaar = bank file present OR some invoices processed (but not all)
 * wacht       = no bank file AND no upload in >21 days, OR never uploaded
 */
export function computeClientStatus(params: ComputeClientStatusParams): ClientStatus {
  const { hasBank, totalInvoices, processedInvoices, lastUploadDaysAgo } = params

  const allProcessed = totalInvoices > 0 && processedInvoices === totalInvoices
  const neverUploaded = lastUploadDaysAgo === null
  const uploadStale = neverUploaded || lastUploadDaysAgo > 21

  if (hasBank && allProcessed) return 'klaar'
  if (!hasBank && uploadStale) return 'wacht'
  return 'bijna_klaar'
}

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