'use client'

// src/app/dashboard/clients/[id]/kwartaal/page.tsx
// [BOEK-028] Kwartaal page — per client, per quarter — May 2026
// Accessible via: /dashboard/clients/[id]/kwartaal?q=1&year=2026
// [BRIDGE-A] Shows ALL shared invoices (sent/received/paid) filtered by quarter
// Accounting split: Debiteuren / Crediteuren / Voldaan — Verlopen computed at display
// Inline expand on row click — no page navigation
// Action dropdown: Verwerkt / In behandeling / Vraag (Not Found removed)

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams, useSearchParams } from 'next/navigation'

// ─────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] Not Found removed — 3 actions only
const ACCOUNTANT_ACTIONS = [
  { value: 'verwerkt',       label: 'Verwerkt',        bg: '#E6F4EA', color: '#137333', rowBg: '#F2FAF4' },
  { value: 'in_behandeling', label: 'In behandeling',  bg: '#FEF7E0', color: '#EA8600', rowBg: '#FEFCF0' },
  { value: 'vraag',          label: 'Vraag',           bg: '#E8F0FE', color: '#1967D2', rowBg: '#F0F4FF' },
] as const

type ActionValue = 'verwerkt' | 'in_behandeling' | 'vraag'

// Quarter date ranges
const QUARTER_RANGES: Record<number, { start: string; end: string; label: string }> = {
  1: { start: '-01-01', end: '-03-31', label: 'jan – mrt' },
  2: { start: '-04-01', end: '-06-30', label: 'apr – jun' },
  3: { start: '-07-01', end: '-09-30', label: 'jul – sep' },
  4: { start: '-10-01', end: '-12-31', label: 'okt – dec' },
}

// [BOEK-028] Fixed Dutch formatting — never changes
const NL_NUMBER = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE   = new Intl.DateTimeFormat('nl-NL')

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  try { return NL_DATE.format(new Date(d)) } catch { return d ?? '—' }
}

// [BOEK-028] Amount: outgoing = positive, incoming = negative
function getAmount(inv: any): number {
  return inv.direction === 'outgoing' ? inv.total_inc_btw : -(inv.total_inc_btw)
}

// btw_rate does not exist in DB — always calculate
function getBtwRate(inv: any): number {
  if (!inv.total_ex_btw || inv.total_ex_btw === 0) return 0
  return Math.round((inv.btw_amount / inv.total_ex_btw) * 100)
}

// [BRIDGE-A] Accounting split — section definitions (accountant terminology)
const SECTIONS = [
  { key: 'debiteuren',  title: 'Debiteuren',  sub: 'verzonden — nog te ontvangen',
    filter: (i: any) => i.direction === 'outgoing' && i.status === 'sent' },
  { key: 'crediteuren', title: 'Crediteuren', sub: 'ontvangen — nog te betalen',
    filter: (i: any) => i.direction === 'incoming' && i.status === 'received' },
  { key: 'voldaan',     title: 'Voldaan',     sub: 'betaald',
    filter: (i: any) => i.status === 'paid' },
] as const

// [BRIDGE-A] Verlopen is computed at display time — never stored in DB
function isVerlopen(inv: any): boolean {
  return inv.status === 'sent' && !!inv.due_date && new Date(inv.due_date) < new Date()
}

// ─────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────

