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
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

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
  const t = translator(useLocale())
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')

  // Visibility gate — the route is the authority on data completeness,
  // this only hides the obvious non-cases.
  if (NON_EXPORTABLE_STATUS.includes(status)) return null
  if (invoiceType && NON_EXPORTABLE_TYPE.includes(invoiceType)) return null
  // Incoming invoices: the ZZP'er is the buyer, not the seller → no UBL from our side.
  // (Mirrors the route's INCOMING_NOT_SUPPORTED guard; this just hides the dead action.)
  if (direction === 'incoming') return null

  // [SI-UBL] Beide varianten door dezelfde route; peppol=1 vraagt het BIS 3.0-document.
  async function handleExport(peppol = false) {
    setState('loading')
    setError('')
    try {
      const res = await fetch(`/api/export/ubl?invoiceId=${encodeURIComponent(invoiceId)}${peppol ? '&peppol=1' : ''}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(failureText(res.status, json, t('ublx.mislukt')))
      }
      const blob = await res.blob()
      const safePart = (invoiceNumber ?? 'factuur').replace(/[^a-zA-Z0-9_-]/g, '_')
      triggerDownload(blob, `boekbrug-factuur-${safePart}${peppol ? '-peppol' : ''}-ubl.xml`)
      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ublx.onbekend'))
      setState('error')
    }
  }

  const label =
    state === 'loading' ? t('ublx.bezig')
    : state === 'done' ? t('ublx.klaar')
    : `⬇ ${t('ublx.knop')}`

  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleExport(false)}
          disabled={state === 'loading'}
          title={t('ublx.tip')}
          className="text-sm text-[#1967D2] hover:text-[#1967d2] px-3 py-1.5 rounded-xl hover:bg-[#E8F0FE] transition-colors disabled:opacity-50"
        >
          {label}
        </button>
        <button
          onClick={() => handleExport(true)}
          disabled={state === 'loading'}
          title={t('ublx.peppol.tip')}
          className="text-xs text-[#5F6368] hover:text-[#1967d2] px-2 py-1.5 rounded-xl hover:bg-[#E8F0FE] transition-colors disabled:opacity-50"
        >
          {t('ublx.peppol.knop')}
        </button>
      </div>
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