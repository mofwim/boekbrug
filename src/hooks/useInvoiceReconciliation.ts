'use client'

// src/hooks/useInvoiceReconciliation.ts
// [BANK-RECON-BADGE] Fetch the per-invoice reconciliation map (linked / pendingMatch)
// once and hand it to any invoice list. Read-only; a failure just yields no badges (the
// lists render exactly as before). Keyed by invoice id — look up `byInvoice[invoice.id]`.

import { useEffect, useState } from 'react'
import type { InvoiceRecon } from '@/lib/bank-reconciliation'

export function useInvoiceReconciliation(enabled: boolean = true): {
  byInvoice: Record<string, InvoiceRecon>
  loaded: boolean
} {
  const [byInvoice, setByInvoice] = useState<Record<string, InvoiceRecon>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/bank/reconciliation')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && json?.byInvoice) setByInvoice(json.byInvoice as Record<string, InvoiceRecon>)
      } catch {
        // Silent: no badges is an acceptable degraded state, never a broken list.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [enabled])

  return { byInvoice, loaded }
}
