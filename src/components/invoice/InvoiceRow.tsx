// src/components/invoice/InvoiceRow.tsx
// Single source of truth for invoice row rendering — used everywhere
// من لوحة تحكم العميل ، BoekBrug 1.2 all tasks seperated
// من لوحة تحكم المحاسب ، BoekBrug 1.2 all tasks seperated

'use client'

import React from 'react'

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
  // [BOEK-031] Replace Flow — ingevuld als deze factuur vervangen is — May 2026
  replaced_by_number?: string | null
}

export interface InvoiceRowProps {
  invoice: InvoiceRow
  onClick: () => void
  // ZZP actions
  onMarkPaid?: (id: string, newStatus: 'paid' | 'sent') => void
  onResend?: (e: React.MouseEvent, id: string) => void
  onDelete?: (id: string) => void
  onEdit?: (id: string) => void
  resendingId?: string | null
  // Accountant actions
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

// ── Labels ────────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<string, string> = {
  draft:   'Concept',
  sent:    'Verzonden',
  paid:    'Betaald',
  overdue: 'Verlopen',
}

// ── Row background — ZZP ─────────────────────────────────────────────────────

function zzpRowClass(displayStatus: string): string {
  const map: Record<string, string> = {
    paid:    'invoice-row invoice-row-paid',
    sent:    'invoice-row invoice-row-sent',
    draft:   'invoice-row invoice-row-draft',
    overdue: 'invoice-row invoice-row-overdue',
  }
  return map[displayStatus] ?? 'invoice-row invoice-row-draft'
}

// ── Row background — Accountant ───────────────────────────────────────────────

function accountantRowClass(accountantStatus?: string | null): string {
  if (accountantStatus === 'verwerkt')       return 'invoice-row invoice-row-paid'
  if (accountantStatus === 'in_behandeling') return 'invoice-row invoice-row-sent'
  if (accountantStatus === 'vraag')          return 'invoice-row invoice-row-overdue'
  return 'invoice-row invoice-row-draft'
}

// ── Badge — ZZP ───────────────────────────────────────────────────────────────

function badgeClass(displayStatus: string): string {
  const map: Record<string, string> = {
    paid:    'badge badge-paid',
    sent:    'badge badge-sent',
    draft:   'badge badge-draft',
    overdue: 'badge badge-overdue',
  }
  return map[displayStatus] ?? 'badge badge-draft'
}

// ── Accountant buttons ────────────────────────────────────────────────────────

type AccountantAction = 'verwerkt' | 'in_behandeling' | 'vraag'

