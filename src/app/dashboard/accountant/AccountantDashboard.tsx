'use client'

// src/app/dashboard/accountant/AccountantDashboard.tsx
// كل ما يخص المحاسب — state + logic + UI

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'
import { DashboardHeader, InvoiceTable } from '../_shared'

export function AccountantDashboard({ profile }: { profile: any }) {
  const router = useRouter()
  const supabase = createClient()

  // ── State ──────────────────────────────────────────────────────────────────
  const [clients, setClients] = useState<any[]>([])
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('all')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const clientIds = clients.map((c: any) => c.id)

  const {
    invoices,
    loading: invoicesLoading,
    hasMore,
    refreshing,
    loadMore,
    refresh,
    updateOptimistic,
    removeOptimistic,
  } = useInfiniteInvoices({
    userId: profile.id,
    status: statusFilter,
    clientIds,
  })

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      // Clients
      const { data: clientLinks } = await supabase
        .from('accountant_clients')
        .select('zzper_id, profiles!zzper_id(id, full_name, company_name, email, kvk_number)')
        .eq('accountant_id', profile.id)
      if (clientLinks) setClients(clientLinks.map((c: any) => c.profiles))

      // Notifications
      const { data: notifData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (notifData) setNotifications(notifData)

      // Unread messages
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', profile.id)
        .eq('read', false)
      setUnreadMessages(count || 0)
    }
    loadData()
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function markAsPaid(invoiceId: string, newStatus: 'paid' | 'sent') {
    updateOptimistic(invoiceId, { status: newStatus })
    await supabase
      .from('invoices')
      .update({ status: newStatus })
      .eq('id', invoiceId)
  }

  async function deleteInvoice(invoiceId: string) {
    const confirmed = window.confirm('Weet je zeker dat je deze factuur wilt verwijderen?')
    if (!confirmed) return
    removeOptimistic(invoiceId)
    await supabase.from('invoice_lines').delete().eq('invoice_id', invoiceId)
    await supabase.from('invoices').delete().eq('id', invoiceId)
  }

  async function resendInvoice(e: React.MouseEvent, invoiceId: string) {
    e.stopPropagation()
    setResendingId(invoiceId)
    try {
      await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      })
    } finally {
      setResendingId(null)
    }
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const unreadNotifCount = notifications.filter(n => !n.read).length

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>

      <DashboardHeader
        profile={profile}
        notifications={notifications}
        showNotifications={showNotifications}
        unreadNotifCount={unreadNotifCount}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => {
          setShowNotifications(prev => !prev)
          if (!showNotifications && unreadNotifCount > 0) markAllRead()
        }}
        onMessagesClick={() => router.push('/dashboard/messages')}
        onLogout={handleLogout}
      />

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="stat-card">
            <p className="stat-label">Klanten</p>
            <p className="stat-value">{clients.length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Facturen klanten</p>
            <p className="stat-value">{invoices.length}</p>
          </div>
        </div>

        {/* Clients list */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-separator)' }}>
            <h2 className="text-h3">Mijn klanten</h2>
            <button
              onClick={() => router.push('/dashboard/clients/invite')}
              className="bg-[#af52de] text-white text-sm px-4 py-2 hover:opacity-90"
            >
              + Klant toevoegen
            </button>
          </div>

          {clients.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>
              Nog geen klanten — voeg je eerste klant toe
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-separator)' }}>
              {clients.map((client: any) => (
                <div
                  key={client.id}
                  onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {client.company_name || client.full_name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {client.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {client.kvk_number && (
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        KVK: {client.kvk_number}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-[#007aff]">Bekijken →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Client invoices */}
        {clients.length > 0 && (
          <InvoiceTable
            invoices={invoices}
            loading={invoicesLoading}
            hasMore={hasMore}
            refreshing={refreshing}
            statusFilter={statusFilter}
            onFilterChange={setStatusFilter}
            onLoadMore={loadMore}
            onRefresh={refresh}
            onMarkPaid={markAsPaid}
            onResend={resendInvoice}
            onDelete={deleteInvoice}
            resendingId={resendingId}
            onNavigate={id => router.push(`/dashboard/invoice/${id}`)}
            title="Facturen klanten"
          />
        )}

      </main>
    </div>
  )
}