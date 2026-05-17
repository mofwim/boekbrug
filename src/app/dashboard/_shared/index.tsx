'use client'

// src/app/dashboard/_shared/index.tsx
// مكونات مشتركة بين ZzpDashboard و AccountantDashboard
// من لوحة تحكم العميل ، BoekBrug 1.2 all tasks seperated
// من لوحة تحكم المحاسب ، BoekBrug 1.2 all tasks seperated

import { useRouter } from 'next/navigation'
import { useRef, useEffect } from 'react'
import { InfiniteList } from '@/components/ui/InfiniteList'
import { StatusFilter } from '@/components/ui/StatusFilter'
import { InvoiceRowItem, STATUS_LABEL } from '@/components/invoice/InvoiceRow'
import { SearchBar } from '@/components/search/SearchBar'
import type { InvoiceStatusFilter, AccountantStatusFilter } from '@/hooks/useInfiniteInvoices'

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

// ── InvoiceTable — ZZP ────────────────────────────────────────────────────────

export interface ZzpInvoiceTableProps {
  mode: 'zzp'
  invoices: any[]
  loading: boolean
  hasMore: boolean
  refreshing: boolean
  statusFilter: InvoiceStatusFilter
  onFilterChange: (s: InvoiceStatusFilter) => void
  onLoadMore: () => void
  onRefresh: () => void | Promise<void>  // [BOEK-009] fix: InfiniteList expects Promise<void>
  onNavigate: (id: string) => void
  title?: string
  onMarkPaid?: (id: string, status: 'paid' | 'sent') => void
  onResend?: (e: React.MouseEvent, id: string) => void
  onDelete?: (id: string) => void
  onEdit?: (id: string) => void
  resendingId?: string | null
  showNewButton?: boolean
  onNewInvoice?: () => void
}

// ── InvoiceTable — Accountant ─────────────────────────────────────────────────

export interface AccountantInvoiceTableProps {
  mode: 'accountant'
  invoices: any[]
  loading: boolean
  hasMore: boolean
  refreshing: boolean
  statusFilter: AccountantStatusFilter
  onFilterChange: (s: AccountantStatusFilter) => void
  onLoadMore: () => void
  onRefresh: () => void | Promise<void>  // [BOEK-009] fix: InfiniteList expects Promise<void>
  onNavigate: (id: string) => void
  title?: string
  onAccountantAction: (id: string, action: 'verwerkt' | 'in_behandeling' | 'vraag' | null) => void
}

export type InvoiceTableProps = ZzpInvoiceTableProps | AccountantInvoiceTableProps

// ── InvoiceTable ──────────────────────────────────────────────────────────────

export function InvoiceTable(props: InvoiceTableProps) {
  const {
    invoices, loading, hasMore, refreshing,
    statusFilter, onFilterChange,
    onLoadMore, onRefresh, onNavigate,
    title = 'Facturen',
  } = props

  const isAccountant = props.mode === 'accountant'

  const emptyLabel = isAccountant
    ? statusFilter === 'all'
      ? 'Geen betaalde facturen'
      : `Geen facturen met status "${statusFilter}"`
    : statusFilter === 'all'
      ? 'Nog geen facturen'
      : `Geen ${STATUS_LABEL[statusFilter as string]?.toLowerCase() ?? statusFilter} facturen`

  return (
    <div className="card overflow-hidden">

      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--color-separator)' }}
      >
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

          {!isAccountant &&
            (props as ZzpInvoiceTableProps).showNewButton &&
            (props as ZzpInvoiceTableProps).onNewInvoice && (
              <button
                onClick={(props as ZzpInvoiceTableProps).onNewInvoice}
                className="bg-[#007aff] text-white text-sm px-4 py-2 rounded-xl hover:opacity-90 transition-opacity font-semibold"
              >
                + Nieuwe factuur
              </button>
            )}
        </div>
      </div>

      {/* Filter */}
      {isAccountant ? (
        <StatusFilter
          mode="accountant"
          value={statusFilter as AccountantStatusFilter}
          onChange={onFilterChange as (v: AccountantStatusFilter) => void}
        />
      ) : (
        <StatusFilter
          mode="zzp"
          value={statusFilter as InvoiceStatusFilter}
          onChange={onFilterChange as (v: InvoiceStatusFilter) => void}
        />
      )}

      {/* Lege staat */}
      {invoices.length === 0 && !loading ? (
        <p
          className="text-sm text-center py-12"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {emptyLabel}
        </p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--color-separator)' }}>
          <InfiniteList
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            loading={loading}
            onRefresh={async () => { await onRefresh() }} // [BOEK-009] wrap: InfiniteList expects Promise<void>
            refreshing={refreshing}
          >
            {invoices.map(invoice => (
              <InvoiceRowItem
                key={invoice.id}
                invoice={invoice}
                onClick={() => onNavigate(invoice.id)}
                // Accountant props
                onAccountantAction={
                  isAccountant
                    ? (props as AccountantInvoiceTableProps).onAccountantAction
                    : undefined
                }
                // ZZP props
                onMarkPaid={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onMarkPaid
                    : undefined
                }
                onResend={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onResend
                    : undefined
                }
                onDelete={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onDelete
                    : undefined
                }
                onEdit={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onEdit
                    : undefined
                }
                resendingId={
                  !isAccountant
                    ? ((props as ZzpInvoiceTableProps).resendingId ?? null)
                    : null
                }
              />
            ))}
          </InfiniteList>
        </div>
      )}
    </div>
  )
}

