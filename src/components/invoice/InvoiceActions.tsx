'use client'

// src/components/invoice/InvoiceActions.tsx
// BOEK-002: Delete | BOEK-003: Duplicate | BOEK-001: Edit (navigatie)
// مكون مشترك — يُستخدم في صفحة تفاصيل الفاتورة

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
// [BOEK-020] UBL export button
import UblExportButton from '@/components/export/UblExportButton'
type Props = {
  invoiceId: string
  invoiceNumber: string
  status: string
  // [BOEK-020] thread direction to hide UBL export on incoming invoices
  direction?: string | null
  // [BETAALVERZOEK] thread the type so the payment-request action shows only on
  // real outgoing facturen (not offertes/creditnota's).
  invoiceType?: string | null
}

// فقط draft يمكن حذفه — Human Control من الوثيقة
const DELETABLE_STATUSES = ['draft']

// [BETAALVERZOEK] Shape returned by POST /api/invoice/[id]/betaalverzoek.
interface Betaalverzoek {
  url: string
  beneficiaryName: string
  iban: string
  amount: number
  reference: string
  epcPayload: string
}
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export function InvoiceActions({ invoiceId, invoiceNumber, status, direction, invoiceType }: Props) {
  const router = useRouter()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [loadingDelete, setLoadingDelete] = useState(false)
  const [error, setError] = useState('')

  // [BETAALVERZOEK] Payment-request modal state.
  const [bv, setBv] = useState<Betaalverzoek | null>(null)
  const [bvLoading, setBvLoading] = useState(false)
  const [bvError, setBvError] = useState('')
  const [bvQr, setBvQr] = useState('')
  const [bvCopied, setBvCopied] = useState('')

  //const canDelete = DELETABLE_STATUSES.includes(status)
const canEdit = status === 'draft'
const canDelete = status === 'draft'
// A betaalverzoek is for an issued, unpaid, OUTGOING factuur.
const canRequestPayment =
  direction !== 'incoming' &&
  (invoiceType == null || invoiceType === 'factuur') &&
  ['sent', 'overdue', 'processing'].includes(status)

  async function openBetaalverzoek() {
    setBvLoading(true); setBvError(''); setBv(null); setBvQr('')
    try {
      const res = await fetch(`/api/invoice/${invoiceId}/betaalverzoek`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setBvError(data.error || 'Betaalverzoek maken mislukt'); setBvLoading(false); return }
      setBv(data)
      setBvLoading(false)
      try {
        // A QR of the pay LINK — scan to OPEN the payment page (handy at a counter).
        const QR = await import('qrcode')
        setBvQr(await QR.toDataURL(data.url, { margin: 1, width: 220 }))
      } catch { /* the link below always works without the QR */ }
    } catch {
      setBvError('Betaalverzoek maken mislukt'); setBvLoading(false)
    }
  }
  async function bvCopy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value) } catch { /* clipboard may be blocked */ }
    setBvCopied(label); setTimeout(() => setBvCopied(''), 1500)
  }


  // ── BOEK-002: Delete ─────────────────────────────────────────────────────
  async function handleDelete() {
    setLoadingDelete(true)
    setError('')

    const res = await fetch(`/api/invoice/${invoiceId}`, { method: 'DELETE' })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Verwijderen mislukt')
      setLoadingDelete(false)
      setShowDeleteConfirm(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <>
      <div className="flex items-center gap-1">

        {/* BOEK-001: Bewerken */}
        {canEdit && (
        <button
          onClick={() => router.push(`/dashboard/invoice/${invoiceId}/edit`)}
          className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors"
        >
          ✎ Bewerken
        </button>
        )}
        {/* BOEK-002: Verwijderen — alleen voor draft */}
        {canDelete && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-sm text-red-400 hover:text-red-600 px-3 py-1.5 rounded-xl hover:bg-red-50 transition-colors"
          >
            ✕ Verwijderen
          </button>
        )}
        {/* [BETAALVERZOEK] Deel een betaallink — alleen voor een verstuurde uitgaande factuur */}
        {canRequestPayment && (
          <button
            onClick={openBetaalverzoek}
            disabled={bvLoading}
            className="text-sm text-[#1a73e8] hover:text-[#0051d5] px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {bvLoading ? 'Bezig…' : '💶 Betaalverzoek'}
          </button>
        )}
        {/* [BOEK-020] UBL/XML export — single invoice (hides itself for draft/incoming) */}
        <UblExportButton invoiceId={invoiceId} invoiceNumber={invoiceNumber} status={status} direction={direction} />
      </div>

      {bvError && <p className="text-xs text-red-500 mt-1">{bvError}</p>}

      {/* Foutmelding */}
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}

      {/* Delete Confirm Modal — rendered via portal to escape sticky header stacking context */}
      {showDeleteConfirm && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-gray-900">Factuur verwijderen?</h2>
              <p className="text-sm text-gray-500">
                Je staat op het punt factuur{' '}
                <span className="font-semibold text-gray-800">{invoiceNumber}</span>{' '}
                permanent te verwijderen. Dit kan niet ongedaan worden gemaakt.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={loadingDelete}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-50"
              >
                {loadingDelete ? 'Verwijderen...' : 'Ja, verwijderen'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loadingDelete}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* [BETAALVERZOEK] Share modal — the link (+ QR of the link) and payment summary */}
      {bv && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={() => setBv(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 className="text-base font-bold text-gray-900">Betaalverzoek voor {invoiceNumber}</h2>
              <p className="text-sm text-gray-500 mt-1">
                Deel deze link met je klant. Ze betalen {eur.format(bv.amount)} rechtstreeks vanuit hun eigen bank —
                met kenmerk <span className="font-semibold text-gray-700">{bv.reference || '—'}</span>. Zodra de
                betaling in je bankafschrift binnenkomt, herkent BoekBrug haar automatisch bij deze factuur en
                bevestig je het afletteren met één tik.
              </p>
            </div>

            {bvQr && (
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bvQr} alt="QR naar betaalpagina" width={180} height={180} className="rounded-xl" />
              </div>
            )}

            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-2">
              <input readOnly value={bv.url} className="flex-1 bg-transparent text-sm text-gray-700 px-2 outline-none" onFocus={(e) => e.currentTarget.select()} />
              <button
                onClick={() => bvCopy(bv.url, 'link')}
                className="shrink-0 bg-[#1a73e8] hover:bg-[#0051d5] text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                {bvCopied === 'link' ? 'Gekopieerd' : 'Kopieer link'}
              </button>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              BoekBrug verwerkt de betaling niet — het geld gaat direct naar je eigen IBAN ({bv.iban.replace(/(.{4})/g, '$1 ').trim()}).
            </p>

            <button onClick={() => setBv(null)} className="w-full border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
              Sluiten
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}