const ACCOUNTANT_ACTIONS: {
  key: AccountantAction
  label: string
  activeCls: string
  idleCls: string
}[] = [
  {
    key:       'verwerkt',
    label:     '✓ Verwerkt',
    activeCls: 'bg-[#dcfce7] border-[#bbf7d0] text-[#166534]',
    idleCls:   'bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b] hover:bg-[#dcfce7] hover:border-[#bbf7d0] hover:text-[#166534]',
  },
  {
    key:       'in_behandeling',
    label:     '⏳ In behandeling',
    activeCls: 'bg-[#dbeafe] border-[#bfdbfe] text-[#1e40af]',
    idleCls:   'bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b] hover:bg-[#dbeafe] hover:border-[#bfdbfe] hover:text-[#1e40af]',
  },
  {
    key:       'vraag',
    label:     '? Vraag',
    activeCls: 'bg-[#ffedd5] border-[#fed7aa] text-[#9a3412]',
    idleCls:   'bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b] hover:bg-[#ffedd5] hover:border-[#fed7aa] hover:text-[#9a3412]',
  },
]

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

  // [BOEK-031] Archived facturen — gearchiveerd na vervanging — May 2026
  if (invoice.status === 'archived') {
    return (
      <div
        onClick={onClick}
        className="invoice-row invoice-row-draft flex items-center justify-between px-5 py-4 cursor-pointer opacity-40"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1c1c1e] truncate line-through">
            {invoice.invoice_number || '—'}
          </p>
          <p className="text-xs text-[#6b6b6e] mt-0.5 truncate">
            {invoice.client_name}
            {invoice.invoice_date && (
              <span className="ml-2 text-[#aeaeb2]">
                {new Date(invoice.invoice_date).toLocaleDateString('nl-NL', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2.5 ml-4 flex-shrink-0">
          <p className="text-sm font-bold text-[#1c1c1e] tabular-nums line-through">
            €{(invoice.total_inc_btw ?? 0).toFixed(2)}
          </p>
          {invoice.replaced_by_number && (
            <span className="text-xs text-[#6b6b6e] bg-[#f4f4f5] border border-[#e4e4e7] px-2.5 py-1 rounded-[10px]">
              Vervangen door {invoice.replaced_by_number}
            </span>
          )}
        </div>
      </div>
    )
  }

  const rowCls = isAccountantMode
    ? accountantRowClass(invoice.accountant_status)
    : zzpRowClass(displayStatus)

  // فاتورة overdue تعامَل كـ sent في الأزرار (نفس الخيارات)
  const effectiveStatus = displayStatus === 'overdue' ? 'sent' : displayStatus

  return (
    <div
      onClick={onClick}
      className={`${rowCls} flex items-center justify-between px-5 py-4 cursor-pointer`}
    >
      {/* ── Left ── */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#1c1c1e] truncate">
          {invoice.invoice_number || '—'}
        </p>
        <p className="text-xs text-[#6b6b6e] mt-0.5 truncate">
          {invoice.client_name}
          {invoice.invoice_date && (
            <span className="ml-2 text-[#aeaeb2]">
              {new Date(invoice.invoice_date).toLocaleDateString('nl-NL', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </span>
          )}
        </p>
      </div>

      {/* ── Right ── */}
      <div className="flex items-center gap-2.5 ml-4 flex-shrink-0">

        {/* Bedrag */}
        <p className="text-sm font-bold text-[#1c1c1e] tabular-nums">
          €{(invoice.total_inc_btw ?? 0).toFixed(2)}
        </p>

        {/* ════ ACCOUNTANT MODE ════ */}
        {isAccountantMode && ACCOUNTANT_ACTIONS.map(action => {
          const isActive = invoice.accountant_status === action.key
          return (
            <button
              key={action.key}
              onClick={e => {
                e.stopPropagation()
                onAccountantAction!(invoice.id, isActive ? null : action.key)
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-[10px] border transition-colors ${
                isActive ? action.activeCls : action.idleCls
              }`}
            >
              {action.label}
            </button>
          )
        })}

        {/* ════ ZZP MODE ════ */}
        {!isAccountantMode && (
          <>
            {/* Badge — altijd zichtbaar */}
            <span className={badgeClass(displayStatus)}>
              {STATUS_LABEL[displayStatus] ?? displayStatus}
            </span>

            {/* ── DRAFT: Bewerken + Verwijderen ── */}
            {effectiveStatus === 'draft' && (
              <>
                {onEdit && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onEdit(invoice.id)
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b] hover:bg-[#e4e4e7] transition-colors"
                  >
                    ✏️ Bewerken
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onDelete(invoice.id)
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#fff5f5] border-[#fecaca] text-[#dc2626] hover:bg-[#fee2e2] transition-colors"
                  >
                    🗑️ Verwijderen
                  </button>
                )}
              </>
            )}

            {/* ── SENT / OVERDUE: Betaald? + Opnieuw verzenden ── */}
            {(effectiveStatus === 'sent') && (
              <>
                {onMarkPaid && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onMarkPaid(invoice.id, 'paid')
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b] hover:bg-[#dcfce7] hover:border-[#bbf7d0] hover:text-[#166534] transition-colors"
                  >
                    Betaald?
                  </button>
                )}
                {onResend && (
                  <button
                    onClick={e => onResend(e, invoice.id)}
                    disabled={resendingId === invoice.id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#e8f1ff] border-[#bfdbfe] text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors disabled:opacity-40"
                  >
                    {resendingId === invoice.id ? '...' : '↺ Opnieuw'}
                  </button>
                )}
              </>
            )}

            {/* ── PAID: ✓ Betaald (klik = terugzetten naar sent) ── */}
            {effectiveStatus === 'paid' && onMarkPaid && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  onMarkPaid(invoice.id, 'sent')
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#dcfce7] border-[#bbf7d0] text-[#166534] hover:bg-[#bbf7d0] transition-colors"
              >
                ✓ Betaald
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default InvoiceRowItem