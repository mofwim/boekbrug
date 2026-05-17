'use client'

// src/app/dashboard/_shared/index.tsx
// مكونات مشتركة بين ZzpDashboard و AccountantDashboard
// من لوحة تحكم العميل ، BoekBrug 1.2 all tasks seperated
// من لوحة تحكم المحاسب ، BoekBrug 1.2 all tasks seperated

import { useRouter } from 'next/navigation'
import { useRef, useEffect } from 'react'
import React from 'react'
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


// ── ProfileMenu ───────────────────────────────────────────────────────────────
// [BOEK-028] Profile dropdown — replaces standalone Uitloggen button — May 2026

function ProfileMenu({ profile, onLogout }: { profile: any; onLogout: () => void }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const initials = (profile.full_name || profile.company_name || 'U')
    .split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 6px', borderRadius: 8,
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: '50%',
          backgroundColor: '#1A73E8', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {initials}
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          backgroundColor: '#fff', border: '1px solid #E0E0E0',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth: 180, zIndex: 100, overflow: 'hidden',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0 }}>
              {profile.full_name || profile.company_name}
            </p>
            <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>
              {profile.email}
            </p>
          </div>
          <button
            onClick={() => { setOpen(false); onLogout() }}
            style={{
              width: '100%', padding: '10px 16px', textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, color: '#EA4335', fontWeight: 500,
              transition: 'background 0.1s ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FFF0EE')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            Uitloggen
          </button>
        </div>
      )}
    </div>
  )
}

// ── NotificationsBell ─────────────────────────────────────────────────────────
// [BOEK-028] Bell with outside click + markAsRead — May 2026

function NotificationsBell({
  notifications, unreadCount, showNotifications, onToggle,
}: {
  notifications: any[]
  unreadCount: number
  showNotifications: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showNotifications) return
    const handler = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifications])

  async function markAsRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      })
    } catch { /* silent */ }
  }

  return (
    <div ref={bellRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={onToggle}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 8, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, lineHeight: 1, transition: 'background 0.1s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F1F3F4')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            backgroundColor: '#EA4335', color: '#fff',
            fontSize: 9, fontWeight: 700, borderRadius: 9999,
            minWidth: 16, height: 16, padding: '0 3px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, pointerEvents: 'none',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          backgroundColor: '#fff', border: '1px solid #E0E0E0',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          width: 320, zIndex: 200, overflow: 'hidden',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Meldingen</p>
          </div>
          {notifications.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '32px 16px', margin: 0 }}>
              Geen meldingen
            </p>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => {
                    if (n.link) { router.push(n.link); onToggle(); if (!n.read) markAsRead(n.id) }
                  }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid #F1F3F4',
                    cursor: n.link ? 'pointer' : 'default',
                    backgroundColor: !n.read ? '#E8F0FE' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (n.link) (e.currentTarget as HTMLDivElement).style.backgroundColor = !n.read ? '#D2E3FC' : '#F8F9FA' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = !n.read ? '#E8F0FE' : 'transparent' }}
                >
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#202124', margin: 0 }}>{n.title}</p>
                  {n.body && <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>{n.body}</p>}
                  <p style={{ fontSize: 11, color: '#9AA0A6', margin: '4px 0 0' }}>
                    {new Date(n.created_at).toLocaleDateString('nl-NL')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── DashboardHeader ───────────────────────────────────────────────────────────
// [BOEK-028] Responsive single-row header — no flex-wrap — May 2026

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

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      backgroundColor: '#fff',
      borderBottom: '1px solid #E0E0E0',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 8,
      fontFamily: "'Google Sans', 'Roboto', sans-serif",
      // [BOEK-028] NO flex-wrap — single row always — May 2026
    }}>

      {/* LEFT: Logo — never shrinks */}
      <a href="/dashboard" style={{
        fontWeight: 700,
        fontSize: 17,
        color: '#1A73E8',
        textDecoration: 'none',
        flexShrink: 0,
        letterSpacing: '-0.3px',
        lineHeight: 1,
      }}>
        BoekBrug
      </a>

      {/* CENTER: Search — takes all remaining space, never overflows */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 480, margin: '0 4px' }}>
        <SearchBar />
      </div>

      {/* RIGHT: icon buttons only — fixed width, never wraps */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
      }}>

        {/* Messages */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={onMessagesClick}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 8, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, lineHeight: 1, transition: 'background 0.1s',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F1F3F4')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            💬
          </button>
          {unreadMessages > 0 && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              backgroundColor: '#1A73E8', color: '#fff',
              fontSize: 9, fontWeight: 700, borderRadius: 9999,
              minWidth: 16, height: 16, padding: '0 3px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
        </div>

        {/* Notifications bell */}
        <NotificationsBell
          notifications={notifications}
          unreadCount={unreadNotifCount}
          showNotifications={showNotifications}
          onToggle={onToggleNotifications}
        />

        {/* Avatar + profile dropdown */}
        <ProfileMenu profile={profile} onLogout={onLogout} />

      </div>
    </header>
  )
}