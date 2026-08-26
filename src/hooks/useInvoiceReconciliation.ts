'use client'

// src/hooks/useInvoiceReconciliation.ts
// [BANK-RECON-BADGE] Fetch the per-invoice reconciliation map (linked / pendingMatch)
// once and hand it to any invoice list. Read-only display; a failure just yields no badges
// (the lists render exactly as before). Keyed by invoice id — look up `byInvoice[invoice.id]`.
//
// [BANK-RECON-CONFIRM] `confirmMatch(invoiceId)` turns the "Betaling gevonden" chip into a REAL
// action instead of a dead navigation:
//   - a SAFE match (reference-backed, isSafeAutoConfirm-grade) is booked in one tap through the
//     same fully-guarded /api/bank/confirm route the bank page uses, then the badge flips to
//     "In bankafschrift" optimistically → returns 'ok'.
//   - an UNSAFE (amount-only) match is never booked from a list — booking it blindly could pay the
//     wrong same-amount invoice — so it returns 'navigate' and the caller opens the bank page where
//     the owner sees full context (counterpart, date, other candidates) before confirming.
//   - no pending match / a failed write → 'navigate' / 'error'.

import { useCallback, useEffect, useState } from 'react'
import type { InvoiceRecon } from '@/lib/bank-reconciliation'

// [CIRKEL] 'navigate' carries the transaction id when the map has one, so the caller can land
// ON THE LINE (/dashboard/bank/verdelen/{txId}) instead of on top of a quarter-filtered list
// that may not even contain it. txId null = no pending match known → the bare bank page.
export type ConfirmMatchResult = 'ok' | 'error' | { navigate: true; txId: string | null }

// [MATCH-BUTTON] `applyMap` lets a caller that ALREADY holds a fresh map install it directly —
// POST /api/reconcile/run returns the map from the same builder this hook fetches, so re-fetching
// it would be a second round trip that can only disagree with what the run just reported.
export function useInvoiceReconciliation(enabled: boolean = true): {
  byInvoice: Record<string, InvoiceRecon>
  loaded: boolean
  confirmMatch: (invoiceId: string) => Promise<ConfirmMatchResult>
  refetch: () => void
  applyMap: (map: Record<string, InvoiceRecon>) => void
  /** [CIRKEL] Ambiguous matches waiting on the bank page — the count was in the SAME response
   *  this hook already fetched and was discarded; a standing line beats a post-run sheet that
   *  vanishes on close. */
  pendingMatchCount: number
} {
  const [byInvoice, setByInvoice] = useState<Record<string, InvoiceRecon>>({})
  const [pendingMatchCount, setPendingMatchCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/bank/reconciliation')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && json?.byInvoice) setByInvoice(json.byInvoice as Record<string, InvoiceRecon>)
        if (!cancelled && typeof json?.pendingMatchCount === 'number') setPendingMatchCount(json.pendingMatchCount)
      } catch {
        // Silent: no badges is an acceptable degraded state, never a broken list.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [enabled, reloadTick])

  const refetch = useCallback(() => setReloadTick((t) => t + 1), [])

  // [CIRKEL-P2] The bank page re-asks its matcher on tab return; the invoice side of the circle
  // must not stay the stale half. Read-only fetch, silent on failure — same contract as mount.
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => { if (document.visibilityState === 'visible') setReloadTick((t) => t + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled])

  // Replace the whole map (not a merge): the run's map is the complete post-engine truth, and a
  // merge would keep stale "betaling gevonden" chips for matches the run just booked or invalidated.
  const applyMap = useCallback((map: Record<string, InvoiceRecon>) => {
    setByInvoice(map)
    // [CIRKEL-C4] The standing line's whole point is being CURRENT: after a run booked
    // everything, "4 betalingen wachten" pointing at an empty tab is worse than the sheet that
    // at least disappeared. The map is the truth the count derives from — derive it.
    setPendingMatchCount(Object.values(map).filter((r) => r.pendingMatch).length)
    setLoaded(true)
  }, [])

  const confirmMatch = useCallback(async (invoiceId: string): Promise<ConfirmMatchResult> => {
    const pending = byInvoice[invoiceId]?.pendingMatch
    // No confident match, or an amount-only one → the owner must decide on the bank page —
    // and lands on the specific LINE when we know which one ([CIRKEL]: the id was always in
    // this variable and was thrown away one line later).
    if (!pending || !pending.safe) return { navigate: true, txId: pending?.transactionId ?? null }
    try {
      const res = await fetch('/api/bank/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: pending.transactionId, invoiceId }),
      })
      if (!res.ok) {
        // The server auto-confirm may have booked this invoice already (409 invoice_already_paid).
        // The desired end-state already holds, so treat it as success — never a false "mislukt".
        const err = await res.json().catch(() => ({}))
        if (res.status === 409 && err?.error === 'invoice_already_paid') {
          setByInvoice((m) => ({ ...m, [invoiceId]: { linked: true, pendingMatch: null } }))
          setPendingMatchCount((n) => Math.max(0, n - 1))
          return 'ok'
        }
        return 'error'
      }
      // Optimistic: the payment is now in the statement for this invoice.
      setByInvoice((m) => ({ ...m, [invoiceId]: { linked: true, pendingMatch: null } }))
      setPendingMatchCount((n) => Math.max(0, n - 1))
      return 'ok'
    } catch {
      return 'error'
    }
  }, [byInvoice])

  return { byInvoice, loaded, confirmMatch, refetch, applyMap, pendingMatchCount }
}
