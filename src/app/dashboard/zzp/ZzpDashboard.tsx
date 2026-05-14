'use client'

// src/app/dashboard/zzp/ZzpDashboard.tsx
// كل ما يخص الـ ZZP'er — state + logic + UI

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'
import { isOverdue } from '@/components/invoice/InvoiceRow'
import { DashboardHeader, InvoiceTable } from '../_shared'

export function ZzpDashboard({ profile }: { profile: any }) {
  const router = useRouter()
  const supabase = createClient()

  // ── State ──────────────────────────────────────────────────────────────────
  const [accountantId, setAccountantId] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('all')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const {
    invoices,
    loading: invoicesLoading,
    hasMore,
    refreshing,
    loadMore,
    refresh,
    updateOptimistic,
    removeOptimistic,
  } = useInfiniteInvoices({ userId: profile.id, status: statusFilter })

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      // Accountant link
      const { data: link } = await supabase
        .from('accountant_clients')
        .select('accountant_id')
        .eq('zzper_id', profile.id)
        .maybeSingle()
      if (link?.accountant_id) setAccountantId(link.accountant_id)

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
    const { error } = await supabase
      .from('invoices')
      .update({ status: newStatus })
      .eq('id', invoiceId)

    if (!error && newStatus === 'paid') {
      await supabase.from('notifications').insert({
        user_id: profile.id,
        title: 'Factuur betaald',
        body: 'Een factuur is gemarkeerd als betaald.',
        type: 'payment',
        read: false,
      })
    }
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

  function handleMessagesClick() {
    accountantId
      ? router.push(`/dashboard/messages/${accountantId}`)
      : router.push('/dashboard/messages')
  }

  // Openstaand = sent + overdue only — draft excluded
  const openstaandTotal = invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue' || isOverdue(i))
    .reduce((sum, i) => sum + (i.total_inc_btw || 0), 0)

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
        onMessagesClick={handleMessagesClick}
        onLogout={handleLogout}
      />

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="stat-card">
            <p className="stat-label">Verzonden</p>
            <p className="stat-value">{invoices.filter(i => i.status === 'sent').length}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Ontvangen</p>
            <p className="stat-value">
              €{invoices
                .filter(i => i.status === 'paid')
                .reduce((sum, i) => sum + (i.total_inc_btw || 0), 0)
                .toFixed(0)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Openstaand</p>
            <p className="stat-value text-[#ff9500]">€{openstaandTotal.toFixed(0)}</p>
          </div>
        </div>

        {/* No accountant banner */}
        {!accountantId && (
          <div className="bg-[#e8f1ff] border border-[#bfdbfe] rounded-2xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1e40af]">Nog geen boekhouder gekoppeld</p>
              <p className="text-xs text-[#3b82f6] mt-0.5">Koppel een boekhouder om samen te werken</p>
            </div>
            <button
              onClick={() => router.push('/dashboard/settings')}
              className="text-xs text-[#1d4ed8] font-bold hover:text-[#1e40af]"
              style={{ background: 'none', border: 'none' }}
            >
              Koppelen →
            </button>
          </div>
        )}

        {/* Invoice table */}
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
          onNewInvoice={() => router.push('/dashboard/invoice/new')}
          showNewButton
        />

      </main>
    </div>
  )
}