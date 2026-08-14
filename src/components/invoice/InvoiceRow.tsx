// src/components/invoice/InvoiceRow.tsx
// Single source of truth for invoice row rendering — used everywhere
// من لوحة تحكم العميل ، BoekBrug 1.2 all tasks seperated
// من لوحة تحكم المحاسب ، BoekBrug 1.2 all tasks seperated
// [BOEK-031] Design System v1.0 applied — Material You (ZZP) + Workspace (Accountant) — May 2026

'use client'

import React from 'react'
import type { InvoiceRecon } from '@/lib/bank-reconciliation'
// [PARTIAL-PAY] shared openstaand vocabulary — same rule on every surface
import { isPartiallyPaid, openAmount } from '@/lib/partial-payment'
// [OVER-DATUM] De ene afleiding van "over datum", in hele Amsterdamse dagen. Zie isOverdue below.
import { overdueDays } from '@/lib/overdue'
import { amsterdamToday } from '@/lib/format-nl'
// [STATUS] Het woord en de kleur van een status, uit één module — zie de kop daar.
import { statusChip, statusLabel } from '@/lib/invoice-status'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

// ── Design System tokens ───────────────────────────────────────────────────────
// ZZP → Material You | Accountant → Google Workspace
// Source: BoekBrug_Design_System_v1.0.md

