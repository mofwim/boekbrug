'use client'

// src/app/dashboard/DashboardClient.tsx

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { SearchBar } from '@/components/search/SearchBar'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import { InfiniteList } from '@/components/ui/InfiniteList'

export default function DashboardClient({ profile }: { profile: any }) {
  const router = useRouter()
  const supabase = createClient()
  const [clients, setClients] = useState<any[]>([])
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [accountantId, setAccountantId] = useState<string | null>(null)

  // ─── Infinite scroll invoices (BOEK-009) ───────────────
  const {
    invoices,
    loading: invoicesLoading,
    hasMore,
    loadMore,
    updateOptimistic,
    removeOptimistic,
  } = useInfiniteInvoices({ userId: profile.id })

  useEffect(() => {
    async function loadData() {
      if (profile.role === 'accountant') {
        const { data: clientLinks } = await supabase
          .from('accountant_clients')
          .select('zzper_id, profiles!zzper_id(id, full_name, company_name, email, kvk_number)')
          .eq('accountant_id', profile.id)
        if (clientLinks) setClients(clientLinks.map((c: any) => c.profiles))
      }

      if (profile.role === 'zzper') {
        const { data: link } = await supabase
          .from('accountant_clients')
          .select('accountant_id')
          .eq('zzper_id', profile.id)
          .maybeSingle()
        if (link?.accountant_id) setAccountantId(link.accountant_id)
      }

      const { data: notifData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (notifData) setNotifications(notifData)

      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', profile.id)
        .eq('read', false)
      setUnreadMessages(count || 0)
    }
    loadData()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function markAsPaid(invoiceId: string, newStatus: 'paid' | 'sent') {
    // Optimistic update — UI reageert meteen
    updateOptimistic(invoiceId, { status: newStatus })
    await supabase.from('invoices').update({ status: newStatus }).eq('id', invoiceId)
  }

  async function deleteInvoice(invoiceId: string) {
    const confirmed = window.confirm('Weet je zeker dat je deze factuur wilt verwijderen?')
    if (!confirmed) return
    // Optimistic remove
    removeOptimistic(invoiceId)
    await supabase.from('invoice_lines').delete().eq('invoice_id', invoiceId)
    await supabase.from('invoices').delete().eq('id', invoiceId)
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  function handleMessagesClick() {
    if (profile.role === 'zzper') {
      accountantId
        ? router.push(`/dashboard/messages/${accountantId}`)
        : router.push('/dashboard/messages')
    } else {
      router.push('/dashboard/messages')
    }
  }

  const statusLabel: Record<string, string> = {
    draft: 'Concept',
    sent: 'Verzonden',
    paid: 'Betaald',
    overdue: 'Verlopen',
  }

  const statusColor: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-100 text-blue-600',
    paid: 'bg-green-100 text-green-600',
    overdue: 'bg-red-100 text-red-600',
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7]">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">BoekBrug</h1>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{profile.company_name}</span>

            {/* BOEK-012: Full-text search */}
            <SearchBar />

            {/* ── Navigatie links (BOEK-013 / BOEK-010) ── */}
            <button
              onClick={() => router.push('/dashboard/quarterly')}
              className="text-xs text-gray-400 hover:text-gray-600"
              title="Kwartaaloverzicht"
            >
              📊 Kwartaal
            </button>
            <button
              onClick={() => router.push('/dashboard/documents')}
              className="text-xs text-gray-400 hover:text-gray-600"
              title="Documenten"
            >
              📂 Documenten
            </button>

            <button
              onClick={() => router.push('/dashboard/settings')}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ⚙️ Instellingen
            </button>

            {/* BOEK-007: Berichten */}
            <button
              onClick={handleMessagesClick}
              className="relative text-xs text-gray-400 hover:text-blue-600 font-medium transition-colors"
            >
              💬 Berichten
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-2 bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadMessages}
                </span>
              )}
            </button>

            {/* Notificaties */}
            <div className="flex items-center gap-3 relative">
              <button
                onClick={() => {
                  setShowNotifications(!showNotifications)
                  if (!showNotifications && notifications.filter(n => !n.read).length > 0) markAllRead()
                }}
                className="relative text-gray-400 hover:text-gray-600"
              >
                🔔
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute top-8 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 w-80 z-50">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-900">Meldingen</p>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Geen meldingen</p>
                  ) : (
                    <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                      {notifications.map(n => (
                        <div
                          key={n.id}
                          className={`px-4 py-3 ${!n.read ? 'bg-blue-50' : ''}`}
                        >
                          <p className="text-sm text-gray-800">{n.message}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(n.created_at).toLocaleDateString('nl-NL')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

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

        {/* ── ZZP'er Dashboard ── */}
        {profile.role === 'zzper' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Verzonden</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {invoices.filter(i => i.status === 'sent').length}
                </p>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Ontvangen</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  €{invoices
                    .filter(i => i.status === 'paid')
                    .reduce((sum, i) => sum + i.total_inc_btw, 0)
                    .toFixed(0)}
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

            {!accountantId && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-900">Nog geen boekhouder gekoppeld</p>
                  <p className="text-xs text-blue-500 mt-0.5">Koppel een boekhouder om samen te werken</p>
                </div>
                <button
                  onClick={() => router.push('/dashboard/settings')}
                  className="text-xs text-blue-600 font-semibold hover:text-blue-700"
                >
                  Koppelen →
                </button>
              </div>
            )}

            {/* ── Facturen met Infinite Scroll (BOEK-009) ── */}
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

              {invoices.length === 0 && !invoicesLoading ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Nog geen facturen — maak je eerste factuur aan
                </p>
              ) : (
                <div className="divide-y divide-gray-50">
                  <InfiniteList
                    onLoadMore={loadMore}
                    hasMore={hasMore}
                    loading={invoicesLoading}
                  >
                    {invoices.map(invoice => (
                      <div
                        key={invoice.id}
                        onClick={() => router.push(`/dashboard/invoice/${invoice.id}`)}
                        className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {invoice.invoice_number || 'Concept'}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {invoice.client_name} — {invoice.invoice_date}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm font-semibold text-gray-900">
                            €{invoice.total_inc_btw?.toFixed(2)}
                          </p>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[invoice.status] || 'bg-gray-100 text-gray-600'}`}>
                            {statusLabel[invoice.status] || invoice.status}
                          </span>

                          {(invoice.status === 'sent' || invoice.status === 'paid') && (
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                markAsPaid(invoice.id, invoice.status === 'paid' ? 'sent' : 'paid')
                              }}
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                                invoice.status === 'paid'
                                  ? 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
                                  : 'bg-red-50 border-red-200 text-red-500 hover:bg-red-100'
                              }`}
                            >
                              {invoice.status === 'paid' ? '✓ Betaald' : 'Betaald?'}
                            </button>
                          )}

                          {invoice.status === 'draft' && (
                            <button
                              onClick={e => { e.stopPropagation(); deleteInvoice(invoice.id) }}
                              className="text-xs font-medium px-3 py-1.5 rounded-lg border bg-red-50 border-red-200 text-red-400 hover:bg-red-100 transition-colors"
                            >
                              ✕ Verwijderen
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </InfiniteList>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Accountant Dashboard ── */}
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
                  className="bg-purple-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-purple-700 font-medium"
                >
                  + Klant toevoegen
                </button>
              </div>

              {clients.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">
                  Nog geen klanten — voeg je eerste klant toe
                </p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {clients.map((client: any) => (
                    <div
                      key={client.id}
                      onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                      className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer"
                    >
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