'use client'

// src/app/dashboard/clients/[id]/page.tsx
// BOEK-007: + زر Berichten + feedback تحديث الحالة

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { notFound } from 'next/navigation'
const INVOICE_STATUSES = [
  { value: 'received',   label: 'Ontvangen',      color: 'bg-blue-100 text-blue-700' },
  { value: 'processing', label: 'In behandeling', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'processed',  label: 'Verwerkt',       color: 'bg-green-100 text-green-700' },
  { value: 'unclear',    label: 'Onduidelijk',    color: 'bg-red-100 text-red-700' },
  { value: 'archived',   label: 'Gearchiveerd',   color: 'bg-gray-100 text-gray-600' },
]

function getStatusStyle(status: string) {
  return INVOICE_STATUSES.find(s => s.value === status)?.color || 'bg-gray-100 text-gray-600'
}

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params.id as string
  const supabase = createClient()

  const [client, setClient] = useState<any>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [updatedId, setUpdatedId] = useState<string | null>(null) // feedback بصري

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: clientData } = await supabase
        .from('profiles').select('*').eq('id', clientId).single()

      if (clientData) setClient(clientData)

      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*)')
        .eq('sender_id', clientId)
        .order('invoice_date', { ascending: false })

      if (invoiceData) setInvoices(invoiceData)

      // عدد الرسائل غير المقروءة من هذا العميل
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', clientId)
        .eq('receiver_id', user.id)
        .eq('read', false)

      setUnreadCount(count || 0)
      setLoading(false)
    }
    load()
  }, [clientId])

  async function removeClient() {
    const confirmed = window.confirm(
      `Weet je zeker dat je ${client?.company_name || client?.full_name} wilt verwijderen?`
    )
    if (!confirmed) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('accountant_clients')
      .delete()
      .eq('accountant_id', user.id)
      .eq('zzper_id', clientId)

    router.push('/dashboard')
  }

  async function updateStatus(invoiceId: string, newStatus: string) {
    setUpdatingId(invoiceId)

    const { error } = await supabase
      .from('invoices')
      .update({ status: newStatus })
      .eq('id', invoiceId)

    if (error) {
      setUpdatingId(null)
      return
    }

    setInvoices(prev =>
      prev.map(inv => inv.id === invoiceId ? { ...inv, status: newStatus } : inv)
    )

    // feedback بصري لثانية واحدة
    setUpdatedId(invoiceId)
    setTimeout(() => setUpdatedId(null), 1000)
    setUpdatingId(null)
  }
  if (!clientId) notFound()  

  if (loading) return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ← Terug
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {client?.company_name || client?.full_name}
              </h1>
              <p className="text-xs text-gray-400">{client?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* BOEK-007: Berichten */}
            <button
              onClick={() => router.push(`/dashboard/messages/${clientId}`)}
              className="relative flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-colors"
            >
              💬 Berichten
              {unreadCount > 0 && (
                <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={removeClient}
              className="text-xs text-red-400 hover:text-red-600 font-medium"
            >
              Klant verwijderen
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* Klantgegevens */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Klantgegevens
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-400 text-xs">KVK</p>
              <p className="font-medium text-gray-900">{client?.kvk_number || '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">BTW</p>
              <p className="font-medium text-gray-900">{client?.btw_number || '—'}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">IBAN</p>
              <p className="font-medium text-gray-900">{client?.iban || '—'}</p>
            </div>
          </div>
        </div>

        {/* إحصائيات */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Facturen</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{invoices.length}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Verwerkt</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {invoices.filter(i => i.status === 'processed').length}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Totaal</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              €{invoices.reduce((sum, i) => sum + (i.total_inc_btw || 0), 0).toFixed(0)}
            </p>
          </div>
        </div>

        {/* قائمة الفواتير */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Facturen</h2>
          </div>

          {invoices.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              Nog geen facturen ontvangen
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {invoices.map(invoice => (
                <div
                  key={invoice.id}
                  onClick={() => router.push(`/dashboard/invoice/${invoice.id}`)}
                  className={`flex items-center justify-between px-5 py-4 cursor-pointer transition-colors ${
                    updatedId === invoice.id ? 'bg-green-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {invoice.invoice_number}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {invoice.invoice_date} — vervalt {invoice.due_date}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold text-gray-900">
                      €{invoice.total_inc_btw?.toFixed(2)}
                    </p>
                    <select
                      value={invoice.status}
                      onChange={e => updateStatus(invoice.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      disabled={updatingId === invoice.id}
                      className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer transition-opacity ${
                        updatingId === invoice.id ? 'opacity-40' : 'opacity-100'
                      } ${getStatusStyle(invoice.status)}`}
                    >
                      {INVOICE_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
