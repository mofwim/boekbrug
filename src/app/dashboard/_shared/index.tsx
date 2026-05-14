'use client'

// src/app/dashboard/_shared/index.tsx
// مكونات مشتركة بين ZzpDashboard و AccountantDashboard
// لا تُستخدم مباشرة — تُستورد من الملفين فقط

import { useRouter } from 'next/navigation'
import { InfiniteList } from '@/components/ui/InfiniteList'
import { StatusFilter } from '@/components/ui/StatusFilter'
import { InvoiceRowItem, STATUS_LABEL } from '@/components/invoice/InvoiceRow'
import { SearchBar } from '@/components/search/SearchBar'
import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'

// ── NavButton ─────────────────────────────────────────────────────────────────

export function NavButton({ onClick, label }: { onClick: () => void; label: string }) {
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

// ── InvoiceTable ──────────────────────────────────────────────────────────────

export interface InvoiceTableProps {
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

export function InvoiceTable({
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

// ── DashboardHeader ───────────────────────────────────────────────────────────
// مشترك بين الـ ZZP والمحاسب — يُمرَّر كل شيء كـ props

interface DashboardHeaderProps {
  profile: any
  notifications: any[]
  showNotifications: boolean
  unreadNotifCount: number
  unreadMessages: number
  onToggleNotifications: () => void
  onMessagesClick: () => void
  onLogout: () => void
  onQuarterly?: () => void
}

export function DashboardHeader({
  profile,
  notifications,
  showNotifications,
  unreadNotifCount,
  unreadMessages,
  onToggleNotifications,
  onMessagesClick,
  onLogout,
  onQuarterly,
}: DashboardHeaderProps) {
  const router = useRouter()

  return (
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

          <NavButton
            onClick={() => onQuarterly ? onQuarterly() : router.push('/dashboard/quarterly')}
            label="📊 Kwartaal"
          />
          <NavButton onClick={() => router.push('/dashboard/documents')} label="📂 Documenten" />
          <NavButton onClick={() => router.push('/dashboard/settings')} label="⚙️" />

          {/* Messages */}
          <div className="relative">
            <NavButton onClick={onMessagesClick} label="💬" />
            {unreadMessages > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#007aff] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                {unreadMessages}
              </span>
            )}
          </div>

          {/* Notifications */}
          <div className="relative">
            <NavButton onClick={onToggleNotifications} label="🔔" />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#ff3b30] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                {unreadNotifCount}
              </span>
            )}

            {showNotifications && (
              <div
                className="absolute top-9 right-0 bg-white rounded-2xl shadow-xl border w-80 z-50 animate-fade-in overflow-hidden"
                style={{ borderColor: 'var(--color-separator)', boxShadow: 'var(--shadow-modal)' }}
              >
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-separator)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Meldingen</p>
                </div>
                {notifications.length === 0 ? (
                  <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
                    Geen meldingen
                  </p>
                ) : (
                  <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: 'var(--color-separator)' }}>
                    {notifications.map(n => (
                      <div
                        key={n.id}
                        onClick={() => n.link && router.push(n.link)}
                        className={`px-4 py-3 transition-colors ${!n.read ? 'bg-[#e8f1ff]' : ''} ${n.link ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      >
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{n.title}</p>
                        {n.body && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{n.body}</p>
                        )}
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
            onClick={onLogout}
            className="text-xs px-2 py-1 hover:text-[#ff3b30] transition-colors"
            style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}
          >
            Uitloggen
          </button>
        </div>
      </div>
    </header>
  )
}