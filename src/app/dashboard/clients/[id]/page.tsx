'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'

// حالات الفاتورة المتاحة للمحاسب
const INVOICE_STATUSES = [
  { value: 'received',   label: 'Ontvangen',    color: 'bg-blue-100 text-blue-700' },
  { value: 'processing', label: 'In behandeling', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'processed',  label: 'Verwerkt',      color: 'bg-green-100 text-green-700' },
  { value: 'unclear',    label: 'Onduidelijk',   color: 'bg-red-100 text-red-700' },
  { value: 'archived',   label: 'Gearchiveerd',  color: 'bg-gray-100 text-gray-600' },
]

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params.id as string
  const supabase = createClient()

  const [client, setClient] = useState<any>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      // جلب بيانات العميل
      const { data: clientData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', clientId)
        .single()

      if (clientData) setClient(clientData)

      // جلب فواتير العميل
      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*)')
        .eq('sender_id', clientId)
        .order('invoice_date', { ascending: false })

      if (invoiceData) setInvoices(invoiceData)
      setLoading(false)
    }
    load()
  }, [clientId])

  // تحديث حالة الفاتورة
    async function updateStatus(invoiceId: string, newStatus: string) {
        setUpdatingId(invoiceId)

        const { error } = await supabase
            .from('invoices')
            .update({ status: newStatus })
            .eq('id', invoiceId)

        // أضف هذا للتحقق من الخطأ
        if (error) {
            console.error('Update status error:', error)
            setUpdatingId(null)
            return
        }

        // تحديث الحالة محلياً
        setInvoices(prev =>
            prev.map(inv => inv.id === invoiceId ? { ...inv, status: newStatus } : inv)
        )
        setUpdatingId(null)
    }

  // جلب لون الحالة
  function getStatusStyle(status: string) {
    return INVOICE_STATUSES.find(s => s.value === status)?.color || 'bg-gray-100 text-gray-600'
  }

  // جلب اسم الحالة
  function getStatusLabel(status: string) {
    return INVOICE_STATUSES.find(s => s.value === status)?.label || status
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f2f2f7] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
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
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* بيانات العميل */}
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
                <div key={invoice.id} onClick={() => router.push(`/dashboard/invoice/${invoice.id}`)} className="flex items-center justify-between px-5 py-4">
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
                    {/* dropdown حالة الفاتورة */}
                    <select
                      value={invoice.status}
                      onChange={e => updateStatus(invoice.id, e.target.value)}
                      onClick={e => e.stopPropagation()} // ← أضف هذا من اجل عدم التحويل الى صفحة الفاتورة
                      disabled={updatingId === invoice.id}
                      className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${getStatusStyle(invoice.status)}`}
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