const DS = {
  // [STATUS] De statuskleuren stonden hier — als achtste kopie, in een object dat DS heet maar
  // niet uit design/tokens komt. Ze wonen nu in src/lib/invoice-status.ts, samen met het woord,
  // zodat een scherm de kleur en het label niet meer van twee plekken kan halen.
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
  // [PARTIAL-PAY] Running total already settled — drives the "Deels · € X open" chip.
  amount_paid?: number | null
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
  // [BANK-RECON-BADGE] Reconciliation status vs the bank statement for THIS invoice.
  // linked → "in bankafschrift"; pendingMatch → a confident unconfirmed payment the owner
  // can confirm in one tap (onReconConfirm routes to the bank page). Undefined → no badge.
  recon?: InvoiceRecon
  onReconConfirm?: (invoiceId: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// [OVER-DATUM] Over datum of niet — via lib/overdue.ts, de ene bron die de rest van de app al
// gebruikt. Hier stond een tweede antwoord, en het was het verkeerde:
//
//   new Date(invoice.due_date) < new Date()
//
// Dat vergelijkt een DAG met een MOMENT. `new Date('2026-07-31')` is middernacht UTC, oftewel
// 02:00 in Amsterdam — dus vanaf twee uur 's nachts OP de vervaldag zelf stond er "Verlopen" op
// een factuur die de klant die hele dag nog op tijd kon betalen. Precies wat overdue.ts in zijn
// kop verbiedt: "an invoice is due ON a date, not at a moment… Due TODAY is not late."
//
// En het sprak het scherm ernaast tegen: het tabblad Verlopen filtert met `due_date < vandaag`
// (dus zonder de vervaldag zelf), zodat de lijst zei "niet verlopen" en de chip op diezelfde rij
// "Verlopen". Eén afleiding, in Amsterdamse dagen, en die tegenspraak kan niet meer bestaan.
//
// 'archived' hoort in dezelfde uitzondering als 'paid'/'draft': een verwijderde factuur wordt
// niet aangemaand, dus die als te laat bestempelen is een aansporing tot niets.
export function isOverdue(invoice: { status: string; due_date: string | null }): boolean {
  if (invoice.status === 'paid' || invoice.status === 'draft' || invoice.status === 'archived') return false
  return overdueDays(invoice.due_date, amsterdamToday()) !== null
}

export function getDisplayStatus(invoice: { status: string; due_date: string | null }): string {
  return isOverdue(invoice) ? 'overdue' : invoice.status
}

// [STATUS] Het woord én de kleur komen uit src/lib/invoice-status.ts. Hier stond een eigen kopie;
// er waren er zeven in de app, en ze waren al uit elkaar gelopen — 'overdue' las op één scherm
// "Te laat" en op vijf andere "Verlopen", en 'sent' had twee verschillende blauwtinten.

// ── Chip helpers ──────────────────────────────────────────────────────────────

// [DS] ZZP → pill (borderRadius 9999), Accountant → rect (borderRadius 4px)
function StatusChip({ status, mode }: { status: string; mode: 'zzp' | 'accountant' }) {
  const taal = useLocale()
  const chip = statusChip(status, taal)
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
      {statusLabel(status, taal)}
    </span>
  )
}

// [BANK-RECON-BADGE] A small chip showing this invoice's relationship to the bank
// statement. "In bankafschrift" (green) when a bank line is already linked; "Betaling
// gevonden" (blue, tappable) when the engine confidently matches an unconfirmed payment.
// The pending chip stops row-click propagation and routes to the bank page to confirm —
// it never marks the invoice paid by itself.
export function ReconBadge({
  recon, mode, invoiceId, onReconConfirm,
}: {
  recon: InvoiceRecon
  mode: 'zzp' | 'accountant'
  invoiceId: string
  onReconConfirm?: (invoiceId: string) => void
}) {
  const t = translator(useLocale())
  const radius = mode === 'zzp' ? 9999 : 4
  if (recon.linked) {
    return (
      <span title={t('rij.inAfschriftTip')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        backgroundColor: '#E6F4EA', color: '#137333',
        borderRadius: radius, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
      }}>
        <span aria-hidden>🔗</span> {t('rij.inAfschrift')}
      </span>
    )
  }
  if (recon.pendingMatch) {
    const clickable = !!onReconConfirm
    // [BANK-RECON-CONFIRM] A SAFE match (reference-backed) is one tap to book — blue "Betaling
    // gevonden". An amount-only match is only a POSSIBILITY (a same-amount invoice could be the
    // real one), so it reads amber "Mogelijke betaling — controleer" and opens the bank page for
    // review rather than claiming certainty. Never overstate what the engine actually knows.
    const safe = recon.pendingMatch.safe === true
    return (
      <span
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? (e) => { e.stopPropagation(); onReconConfirm!(invoiceId) } : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onReconConfirm!(invoiceId) } } : undefined}
        title={safe ? t('rij.veiligTip') : t('rij.controleTip')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          backgroundColor: safe ? '#E8F0FE' : '#FEF7E0', color: safe ? '#1967D2' : '#B26A00',
          borderRadius: radius, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
          cursor: clickable ? 'pointer' : 'default',
        }}
      >
        <span aria-hidden>🏦</span> {safe ? t('rij.betalingGevonden') : t('rij.mogelijkeBetaling')}
      </span>
    )
  }
  return null
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
    default:  { backgroundColor: '#f1f3f4', color: '#5f6368' },
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
  recon,
  onReconConfirm,
}: InvoiceRowProps) {
  const t = translator(useLocale())
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
          // [PERF] native list virtualization: skip rendering off-screen rows.
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 56px',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginInlineStart: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', fontFamily: 'Roboto Mono, monospace', textDecoration: 'line-through' }}>
            {new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(invoice.total_inc_btw ?? 0)}
          </span>
          {invoice.replaced_by_number && (
            <span style={{ fontSize: 11, color: '#5F6368', backgroundColor: '#F1F3F4', borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}>
              {t('rij.vervangenDoor', { number: invoice.replaced_by_number })}
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
        borderInlineStart: `3px solid ${accountantBorderColor}`,
        transition: isAccountantMode ? 'background 0.1s ease' : 'all 0.15s ease',
        // [PERF] native list virtualization: skip rendering off-screen rows.
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 56px',
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
            <span style={{ marginInlineStart: 8, color: '#9AA0A6' }}>
              {new Date(invoice.invoice_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </p>
      </div>

      {/* ── Right ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginInlineStart: 16, flexShrink: 0 }}>

        {/* [DS] Amount — Roboto Mono */}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#202124', fontFamily: 'Roboto Mono, monospace', whiteSpace: 'nowrap' }}>
          {new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(invoice.total_inc_btw ?? 0)}
        </span>

        {/* [PARTIAL-PAY] Only part of this invoice is settled. The accountant needs this BEFORE
            marking it 'verwerkt': that lock freezes amount_paid (invoice_accountant_write_guard),
            so once it is on, nobody can book the remaining instalment. The owner sees the same
            chip on Facturen and Crediteuren — one shared vocabulary. */}
        {isPartiallyPaid(invoice) && (
          <span
            title={t('rij.deelsTip', { paid: new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(invoice.amount_paid ?? 0), total: new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Math.abs(invoice.total_inc_btw ?? 0)) })}
            style={{
              fontSize: 11, fontWeight: 600, color: '#b06000', background: '#fef7e0',
              border: '1px solid #fde293', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap',
            }}
          >
            {t('rij.deelsOpen', { amount: new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(openAmount(invoice)) })}
          </span>
        )}

        {/* [BANK-RECON-BADGE] Reconciliation vs the bank statement (owner-facing). */}
        {recon && (
          <ReconBadge recon={recon} mode={isAccountantMode ? 'accountant' : 'zzp'} invoiceId={invoice.id} onReconConfirm={onReconConfirm} />
        )}

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
                {t('status.credit')}
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