// ── DashboardHeader ───────────────────────────────────────────────────────────

interface DashboardHeaderProps {
  profile: any
  notifications: any[]
  showNotifications: boolean
  unreadNotifCount: number
  unreadMessages: number
  onToggleNotifications: () => void
  onMessagesClick: () => void
  onLogout: () => void
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
}: DashboardHeaderProps) {
  const router = useRouter()
  // [BOEK-028] close notifications on outside click — May 2026
  const bellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showNotifications) return
    const handler = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) {
        onToggleNotifications()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifications])

  return (
    <header
      className="bg-white border-b sticky top-0 z-20"
      style={{ borderColor: 'var(--color-separator)' }}
    >
      <div className="max-w-4xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">

        {/* [BOEK-028] BoekBrug → link to landing page — May 2026 */}
        <a
          href="/dashboard"  // [BOEK-028] fix: was "/" — May 2026
          className="text-base font-bold hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-text-primary)', textDecoration: 'none' }}
        >
          BoekBrug
        </a>

        <div className="flex items-center gap-1 flex-wrap">
          <span
            className="text-sm mr-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {profile.company_name}
          </span>

          {/* [BOEK-028] SearchBar restored — handles dropdown + navigate internally — May 2026 */}
          <SearchBar />

          <NavButton onClick={() => router.push('/dashboard/settings')} label="⚙️" />

          {/* Berichten */}
          <div className="relative">
            <NavButton onClick={onMessagesClick} label="💬" />
            {unreadMessages > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#007aff] text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                {unreadMessages}
              </span>
            )}
          </div>

          {/* Meldingen */}
          <div className="relative" ref={bellRef}>
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
                <div
                  className="px-4 py-3 border-b"
                  style={{ borderColor: 'var(--color-separator)' }}
                >
                  <p
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    Meldingen
                  </p>
                </div>

                {notifications.length === 0 ? (
                  <p
                    className="text-sm text-center py-8"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    Geen meldingen
                  </p>
                ) : (
                  <div
                    className="divide-y max-h-80 overflow-y-auto"
                    style={{ borderColor: 'var(--color-separator)' }}
                  >
                    {notifications.map(n => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 transition-colors ${!n.read ? 'bg-[#e8f1ff]' : ''} ${n.link ? 'hover:bg-gray-50' : ''}`}
                        style={{ cursor: n.link ? 'pointer' : 'default' }}
                        onClick={() => { if (n.link) router.push(n.link) }}
                      >
                        <p
                          className="text-sm font-medium"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {n.title}
                        </p>
                        {n.body && (
                          <p
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            {n.body}
                          </p>
                        )}
                        <p
                          className="text-xs mt-1"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
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