function ActionBadge({ value }: { value: string | null }) {
  const a = ACCOUNTANT_ACTIONS.find(x => x.value === value)
  if (!a) return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, backgroundColor: "#F1F3F4", color: "#5F6368" }}>—</span>
  )
  return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, fontWeight: 500, backgroundColor: a.bg, color: a.color }}>
      {a.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────

export default function KwartaalPage() {
  const router       = useRouter()
  const params       = useParams()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  // [BOEK-028] Next.js 15: params is a Promise — use useParams() which resolves it
  const clientId = params?.id as string
  const q        = Number(searchParams.get('q') ?? 1)
  const year     = Number(searchParams.get('year') ?? new Date().getFullYear())

  const range = QUARTER_RANGES[q] ?? QUARTER_RANGES[1]
  const dateStart = `${year}${range.start}`
  const dateEnd   = `${year}${range.end}`

  const [client, setClient] = useState<any>(null)
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Client profile
      const { data: clientData } = await supabase
        .from('profiles').select('*').eq('id', clientId).single()
      if (clientData) setClient(clientData)

      // [BRIDGE-A] Two queries — outgoing + incoming — merged, then split by section
      // Outgoing: sent (Debiteuren) + paid (Voldaan). 'voldaan' removed — never a DB value.
      const { data: outgoing } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .eq('sender_id', clientId)
        .eq('direction', 'outgoing')
        .in('status', ['sent', 'paid'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)

      // Incoming: received (Crediteuren) + paid (Voldaan).
      const { data: incoming } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .eq('receiver_id', clientId)
        .eq('direction', 'incoming')
        .in('status', ['received', 'paid'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)

      const merged = [...(outgoing ?? []), ...(incoming ?? [])]
      setInvoices(merged)
      setLoading(false)
    }
    load()
  }, [clientId, q, year])

  // [BOEK-028] Sort by marked_paid_at DESC default
  const sorted = [...invoices].sort((a, b) => {
    const da = new Date(a.marked_paid_at ?? a.invoice_date).getTime()
    const db = new Date(b.marked_paid_at ?? b.invoice_date).getTime()
    return sortAsc ? da - db : db - da
  })

  // [BRIDGE-A] Totals include ALL shared invoices (sent/received/paid) —
  // M decision: quarter BTW is on Factuurdatum, not Betaaldatum (accrual view).
  const totalIn  = invoices.filter(i => i.direction === 'outgoing').reduce((s, i) => s + (i.total_inc_btw || 0), 0)
  const totalOut = invoices.filter(i => i.direction === 'incoming').reduce((s, i) => s + (i.total_inc_btw || 0), 0)
  const totalBtw = invoices.reduce((s, i) => s + (i.btw_amount || 0), 0)

  // [BOEK-028] accountant_status update
  // [BOEK-006] action can be null = "niet verwerkt" (neutral, accountant hasn't acted)
  async function handleAction(invoiceId: string, action: ActionValue | null) {
    setUpdatingId(invoiceId)

    // [BOEK-006] null clears the status (neutral state)
    const update: Record<string, string | null> = { accountant_status: action }

    // NOTE: 'voldaan' is a UI-only label, NOT a DB status (violates CHECK).
    // Creditnota stays 'paid' in DB; the UI shows "Voldaan" based on type+status.
    // (removed the previous update.status = 'voldaan' which caused a 23514 error)

    setInvoices(prev => prev.map(i =>
      i.id === invoiceId ? { ...i, accountant_status: action } : i
    ))
    const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId)
    if (error) {
      // revert optimistic on failure
      setInvoices(prev => prev.map(i =>
        i.id === invoiceId ? { ...i, accountant_status: invoices.find(x => x.id === invoiceId)?.accountant_status ?? null } : i
      ))
    }
    setUpdatingId(null)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#F8F9FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontSize: 14, color: '#5F6368' }}>Laden...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Google Sans', 'Roboto', sans-serif" }}>

      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E0E0E0', padding: '12px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push(`/dashboard/clients/${clientId}`)}
              style={{ fontSize: 14, fontWeight: 500, color: '#1A73E8', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ← Terug
            </button>
            <div className="min-w-0">
              <h1 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Q{q} {year} — {client?.company_name || client?.full_name}
              </h1>
              <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>{range.label}</p>
            </div>
          </div>
          <button
            onClick={() => setSortAsc(p => !p)}
            style={{ fontSize: 13, fontWeight: 500, color: '#1A73E8', backgroundColor: '#E8F0FE', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {sortAsc ? 'Oudste ↑' : 'Nieuwste ↓'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* [BRIDGE-A][POLISH ب-2/ب-3] Dead buttons removed (PDF Bank/CAMT/KW — legacy
            pre-pivot idea, never wired). Documenten now opens the Brug — the hub. */}
        <button
          onClick={() => router.push('/dashboard/brug')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, cursor: 'pointer', transition: 'background 0.1s ease', width: '100%' }}
        >
          <span className="text-xl">📂</span>
          <span className="text-xs font-semibold" style={{ color: '#ff6b00', fontSize: 13 }}>Documenten — bekijk in Brug</span>
          <span style={{ color: '#1A73E8', fontWeight: 600 }}>→</span>
        </button>

        {/* Quarter summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { label: 'Inkomsten',  value: NL_NUMBER.format(totalIn),  color: '#34A853' },
            { label: 'Uitgaven',   value: NL_NUMBER.format(totalOut), color: '#EA4335' },
            { label: 'BTW totaal', value: NL_NUMBER.format(totalBtw), color: '#9334E6' },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2 }}>{s.label}</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: s.color, margin: 0 }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* [BOEK-028] Invoice table — outgoing + incoming merged */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>

          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: 0 }}>
              Facturen
              <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 6, color: '#5F6368' }}>
                ({invoices.length})
              </span>
            </h2>
          </div>

          {sorted.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '48px 0' }}>
              Geen facturen in Q{q} {year}
            </p>
          ) : (
            <div style={{ borderTop: '1px solid #E0E0E0' }}>
              {/* [BRIDGE-A] Accounting sections — empty sections hidden */}
              {SECTIONS.map(section => {
                const rows = sorted.filter(section.filter)
                if (rows.length === 0) return null
                return (
                  <div key={section.key}>
                    <div style={{ padding: '10px 16px', backgroundColor: '#F8F9FA', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0 }}>{section.title}</h3>
                      <span style={{ fontSize: 12, color: '#5F6368' }}>({rows.length}) · {section.sub}</span>
                    </div>
                    {rows.map(invoice => {
                const amount      = getAmount(invoice)
                const isExpanded  = expandedId === invoice.id
                const isUpdating  = updatingId === invoice.id
                const isOutgoing  = invoice.direction === 'outgoing'
                const rowBg       = ACCOUNTANT_ACTIONS.find(a => a.value === invoice.accountant_status)?.rowBg

                return (
                  <div key={invoice.id}
                    style={{ backgroundColor: rowBg, opacity: isUpdating ? 0.6 : 1 }}>

                    {/* Main row — click to expand inline */}
                    <div
                      className="px-4 py-3 cursor-pointer active:opacity-80 transition-opacity"
                      onClick={() => {
                        setExpandedId(isExpanded ? null : invoice.id)
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {invoice.invoice_number}
                            </p>
                            {/* direction badge */}
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                              style={{
                                backgroundColor: isOutgoing ? '#E6F4EA' : '#FCE8E6',
                                color: isOutgoing ? '#137333' : '#C5221F',
                              }}>
                              {isOutgoing ? 'Uitg.' : 'Ink.'}
                            </span>
                            {/* [BRIDGE-A] Verlopen — computed, display-only */}
                            {isVerlopen(invoice) && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                                style={{ backgroundColor: '#F9DEDC', color: '#B3261E' }}>
                                Verlopen
                              </span>
                            )}
                            {invoice.invoice_type === 'creditnota' && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, backgroundColor: '#FCE8E6', color: '#C5221F', fontWeight: 500 }}>
                                Creditnota
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: '#5F6368', marginTop: 2 }}>
                            {fmt(invoice.invoice_date)}
                            {invoice.marked_paid_at && (
                              <span> · betaald {fmt(invoice.marked_paid_at)}</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p style={{ fontSize: 14, fontWeight: 600, color: amount >= 0 ? '#34A853' : '#EA4335', fontFamily: "'Roboto Mono', monospace" }}>
                            {NL_NUMBER.format(amount)}
                          </p>
                        </div>
                      </div>

                      {/* [BOEK-006] status badge preview (when collapsed) */}
                      {!isExpanded && invoice.accountant_status && (
                        <div className="mt-1.5">
                          <ActionBadge value={invoice.accountant_status} />
                        </div>
                      )}
                    </div>

                    {/* [BOEK-028] Inline expand — no page navigation */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1" onClick={e => e.stopPropagation()}>
                        <div style={{ backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>

                          {/* [BOEK-006] Status actions — 3 states + neutral, one tap */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #E0E0E0' }}>
                            <span style={{ fontSize: 12, color: '#5F6368', fontWeight: 500 }}>Status</span>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              {ACCOUNTANT_ACTIONS.map(a => {
                                const active = invoice.accountant_status === a.value
                                return (
                                  <button key={a.value}
                                    onClick={() => handleAction(invoice.id, active ? null : a.value)}
                                    style={{
                                      padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                      backgroundColor: active ? a.bg : '#FFFFFF',
                                      color: active ? a.color : '#5F6368',
                                      border: active ? `1px solid ${a.color}` : '1px solid #E0E0E0',
                                      cursor: 'pointer',
                                    }}>
                                    {a.label}
                                  </button>
                                )
                              })}
                              {/* neutral — accountant hasn't acted */}
                              <button
                                onClick={() => handleAction(invoice.id, null)}
                                style={{
                                  padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                  backgroundColor: !invoice.accountant_status ? '#E7E0EC' : '#FFFFFF',
                                  color: !invoice.accountant_status ? '#49454F' : '#5F6368',
                                  border: !invoice.accountant_status ? '1px solid #49454F' : '1px solid #E0E0E0',
                                  cursor: 'pointer',
                                }}>
                                Niet verwerkt
                              </button>
                            </div>
                          </div>

                          {/* Client info */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid #E0E0E0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ color: '#5F6368' }}>Aan</span>
                              <span style={{ fontWeight: 500, textAlign: 'right', color: '#202124' }}>
                                {invoice.client_name || '—'}
                              </span>
                            </div>
                            {invoice.client_btw_number && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#5F6368' }}>BTW</span>
                                <span className="font-medium" style={{ fontWeight: 500, color: '#202124' }}>
                                  {invoice.client_btw_number}
                                </span>
                              </div>
                            )}
                            {/* [BOEK-028] replaced_by_number — shown on creditnota — May 2026 */}
                            {invoice.invoice_type === 'creditnota' && invoice.replaced_by_number && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#5F6368' }}>Vervangt</span>
                                <span className="font-medium" style={{ color: '#EA4335' }}>
                                  {invoice.replaced_by_number}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Amounts — sign follows direction */}
                          {[
                            {
                              label: 'Excl. BTW',
                              value: isOutgoing ? invoice.total_ex_btw : -(invoice.total_ex_btw),
                            },
                            {
                              label: `BTW ${getBtwRate(invoice)}%`,
                              value: isOutgoing ? invoice.btw_amount : -(invoice.btw_amount),
                            },
                            {
                              label: 'Incl. BTW',
                              value: amount,
                            },
                          ].map(row => (
                            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ color: '#5F6368' }}>{row.label}</span>
                              <span className="font-semibold"
                                style={{ fontWeight: 500, color: (row.value ?? 0) >= 0 ? '#202124' : '#EA4335', fontFamily: "'Roboto Mono', monospace" }}>
                                {NL_NUMBER.format(row.value ?? 0)}
                              </span>
                            </div>
                          ))}

                          {/* Openen button — only this navigates */}
                          <div className="pt-2">
                            <button
                              onClick={() => router.push(`/dashboard/invoice/${invoice.id}?from=client&clientId=${clientId}&q=${q}&year=${year}`)}
                              style={{ width: '100%', padding: '8px 16px', borderRadius: 8, backgroundColor: '#1A73E8', color: '#FFFFFF', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer' }}>
                              Openen →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}