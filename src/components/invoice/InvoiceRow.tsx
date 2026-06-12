// src/components/invoice/InvoiceRow.tsx
// Single source of truth for invoice row rendering — used everywhere
// من لوحة تحكم العميل ، BoekBrug 1.2 all tasks seperated
// من لوحة تحكم المحاسب ، BoekBrug 1.2 all tasks seperated
// [BOEK-031] Design System v1.0 applied — Material You (ZZP) + Workspace (Accountant) — May 2026

'use client'

import React from 'react'

// ── Design System tokens ───────────────────────────────────────────────────────
// ZZP → Material You | Accountant → Google Workspace
// Source: BoekBrug_Design_System_v1.0.md

const DS = {
  // Status chip colors — same values, different radius per mode
  chip: {
    paid:    { bg: '#CEEAD6', color: '#137333' },
    sent:    { bg: '#D3E3FD', color: '#1967D2' },
    received:{ bg: '#FEF7E0', color: '#B26A00' }, // [BRIDGE-A] incoming unpaid (Crediteuren)
    overdue: { bg: '#F9DEDC', color: '#B3261E' },
    draft:   { bg: '#E7E0EC', color: '#49454F' },
    credit:  { bg: '#FCE8E6', color: '#C5221F' },
  },
  // Accountant action chips — Workspace palette
  action: {
    verwerkt:       { bg: '#E6F4EA', color: '#137333', activeBorder: '#34A853' },
    in_behandeling: { bg: '#E8F0FE', color: '#1967D2', activeBorder: '#1A73E8' },
    vraag:          { bg: '#FEF7E0', color: '#EA8600', activeBorder: '#FBBC04' },
  },
  // Row left-border for accountant — Workspace table style
  rowBorder: {
    verwerkt:       '#34A853',
    in_behandeling: '#1A73E8',
    vraag:          '#FBBC04',
    default:        'transparent',
  },
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string
  invoice_number: string
  client_name: string
  status: string
  accountant_status?: string | null
  direction?: string
  total_inc_btw: number
  invoice_date: string
  due_date: string | null
  created_at: string
  replaced_by_number?: string | null
  // [BOEK-031] invoice_type for badge logic — May 2026
  invoice_type?: string | null
}

