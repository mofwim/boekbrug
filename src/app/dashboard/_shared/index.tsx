'use client'

// src/app/dashboard/_shared/index.tsx
// مكونات مشتركة بين ZzpDashboard و AccountantDashboard
// [INTEGRATION] role-based nav links in DashboardHeader — May 2026
// [INTEGRATION] Logo Universal — next/link + role-aware href — May 2026

import { useRouter } from 'next/navigation'
import { useRef, useEffect } from 'react'
import React from 'react'
import Link from 'next/link'
import { InfiniteList } from '@/components/ui/InfiniteList'
import { StatusFilter } from '@/components/ui/StatusFilter'
import { InvoiceRowItem, STATUS_LABEL } from '@/components/invoice/InvoiceRow'
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
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
  onRefresh: () => void | Promise<void>
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
  onRefresh: () => void | Promise<void>
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

  // [BANK-RECON-BADGE] Owner-facing reconciliation badges (never in accountant mode).
  // Self-wired here so every consumer of the shared table gets them without prop threading.
  const router = useRouter()
  const { byInvoice: reconByInvoice, confirmMatch } = useInvoiceReconciliation(!isAccountant)

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
            <span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`} style={{ fontSize: 20 }} aria-hidden>refresh</span>
          </button>

          {!isAccountant &&
            (props as ZzpInvoiceTableProps).showNewButton &&
            (props as ZzpInvoiceTableProps).onNewInvoice && (
              <button
                onClick={(props as ZzpInvoiceTableProps).onNewInvoice}
                className="bg-[#1a73e8] text-white text-sm px-4 py-2 rounded-xl hover:opacity-90 transition-opacity font-semibold"
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
            onRefresh={async () => { await onRefresh() }}
            refreshing={refreshing}
          >
            {invoices.map(invoice => (
              <InvoiceRowItem
                key={invoice.id}
                invoice={invoice}
                onClick={() => onNavigate(invoice.id)}
                onAccountantAction={
                  isAccountant
                    ? (props as AccountantInvoiceTableProps).onAccountantAction
                    : undefined
                }
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
                recon={!isAccountant ? reconByInvoice[invoice.id] : undefined}
                onReconConfirm={!isAccountant ? async (id) => {
                  // [BANK-RECON-CONFIRM] Book a safe (reference-backed) match in one tap; the badge
                  // flips to "In bankafschrift" via the hook. An amount-only match ('navigate') opens
                  // the bank page to review; router.refresh() picks up the new paid status.
                  const r = await confirmMatch(id)
                  if (r === 'ok') router.refresh()
                  else if (r !== 'error') router.push('/dashboard/bank')
                } : undefined}
              />
            ))}
          </InfiniteList>
        </div>
      )}
    </div>
  )
}

// ── ProfileMenu ───────────────────────────────────────────────────────────────
// [BOEK-028] Profile dropdown — May 2026
// [INTEGRATION] Instellingen → /dashboard/settings — May 2026

function ProfileMenu({ profile, onLogout }: { profile: any; onLogout: () => void }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const router = useRouter()

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
        aria-label="Profielmenu"
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
          {/* User info */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0 }}>
              {profile.full_name || profile.company_name}
            </p>
            <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>
              {profile.email}
            </p>
          </div>

          {/* Instellingen */}
          <button
            onClick={() => { setOpen(false); router.push('/dashboard/settings') }}
            style={{
              width: '100%', padding: '10px 16px', textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, color: '#202124', fontWeight: 500,
              borderBottom: '1px solid #F1F3F4',
              transition: 'background 0.1s ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8F9FA')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            ⚙️ Instellingen
          </button>

          {/* Uitloggen */}
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
  notifications, unreadCount, showNotifications, onToggle, onMarkAllRead,
}: {
  notifications: any[]
  unreadCount: number
  showNotifications: boolean
  onToggle: () => void
  onMarkAllRead?: () => void
}) {
  const router = useRouter()
  const bellRef = useRef<HTMLDivElement>(null)
  const [readOverride, setReadOverride] = React.useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!showNotifications) return
    const handler = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifications])

  async function markAsRead(id: string) {
    setReadOverride(prev => ({ ...prev, [id]: true }))
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      })
    } catch { /* silent — optimistic already applied */ }
  }

  return (
    <div ref={bellRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={onToggle}
        aria-label="Meldingen"
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
        {(() => {
          const effectiveUnread = notifications.filter(n => !(readOverride[n.id] ?? n.read)).length
          return effectiveUnread > 0 ? (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              backgroundColor: '#EA4335', color: '#fff',
              fontSize: 9, fontWeight: 700, borderRadius: 9999,
              minWidth: 16, height: 16, padding: '0 3px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {effectiveUnread > 9 ? '9+' : effectiveUnread}
            </span>
          ) : null
        })()}
      </button>

      {showNotifications && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          backgroundColor: '#fff', border: '1px solid #E0E0E0',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          width: 320, zIndex: 200, overflow: 'hidden',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Meldingen</p>
            {/* [BRIDGE-NOTIF] explicit mark-all-read — user stays in control, no auto-clear on open */}
            {onMarkAllRead && notifications.some(n => !(readOverride[n.id] ?? n.read)) && (
              <button
                onClick={() => {
                  // optimistic local clear so the badge/highlight update instantly
                  setReadOverride(prev => {
                    const next = { ...prev }
                    notifications.forEach(n => { next[n.id] = true })
                    return next
                  })
                  onMarkAllRead()
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 500, color: '#1A73E8',
                  padding: '2px 4px', borderRadius: 4, whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F1F3F4')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
              >
                Alles gelezen
              </button>
            )}
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
                    backgroundColor: !(readOverride[n.id] ?? n.read) ? '#E8F0FE' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (n.link) (e.currentTarget as HTMLDivElement).style.backgroundColor = !(readOverride[n.id] ?? n.read) ? '#D2E3FC' : '#F8F9FA' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = !(readOverride[n.id] ?? n.read) ? '#E8F0FE' : 'transparent' }}
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

// ── AccountantNavLinks ────────────────────────────────────────────────────────
// [INTEGRATION] Accountant-only nav links — Werkplek + Klanten — May 2026

function AccountantNavLinks() {
  const router = useRouter()

  const links = [
    // [CONTROL] was '/dashboard/werkplek' — the ZZP werkplek, dropping accountants
    // onto a wrong-role screen. Point at the real (role-guarded) accountant werkplek.
    { label: 'Werkplek', href: '/dashboard/accountant/werkplek' },
    { label: 'Klanten',  href: '/dashboard/clients/beheer' },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {links.map(({ label, href }) => (
        <button
          key={href}
          onClick={() => router.push(href)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 13, fontWeight: 500, color: '#5F6368',
            transition: 'background 0.1s, color 0.1s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = '#F1F3F4'
            b.style.color = '#1A73E8'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = 'transparent'
            b.style.color = '#5F6368'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── ZzpNavLinks ───────────────────────────────────────────────────────────────
// [TODAY-NAV-LINK] Owner-only nav link — "Vandaag" → /dashboard/vandaag.
// Mirrors AccountantNavLinks exactly (same pattern, colors, hover). Shown only
// for the ZZP'er in the header; does NOT change the default home (getHomePath
// stays '/dashboard'). Adding more owner links later = append to `links`.

function ZzpNavLinks() {
  const router = useRouter()

  const links = [
    { label: 'Vandaag', href: '/dashboard/vandaag' },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {links.map(({ label, href }) => (
        <button
          key={href}
          onClick={() => router.push(href)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 13, fontWeight: 500, color: '#5F6368',
            transition: 'background 0.1s, color 0.1s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = '#F1F3F4'
            b.style.color = '#1A73E8'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = 'transparent'
            b.style.color = '#5F6368'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── DashboardHeader ───────────────────────────────────────────────────────────
// [BOEK-028] Responsive single-row header — no flex-wrap — May 2026
// [INTEGRATION] role-based nav + Logo Universal (next/link, role-aware) — May 2026

interface DashboardHeaderProps {
  profile: any
  notifications: any[]
  showNotifications: boolean
  unreadNotifCount: number
  unreadMessages: number
  onToggleNotifications: () => void
  onMessagesClick: () => void
  onLogout: () => void
  // [BRIDGE-NOTIF] explicit "mark all read" — replaces the old auto-clear on open
  onMarkAllRead?: () => void
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
  onMarkAllRead,
}: DashboardHeaderProps) {
  // [INTEGRATION] Logo Universal — role-aware href — May 2026
  const isAccountant = profile?.role === 'accountant'
  const logoHref = isAccountant ? '/dashboard/accountant' : '/dashboard'

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
      fontFamily: "'Roboto', sans-serif",
    }}>

      {/* Logo — [INTEGRATION] next/link + role-aware href — May 2026 */}
      <Link
        href={logoHref}
        style={{
          fontWeight: 700, fontSize: 17, color: '#1A73E8',
          flexShrink: 0, letterSpacing: '-0.3px', lineHeight: 1,
          textDecoration: 'none', cursor: 'pointer',
          fontFamily: "'Roboto', sans-serif",
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.75')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
      >
        BoekBrug
      </Link>

      {/* Search */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 480, margin: '0 4px' }}>
        <SearchBar />
      </div>

      {/* [INTEGRATION] Accountant nav links — only when role = accountant — May 2026 */}
      {isAccountant && <AccountantNavLinks />}

      {/* [TODAY-NAV-LINK] Owner nav links — only when role = zzper */}
      {!isAccountant && <ZzpNavLinks />}

      {/* Right icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>

        {/* Messages */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={onMessagesClick}
            aria-label="Berichten"
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
          onMarkAllRead={onMarkAllRead}
        />

        {/* Avatar + profile dropdown */}
        <ProfileMenu profile={profile} onLogout={onLogout} />

      </div>
    </header>
  )
}