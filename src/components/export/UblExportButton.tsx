'use client'

// src/components/export/UblExportButton.tsx
// [BOEK-020] UBL 2.1 export button — single invoice — June 2026
//
// Standalone, self-contained. Mounts on the invoice detail page
// (e.g. inside InvoiceActions' button row — see patch note).
// Calls GET /api/export/ubl?invoiceId= and downloads the XML file.
// Surfaces the Dutch 422 message inline (missing KVK/BTW, no lines, no number).
//
// Ownership: BOEK-020. Does not modify InvoiceRow / InvoiceActions directly.

import { useState } from 'react'

type Props = {
  invoiceId: string
  invoiceNumber?: string | null
  status: string
  /** Optional — used to hide the button for non-invoice documents. */
  invoiceType?: string | null
  /** Optional — UBL export only applies to outgoing invoices (seller = us). */
  direction?: string | null
}

// UBL export is meaningless for concept invoices (no legal number yet)
// and for quotes / pro-forma (not real invoices).
const NON_EXPORTABLE_STATUS = ['draft']
const NON_EXPORTABLE_TYPE = ['offerte', 'pro_forma']

type State = 'idle' | 'loading' | 'done' | 'error'

export function UblExportButton({ invoiceId, invoiceNumber, status, invoiceType, direction }: Props) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')

  // Visibility gate — the route is the authority on data completeness,
  // this only hides the obvious non-cases.
  if (NON_EXPORTABLE_STATUS.includes(status)) return null
  if (invoiceType && NON_EXPORTABLE_TYPE.includes(invoiceType)) return null
  // Incoming invoices: the ZZP'er is the buyer, not the seller → no UBL from our side.
  // (Mirrors the route's INCOMING_NOT_SUPPORTED guard; this just hides the dead action.)
  if (direction === 'incoming') return null

  async function handleExport() {
    setState('loading')
    setError('')
    try {
      const res = await fetch(`/api/export/ubl?invoiceId=${encodeURIComponent(invoiceId)}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'UBL exporteren mislukt')
      }
      const blob = await res.blob()
      const safePart = (invoiceNumber ?? 'factuur').replace(/[^a-zA-Z0-9_-]/g, '_')
      triggerDownload(blob, `boekbrug-factuur-${safePart}-ubl.xml`)
      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
      setState('error')
    }
  }

  const label =
    state === 'loading' ? 'Bezig...'
    : state === 'done' ? 'Gedownload ✓'
    : '⬇ UBL exporteren'

  return (
    <div className="flex flex-col items-start">
      <button
        onClick={handleExport}
        disabled={state === 'loading'}
        title="Exporteer als UBL 2.1 (e-factuur) voor je boekhoudprogramma"
        className="text-sm text-[#1967D2] hover:text-[#174EA6] px-3 py-1.5 rounded-xl hover:bg-[#E8F0FE] transition-colors disabled:opacity-50"
      >
        {label}
      </button>
      {state === 'error' && error && (
        <p className="text-xs text-red-500 mt-1 max-w-xs">{error}</p>
      )}
    </div>
  )
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default UblExportButton