export interface InvoiceRowProps {
  invoice: InvoiceRow
  onClick: () => void
  onMarkPaid?: (id: string, newStatus: 'paid' | 'sent') => void
  onResend?: (e: React.MouseEvent, id: string) => void
  onDelete?: (id: string) => void
  onEdit?: (id: string) => void
  resendingId?: string | null
  onAccountantAction?: (id: string, action: 'verwerkt' | 'in_behandeling' | 'vraag' | null) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isOverdue(invoice: { status: string; due_date: string | null }): boolean {
  if (invoice.status === 'paid' || invoice.status === 'draft') return false
  if (!invoice.due_date) return false
  return new Date(invoice.due_date) < new Date()
}

export function getDisplayStatus(invoice: { status: string; due_date: string | null }): string {
  return isOverdue(invoice) ? 'overdue' : invoice.status
}

export const STATUS_LABEL: Record<string, string> = {
  draft:    'Concept',
  sent:     'Verzonden',
  received: 'Ontvangen', // [BRIDGE-A] shared now includes received
  paid:     'Betaald',
  overdue:  'Verlopen',
}

// ── Chip helpers ──────────────────────────────────────────────────────────────

// [DS] ZZP → pill (borderRadius 9999), Accountant → rect (borderRadius 4px)
function StatusChip({ status, mode }: { status: string; mode: 'zzp' | 'accountant' }) {
  const chip = DS.chip[status as keyof typeof DS.chip] ?? DS.chip.draft
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      backgroundColor: chip.bg,
      color: chip.color,
      borderRadius: mode === 'zzp' ? 9999 : 4,
      padding: '4px 12px',
      fontSize: 12,
      fontWeight: 500,
      lineHeight: 1,
      whiteSpace: 'nowrap',
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// [DS] Accountant action chip — Workspace rectangle style
function ActionChip({
  actionKey, label, isActive, onClick,
}: {
  actionKey: keyof typeof DS.action
  label: string
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const colors = DS.action[actionKey]
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        fontWeight: 500,
        padding: '6px 12px',
        borderRadius: 4, // [DS] Workspace rect
        border: isActive ? `1px solid ${colors.activeBorder}` : '1px solid #E0E0E0',
        backgroundColor: isActive ? colors.bg : '#F8F9FA',
        color: isActive ? colors.color : '#5F6368',
        cursor: 'pointer',
        transition: 'background 0.1s ease', // [DS] Workspace — subtle only
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ── ZZP action button ─────────────────────────────────────────────────────────

function ZzpButton({
  onClick, disabled = false, variant, children,
}: {
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  variant: 'default' | 'danger' | 'success' | 'primary'
  children: React.ReactNode
}) {
  // [DS] Material You — tonal buttons, pill shape
  const styles: Record<string, React.CSSProperties> = {
    default:  { backgroundColor: '#E7E0EC', color: '#49454F' },
    danger:   { backgroundColor: '#F9DEDC', color: '#B3261E' },
    success:  { backgroundColor: '#CEEAD6', color: '#137333' },
    primary:  { backgroundColor: '#D3E3FD', color: '#1967D2' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12,
        fontWeight: 500,
        padding: '6px 14px',
        borderRadius: 9999, // [DS] Material You pill
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all 0.1s cubic-bezier(0.4,0,0.2,1)', // [DS] Material You easing
        whiteSpace: 'nowrap',
        ...styles[variant],
      }}
    >
      {children}
    </button>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceRowItem({
  invoice,
  onClick,
  onMarkPaid,
  onResend,
  onDelete,
  onEdit,
  resendingId = null,
  onAccountantAction,
}: InvoiceRowProps) {
  const displayStatus    = getDisplayStatus(invoice)
  const isAccountantMode = !!onAccountantAction
  const effectiveStatus  = displayStatus === 'overdue' ? 'sent' : displayStatus

  // [DS] Row border-left for accountant — Workspace table style
  const accountantBorderColor = isAccountantMode
    ? DS.rowBorder[invoice.accountant_status as keyof typeof DS.rowBorder] ?? DS.rowBorder.default
    : 'transparent'

  // ── [BOEK-031] Archived row ────────────────────────────────────────────────
  if (invoice.status === 'archived') {
    return (
      <div
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          cursor: 'pointer',
          opacity: 0.4,
          borderBottom: '1px solid #E0E0E0',
          backgroundColor: '#F8F9FA',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', textDecoration: 'line-through', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {invoice.invoice_number || '—'}
          </p>
          <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {invoice.client_name}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', fontFamily: 'Roboto Mono, monospace', textDecoration: 'line-through' }}>
            {new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(invoice.total_inc_btw ?? 0)}
          </span>
          {invoice.replaced_by_number && (
            <span style={{ fontSize: 11, color: '#5F6368', backgroundColor: '#F1F3F4', borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}>
              Vervangen door {invoice.replaced_by_number}
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── Normal row ─────────────────────────────────────────────────────────────
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        cursor: 'pointer',
        borderBottom: '1px solid #E0E0E0',
        backgroundColor: 'white',
        borderLeft: `3px solid ${accountantBorderColor}`,
        transition: isAccountantMode ? 'background 0.1s ease' : 'all 0.15s ease',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = '#F8F9FA' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'white' }}
    >
      {/* ── Left ── */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {invoice.invoice_number || '—'}
        </p>
        <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {invoice.client_name}
          {invoice.invoice_date && (
            <span style={{ marginLeft: 8, color: '#9AA0A6' }}>
              {new Date(invoice.invoice_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </p>
      </div>

      {/* ── Right ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 16, flexShrink: 0 }}>

        {/* [DS] Amount — Roboto Mono */}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', fontFamily: 'Roboto Mono, monospace', whiteSpace: 'nowrap' }}>
          {new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(invoice.total_inc_btw ?? 0)}
        </span>

        {/* ════ ACCOUNTANT MODE — Workspace chips ════ */}
        {isAccountantMode && (
          <>
            <ActionChip actionKey="verwerkt" label="✓ Verwerkt"
              isActive={invoice.accountant_status === 'verwerkt'}
              onClick={e => { e.stopPropagation(); onAccountantAction!(invoice.id, invoice.accountant_status === 'verwerkt' ? null : 'verwerkt') }} />
            <ActionChip actionKey="in_behandeling" label="⏳ In behandeling"
              isActive={invoice.accountant_status === 'in_behandeling'}
              onClick={e => { e.stopPropagation(); onAccountantAction!(invoice.id, invoice.accountant_status === 'in_behandeling' ? null : 'in_behandeling') }} />
            <ActionChip actionKey="vraag" label="? Vraag"
              isActive={invoice.accountant_status === 'vraag'}
              onClick={e => { e.stopPropagation(); onAccountantAction!(invoice.id, invoice.accountant_status === 'vraag' ? null : 'vraag') }} />
          </>
        )}

        {/* ════ ZZP MODE — Material You ════ */}
        {!isAccountantMode && (
          <>
            {/* [BOEK-031] Creditnota: geen status badge — alleen type badge — May 2026 */}
            {invoice.invoice_type === 'creditnota' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                backgroundColor: '#F9DEDC', color: '#B3261E',
                borderRadius: 9999, padding: '4px 12px',
                fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
              }}>
                Creditnota
              </span>
            ) : (
              <StatusChip status={displayStatus} mode="zzp" />
            )}

            {/* DRAFT */}
            {effectiveStatus === 'draft' && (
              <>
                {onEdit && (
                  <ZzpButton variant="default" onClick={e => { e.stopPropagation(); onEdit(invoice.id) }}>
                    ✏️ Bewerken
                  </ZzpButton>
                )}
                {onDelete && (
                  <ZzpButton variant="danger" onClick={e => { e.stopPropagation(); onDelete(invoice.id) }}>
                    🗑️ Verwijderen
                  </ZzpButton>
                )}
              </>
            )}

            {/* SENT / OVERDUE */}
            {effectiveStatus === 'sent' && (
              <>
                {onMarkPaid && (
                  <ZzpButton variant="success" onClick={e => { e.stopPropagation(); onMarkPaid(invoice.id, 'paid') }}>
                    Betaald?
                  </ZzpButton>
                )}
                {onResend && (
                  <ZzpButton variant="primary" disabled={resendingId === invoice.id}
                    onClick={e => { e.stopPropagation(); onResend(e, invoice.id) }}>
                    {resendingId === invoice.id ? '...' : '↺ Opnieuw'}
                  </ZzpButton>
                )}
              </>
            )}

            {/* PAID */}
            {effectiveStatus === 'paid' && onMarkPaid && (
              <ZzpButton variant="success" onClick={e => { e.stopPropagation(); onMarkPaid(invoice.id, 'sent') }}>
                ✓ Betaald
              </ZzpButton>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default InvoiceRowItem