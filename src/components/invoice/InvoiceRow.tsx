// src/components/invoice/InvoiceRow.tsx
// Single source of truth for invoice row rendering — used everywhere

'use client'

import React from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string
  invoice_number: string
  client_name: string
  status: string
  direction?: string
  total_inc_btw: number
  invoice_date: string
  due_date: string | null
  created_at: string
}

export interface InvoiceRowProps {
  invoice: InvoiceRow
  onClick: () => void
  onMarkPaid?: (id: string, newStatus: 'paid' | 'sent') => void
  onResend?: (e: React.MouseEvent, id: string) => void
  onDelete?: (id: string) => void
  workedOn?: boolean   // accountant: row marked as done
  resendingId?: string | null
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

// ── Labels & CSS classes (single source of truth) ────────────────────────────

export const STATUS_LABEL: Record<string, string> = {
  draft:   'Concept',
  sent:    'Verzonden',
  paid:    'Betaald',
  overdue: 'Verlopen',
}

// Row background + left bar — defined in globals.css as .invoice-row-{status}
function rowClass(displayStatus: string, workedOn?: boolean): string {
  if (workedOn) return 'invoice-row invoice-row-worked'
  const map: Record<string, string> = {
    paid:    'invoice-row invoice-row-paid',
    sent:    'invoice-row invoice-row-sent',
    draft:   'invoice-row invoice-row-draft',
    overdue: 'invoice-row invoice-row-overdue',
  }
  return map[displayStatus] ?? 'invoice-row invoice-row-draft'
}

// Badge classes — defined in globals.css as .badge-{status}
function badgeClass(displayStatus: string): string {
  const map: Record<string, string> = {
    paid:    'badge badge-paid',
    sent:    'badge badge-sent',
    draft:   'badge badge-draft',
    overdue: 'badge badge-overdue',
  }
  return map[displayStatus] ?? 'badge badge-draft'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceRowItem({
  invoice,
  onClick,
  onMarkPaid,
  onResend,
  onDelete,
  workedOn = false,
  resendingId = null,
}: InvoiceRowProps) {
  const displayStatus = getDisplayStatus(invoice)

  return (
    <div
      onClick={onClick}
      className={`${rowClass(displayStatus, workedOn)} flex items-center justify-between px-5 py-4 cursor-pointer`}
    >
      {/* Left: invoice info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#1c1c1e] truncate">
          {invoice.invoice_number || 'Concept'}
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

      {/* Right: amount + status + actions */}
      <div className="flex items-center gap-2.5 ml-4 flex-shrink-0">
        <p className="text-sm font-bold text-[#1c1c1e] tabular-nums">
          €{(invoice.total_inc_btw ?? 0).toFixed(2)}
        </p>

        <span className={badgeClass(displayStatus)}>
          {STATUS_LABEL[displayStatus] ?? displayStatus}
        </span>

        {/* Mark paid / unmark paid */}
        {onMarkPaid && (invoice.status === 'sent' || invoice.status === 'paid') && (
          <button
            onClick={e => {
              e.stopPropagation()
              onMarkPaid(invoice.id, invoice.status === 'paid' ? 'sent' : 'paid')
            }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-[10px] border transition-colors ${
              invoice.status === 'paid'
                ? 'bg-[#f0fdf4] border-[#bbf7d0] text-[#166534] hover:bg-[#dcfce7]'
                : 'bg-[#f4f4f5] border-[#e4e4e7] text-[#52525b] hover:bg-[#e4e4e7]'
            }`}
          >
            {invoice.status === 'paid' ? '✓ Betaald' : 'Betaald?'}
          </button>
        )}

        {/* Resend */}
        {onResend && invoice.status === 'sent' && (
          <button
            onClick={e => onResend(e, invoice.id)}
            disabled={resendingId === invoice.id}
            className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#e8f1ff] border-[#bfdbfe] text-[#1d4ed8] hover:bg-[#dbeafe] transition-colors disabled:opacity-40"
          >
            {resendingId === invoice.id ? '...' : '↺ Opnieuw'}
          </button>
        )}

        {/* Delete draft */}
        {onDelete && invoice.status === 'draft' && (
          <button
            onClick={e => {
              e.stopPropagation()
              onDelete(invoice.id)
            }}
            className="text-xs font-semibold px-3 py-1.5 rounded-[10px] border bg-[#fff5f5] border-[#fecaca] text-[#dc2626] hover:bg-[#fee2e2] transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export default InvoiceRowItem