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
}

// فقط draft يمكن حذفه — Human Control من الوثيقة
const DELETABLE_STATUSES = ['draft']

export function InvoiceActions({ invoiceId, invoiceNumber, status }: Props) {
  const router = useRouter()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [loadingDelete, setLoadingDelete] = useState(false)
  const [error, setError] = useState('')

  //const canDelete = DELETABLE_STATUSES.includes(status)
const canEdit = status === 'draft'
const canDelete = status === 'draft'


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
        )}{/* [BOEK-020] UBL/XML export — single invoice (hides itself for draft) */}
        <UblExportButton invoiceId={invoiceId} invoiceNumber={invoiceNumber} status={status} />
      </div>

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
    </>
  )
}