'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Invoice = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  total_inc_btw: number
  status: string
}

export default function DashboardClient({ profile }: { profile: any }) {
  const router = useRouter()
  const supabase = createClient()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clients, setClients] = useState<any[]>([]) // حالة العملاء
  useEffect(() => {
    async function loadInvoices() {
      // جلب عملاء المحاسب
    if (profile.role === 'accountant') {
      const { data: clientLinks } = await supabase
        .from('accountant_clients')
        .select('zzper_id, profiles!zzper_id(id, full_name, company_name, email, kvk_number)')
        .eq('accountant_id', profile.id)

      if (clientLinks) {
        const clientProfiles = clientLinks.map((c: any) => c.profiles)
        setClients(clientProfiles)
      }
    }
      const { data } = await supabase
        .from('invoices')
        .select('*')
        .eq('sender_id', profile.id)
        .order('created_at', { ascending: false })

      if (data) setInvoices(data)
    }
    loadInvoices()
  }, [])

    // تسجيل الخروج
  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  } 

  const statusLabel: Record<string, string> = {
    draft: 'Concept',
    sent: 'Verzonden',
    paid: 'Betaald',
    overdue: 'Verlopen'
  }

  const statusColor: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-100 text-blue-600',
    paid: 'bg-green-100 text-green-600',
    overdue: 'bg-red-100 text-red-600'
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">BoekBrug</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{profile.company_name}</span>
            <button
                onClick={() => router.push('/dashboard/settings')}
                className="text-xs text-gray-400 hover:text-gray-600"
            >
                ⚙️ Instellingen
            </button>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              profile.role === 'accountant'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {profile.role === 'accountant' ? 'Boekhouder' : "ZZP'er"}
            </span>
            <button
                onClick={handleLogout}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Uitloggen
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* ZZP'er Dashboard */}
        {profile.role === 'zzper' && (
          <div className="space-y-4">

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Verzonden</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{invoices.length}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Betaald</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {invoices.filter(i => i.status === 'paid').length}
                </p>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Openstaand</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  €{invoices
                    .filter(i => i.status !== 'paid')
                    .reduce((sum, i) => sum + i.total_inc_btw, 0)
                    .toFixed(0)}
                </p>
              </div>
            </div>

            {/* Facturen lijst */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Facturen</h2>
                <button
                  onClick={() => router.push('/dashboard/invoice/new')}
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-blue-700 font-medium"
                >
                  + Nieuwe factuur
                </button>
              </div>

              {invoices.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Nog geen facturen — maak je eerste factuur aan
                </p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {invoices.map(invoice => (
                    <div key={invoice.id} onClick={() => router.push(`/dashboard/invoice/${invoice.id}`)} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{invoice.invoice_number}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{invoice.invoice_date}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-semibold text-gray-900">
                          €{invoice.total_inc_btw?.toFixed(2)}
                        </p>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[invoice.status]}`}>
                          {statusLabel[invoice.status]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Accountant Dashboard */}
        {profile.role === 'accountant' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Klanten</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{clients.length}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Nieuwe facturen</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">0</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Mijn klanten</h2>
                <button 
                  onClick={() => router.push('/dashboard/clients/invite')}
                  className="bg-purple-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-purple-700 font-medium">
                    + Klant toevoegen
                </button>
              </div>

              {clients.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Nog geen klanten — voeg je eerste klant toe
                </p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {clients.map((client: any) => ( // function onClick to direct to client page
                    <div key={client.id} onClick={() => router.push(`/dashboard/clients/${client.id}`)} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {client.company_name || client.full_name}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{client.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {client.kvk_number && (
                          <span className="text-xs text-gray-400">KVK: {client.kvk_number}</span>
                        )}
                        <span className="text-blue-600 text-xs font-medium">Bekijken →</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}