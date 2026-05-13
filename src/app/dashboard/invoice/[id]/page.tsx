'use client'

// src/app/dashboard/invoice/[id]/page.tsx
// BOEK-005: skeleton loading

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, notFound } from 'next/navigation'
import dynamic from 'next/dynamic'
import { InvoicePDF } from '@/lib/invoice-pdf'
import { InvoiceActions } from '@/components/invoice/InvoiceActions'
import { InvoiceDetailSkeleton } from '@/components/ui/Skeletons'

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
)

const statusConfig: Record<string, { label: string; color: string }> = {
  draft:      { label: 'Concept',         color: 'bg-gray-100 text-gray-600' },
  sent:       { label: 'Verzonden',       color: 'bg-blue-100 text-blue-600' },
  paid:       { label: 'Betaald',         color: 'bg-green-100 text-green-600' },
  overdue:    { label: 'Verlopen',        color: 'bg-red-100 text-red-600' },
  received:   { label: 'Ontvangen',       color: 'bg-blue-100 text-blue-700' },
  processing: { label: 'In behandeling',  color: 'bg-yellow-100 text-yellow-700' },
  processed:  { label: 'Verwerkt',        color: 'bg-green-100 text-green-700' },
  unclear:    { label: 'Onduidelijk',     color: 'bg-red-100 text-red-700' },
  archived:   { label: 'Gearchiveerd',    color: 'bg-gray-100 text-gray-500' },
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string
  const supabase = createClient()

  const [invoice, setInvoice] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundState, setNotFoundState] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single()

      if (!invoiceData) {
        setNotFoundState(true)
        setLoading(false)
        return
      }

      setInvoice(invoiceData)

      const [{ data: senderProfile }, { data: linesData }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', invoiceData.sender_id).single(),
        supabase.from('invoice_lines').select('*').eq('invoice_id', invoiceId)
      ])

      if (senderProfile) setProfile(senderProfile)
      if (linesData) setLines(linesData)

      setLoading(false)
    }
    load()
  }, [invoiceId])

  if (notFoundState) notFound()

  const status = invoice
    ? statusConfig[invoice.status] || { label: invoice.status, color: 'bg-gray-100 text-gray-600' }
    : null

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ← Terug
            </button>
            {loading ? (
              <div className="h-4 w-36 bg-gray-100 rounded-full animate-pulse" />
            ) : (
              <h1 className="text-lg font-bold text-gray-900">
                {invoice.invoice_number || 'Concept'}
              </h1>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!loading && status && (
              <>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${status.color}`}>
                  {status.label}
                </span>
                <InvoiceActions
                  invoiceId={invoiceId}
                  invoiceNumber={invoice.invoice_number}
                  status={invoice.status}
                />
                {invoice && profile && (
                  <PDFDownloadLink
                    document={<InvoicePDF invoice={invoice} lines={lines} profile={profile} />}
                    fileName={`${invoice.invoice_number || 'concept'}.pdf`}
                    className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-blue-700 font-medium"
                  >
                    {({ loading: pdfLoading }: { loading: boolean }) =>
                      pdfLoading ? 'Laden...' : '↓ PDF'
                    }
                  </PDFDownloadLink>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <InvoiceDetailSkeleton />
      ) : (
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

          {/* Van / Aan / Factuurdetails */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Van</p>
                <p className="font-semibold text-gray-900">{profile?.company_name || profile?.full_name}</p>
                <p className="text-gray-500">{profile?.address}</p>
                <p className="text-gray-500">{profile?.postal_code} {profile?.city}</p>
                <p className="text-gray-500 mt-1">KVK: {profile?.kvk_number || '—'}</p>
                <p className="text-gray-500">BTW: {profile?.btw_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Aan</p>
                <p className="font-semibold text-gray-900">{invoice?.client_name || '—'}</p>
                <p className="text-gray-500">{invoice?.client_address}</p>
                <p className="text-gray-500">{invoice?.client_postal_code} {invoice?.client_city}</p>
                {invoice?.client_btw_number && (
                  <p className="text-gray-500 mt-1">BTW: {invoice.client_btw_number}</p>
                )}
                <p className="text-gray-500">{invoice?.client_email}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Factuurdetails</p>
                <p className="text-gray-500"><span className="text-gray-400">Nummer:</span> {invoice.invoice_number || '—'}</p>
                <p className="text-gray-500"><span className="text-gray-400">Datum:</span> {invoice.invoice_date}</p>
                <p className="text-gray-500"><span className="text-gray-400">Vervaldatum:</span> {invoice.due_date}</p>
              </div>
            </div>
          </div>

          {/* Factuurregels */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Factuurregels</h2>
            </div>
            <div className="grid grid-cols-12 gap-2 px-5 py-2 text-xs font-medium text-gray-400">
              <div className="col-span-5">Omschrijving</div>
              <div className="col-span-2 text-center">Aantal</div>
              <div className="col-span-2 text-right">Prijs</div>
              <div className="col-span-1 text-center">BTW</div>
              <div className="col-span-2 text-right">Totaal</div>
            </div>
            <div className="divide-y divide-gray-50">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 px-5 py-3 text-sm">
                  <div className="col-span-5 text-gray-900">{line.description}</div>
                  <div className="col-span-2 text-center text-gray-500">{line.quantity}</div>
                  <div className="col-span-2 text-right text-gray-500">€{line.unit_price?.toFixed(2)}</div>
                  <div className="col-span-1 text-center text-gray-500">{line.btw_rate}%</div>
                  <div className="col-span-2 text-right font-medium text-gray-900">€{line.line_total?.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Totalen */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="space-y-2 text-sm max-w-xs ml-auto">
              <div className="flex justify-between text-gray-500">
                <span>Subtotaal excl. BTW</span>
                <span>€{invoice.total_ex_btw?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>BTW</span>
                <span>€{invoice.btw_amount?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
                <span>Totaal incl. BTW</span>
                <span>€{invoice.total_inc_btw?.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Betalingsinformatie */}
          {profile?.iban && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Betalingsinformatie
              </p>
              <p className="text-sm text-gray-600">
                Gelieve te betalen op{' '}
                <span className="font-medium text-gray-900">{profile.iban}</span>{' '}
                o.v.v.{' '}
                <span className="font-medium text-gray-900">{invoice.invoice_number}</span>
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
