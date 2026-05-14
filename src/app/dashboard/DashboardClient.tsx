'use client'

// src/app/dashboard/DashboardClient.tsx

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { SearchBar } from '@/components/search/SearchBar'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'
import { InfiniteList } from '@/components/ui/InfiniteList'
import { StatusFilter } from '@/components/ui/StatusFilter'
import { InvoiceRowItem, STATUS_LABEL, isOverdue } from '@/components/invoice/InvoiceRow'

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardClient({ profile }: { profile: any }) {
  const router = useRouter()
  const supabase = createClient()
  const [clients, setClients] = useState<any[]>([])
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [accountantId, setAccountantId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('all')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const clientIds =
    profile.role === 'accountant'
      ? clients.map((c: any) => c.id)
      : undefined

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

  // ── Helpers ───────────────────────────────────────────────────────────────

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
    if (profile.role === 'zzper') {
      accountantId
        ? router.push(`/dashboard/messages/${accountantId}`)
        : router.push('/dashboard/messages')
    } else {
      router.push('/dashboard/messages')
    }
  }

  // Openstaand = sent + overdue only — draft excluded
  const openstaandTotal = invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue' || isOverdue(i))
    .reduce((sum, i) => sum + (i.total_inc_btw || 0), 0)

  const unreadNotifCount = notifications.filter(n => !n.read).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>

      {/* ── Header ── */}
      <header className="bg-white border-b sticky top-0 z-20" style={{ borderColor: 'var(--color-separator)' }}>
        <div className="max-w-4xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">

          {/* Logo */}
          <h1 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
            BoekBrug
          </h1>

          {/* Nav */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-sm mr-2" style={{ color: 'var(--color-text-secondary)' }}>
              {profile.company_name}
            </span>

            <SearchBar />

            <NavButton onClick={() => router.push('/dashboard/quarterly')} label="📊 Kwartaal" />
            <NavButton onClick={() => router.push('/dashboard/documents')} label="📂 Documenten" />
            <NavButton onClick={() => router.push('/dashboard/settings')} label="⚙️" />

            {/* Messages */}
            <div className="relative">
              <NavButton onClick={handleMessagesClick} label="💬" />
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#007aff] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                  {unreadMessages}
                </span>
              )}
            </div>

            {/* Notifications */}
            <div className="relative">
              <NavButton
                onClick={() => {
                  setShowNotifications(prev => !prev)
                  if (!showNotifications && unreadNotifCount > 0) markAllRead()
                }}
                label="🔔"
              />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#ff3b30] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                  {unreadNotifCount}
                </span>
              )}

              {showNotifications && (
                <div className="absolute top-9 right-0 bg-white rounded-2xl shadow-xl border w-80 z-50 animate-fade-in overflow-hidden"
                  style={{ borderColor: 'var(--color-separator)', boxShadow: 'var(--shadow-modal)' }}>
                  <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-separator)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Meldingen</p>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>Geen meldingen</p>
                  ) : (
                    <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: 'var(--color-separator)' }}>
                      {notifications.map(n => (
                        <div
                          key={n.id}
                          onClick={() => n.link && router.push(n.link)}
                          className={`px-4 py-3 transition-colors ${!n.read ? 'bg-[#e8f1ff]' : ''} ${n.link ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                        >
                          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{n.title}</p>
                          {n.body && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{n.body}</p>}
                          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                            {new Date(n.created_at).toLocaleDateString('nl-NL')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Role badge */}
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
              profile.role === 'accountant'
                ? 'bg-[#f5f0ff] text-[#7c3aed]'
                : 'bg-[#e8f1ff] text-[#1d4ed8]'
            }`}>
              {profile.role === 'accountant' ? 'Boekhouder' : "ZZP'er"}
            </span>

            <button
              onClick={handleLogout}
              className="text-xs px-2 py-1 hover:text-[#ff3b30] transition-colors"
              style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* ZZP'er Dashboard */}
        {profile.role === 'zzper' && (
          <div className="space-y-4">

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
          </div>
        )}

        {/* Accountant Dashboard */}
        {profile.role === 'accountant' && (
          <div className="space-y-4">

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
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{client.email}</p>
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
          </div>
        )}

      </main>
    </div>
  )
}

// ── Tiny nav button ────────────────────────────────────────────────────────────

function NavButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
      style={{ color: 'var(--color-text-secondary)', fontWeight: 500, background: 'none', border: 'none' }}
    >
      {label}
    </button>
  )
}

// ── InvoiceTable ───────────────────────────────────────────────────────────────

interface InvoiceTableProps {
  invoices: any[]
  loading: boolean
  hasMore: boolean
  refreshing: boolean
  statusFilter: InvoiceStatusFilter
  onFilterChange: (s: InvoiceStatusFilter) => void
  onLoadMore: () => void
  onRefresh: () => void
  onMarkPaid: (id: string, status: 'paid' | 'sent') => void
  onResend: (e: React.MouseEvent, id: string) => void
  onDelete: (id: string) => void
  onNavigate: (id: string) => void
  resendingId: string | null
  title?: string
  showNewButton?: boolean
  onNewInvoice?: () => void
}

function InvoiceTable({
  invoices, loading, hasMore, refreshing,
  statusFilter, onFilterChange,
  onLoadMore, onRefresh,
  onMarkPaid, onResend, onDelete, onNavigate,
  resendingId,
  title = 'Facturen',
  showNewButton = false,
  onNewInvoice,
}: InvoiceTableProps) {
  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-separator)' }}>
        <h2 className="text-h3">{title}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title="Vernieuwen"
            style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)' }}
            className="hover:text-gray-500 transition-colors disabled:opacity-40"
          >
            <span className={refreshing ? 'inline-block animate-spin' : ''}>🔄</span>
          </button>
          {showNewButton && onNewInvoice && (
            <button
              onClick={onNewInvoice}
              className="bg-[#007aff] text-white text-sm px-4 py-2 hover:opacity-90"
            >
              + Nieuwe factuur
            </button>
          )}
        </div>
      </div>

      {/* Filter */}
      <StatusFilter value={statusFilter} onChange={onFilterChange} />

      {/* Empty state */}
      {invoices.length === 0 && !loading ? (
        <p className="text-sm text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>
          {statusFilter === 'all'
            ? 'Nog geen facturen'
            : `Geen ${STATUS_LABEL[statusFilter]?.toLowerCase() ?? statusFilter} facturen`}
        </p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--color-separator)' }}>
          <InfiniteList
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            loading={loading}
            onRefresh={onRefresh}
            refreshing={refreshing}
          >
            {invoices.map(invoice => (
              <InvoiceRowItem
                key={invoice.id}
                invoice={invoice}
                onClick={() => onNavigate(invoice.id)}
                onMarkPaid={onMarkPaid}
                onResend={onResend}
                onDelete={onDelete}
                resendingId={resendingId}
              />
            ))}
          </InfiniteList>
        </div>
      )}
    </div>
  )
}