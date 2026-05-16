'use client'

// src/app/dashboard/clients/[id]/kwartaal/page.tsx
// [BOEK-028] Kwartaal page — per client, per quarter — May 2026
// Accessible via: /dashboard/clients/[id]/kwartaal?q=1&year=2026
// Shows paid invoices (outgoing + incoming) filtered by quarter
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
  { value: 'verwerkt',       label: 'Verwerkt',        bg: '#d1fae5', color: '#065f46', rowBg: '#f0fdf4' },
  { value: 'in_behandeling', label: 'In behandeling',  bg: '#fef3c7', color: '#92400e', rowBg: '#fffbeb' },
  { value: 'vraag',          label: 'Vraag',           bg: '#dbeafe', color: '#1e40af', rowBg: '#eff6ff' },
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

// ─────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────

function ActionBadge({ value }: { value: string | null }) {
  const a = ACCOUNTANT_ACTIONS.find(x => x.value === value)
  if (!a) return (
    <span className="text-xs px-2 py-0.5 rounded-full"
      style={{ backgroundColor: '#f2f2f7', color: '#8e8e93' }}>—</span>
  )
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: a.bg, color: a.color }}>
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
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Client profile
      const { data: clientData } = await supabase
        .from('profiles').select('*').eq('id', clientId).single()
      if (clientData) setClient(clientData)

      // [BOEK-028] Two queries — outgoing + incoming — merged into one table
      // Outgoing: sender_id = clientId, direction = outgoing, status = paid
      const { data: outgoing } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .eq('sender_id', clientId)
        .eq('direction', 'outgoing')
        .in('status', ['paid', 'voldaan'])
        .gte('invoice_date', dateStart)
        .lte('invoice_date', dateEnd)

      // Incoming: receiver_id = clientId, direction = incoming, status = paid
      const { data: incoming } = await supabase
        .from('invoices')
        .select('*, invoice_lines(*), invoice_type, replaced_by_number')
        .eq('receiver_id', clientId)
        .eq('direction', 'incoming')
        .in('status', ['paid', 'voldaan'])
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

  // Totals for header summary
  const totalIn  = invoices.filter(i => i.direction === 'outgoing').reduce((s, i) => s + (i.total_inc_btw || 0), 0)
  const totalOut = invoices.filter(i => i.direction === 'incoming').reduce((s, i) => s + (i.total_inc_btw || 0), 0)
  const totalBtw = invoices.reduce((s, i) => s + (i.btw_amount || 0), 0)

  // [BOEK-028] accountant_status update
  // [BOEK-028] accountant_status update
  // Creditnota + verwerkt → also set status = 'voldaan' — May 2026
  async function handleAction(invoiceId: string, action: ActionValue) {
    setUpdatingId(invoiceId)
    setOpenDropdownId(null)

    const invoice = invoices.find(i => i.id === invoiceId)
    const isCreditnota = invoice?.invoice_type === 'creditnota'
    const update: Record<string, string> = { accountant_status: action }

    // [BOEK-028] Creditnota verwerkt → status wordt voldaan
    if (isCreditnota && action === 'verwerkt') {
      update.status = 'voldaan'
    }

    setInvoices(prev => prev.map(i =>
      i.id === invoiceId ? { ...i, accountant_status: action, ...(update.status ? { status: update.status } : {}) } : i
    ))
    await supabase.from('invoices').update(update).eq('id', invoiceId)
    setUpdatingId(null)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg, #f2f2f7)' }}>
      <p className="text-sm" style={{ color: '#8e8e93' }}>Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg, #f2f2f7)' }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-20 px-4 py-3 border-b"
        style={{ backgroundColor: 'var(--color-card, #fff)', borderColor: 'var(--color-separator, #e5e5ea)' }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push(`/dashboard/clients/${clientId}`)}
              className="text-sm font-medium flex-shrink-0" style={{ color: '#007aff' }}>
              ← Terug
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold truncate" style={{ color: '#1c1c1e' }}>
                Q{q} {year} — {client?.company_name || client?.full_name}
              </h1>
              <p className="text-xs" style={{ color: '#8e8e93' }}>{range.label}</p>
            </div>
          </div>
          <button
            onClick={() => setSortAsc(p => !p)}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl flex-shrink-0"
            style={{ backgroundColor: '#f2f2f7', color: '#007aff' }}>
            {sortAsc ? 'Oudste ↑' : 'Nieuwste ↓'}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* [BOEK-028] Top action buttons: PDF Bank | CAMT | KW | Documenten */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { key: 'pdf_bank',   label: 'PDF Bank',   icon: '📄', color: '#007aff' },
            { key: 'camt',       label: 'CAMT',       icon: '🏦', color: '#34c759' },
            { key: 'kw',         label: 'KW',         icon: '📊', color: '#af52de' },
            { key: 'documenten', label: 'Documenten', icon: '📂', color: '#ff6b00' },
          ].map(btn => (
            <button
              key={btn.key}
              onClick={() => {
                if (btn.key === 'documenten')
                  router.push(`/dashboard/documents?clientId=${clientId}`)
                else
                  alert(`${btn.label} — koppeling volgt in BOEK-016`)
              }}
              className="flex flex-col items-center gap-1.5 py-3 rounded-2xl active:opacity-70 transition-opacity"
              style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
            >
              <span className="text-xl">{btn.icon}</span>
              <span className="text-xs font-semibold" style={{ color: btn.color }}>{btn.label}</span>
            </button>
          ))}
        </div>

        {/* Quarter summary */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Inkomsten',  value: NL_NUMBER.format(totalIn),  color: '#34c759' },
            { label: 'Uitgaven',   value: NL_NUMBER.format(totalOut), color: '#ff3b30' },
            { label: 'BTW totaal', value: NL_NUMBER.format(totalBtw), color: '#af52de' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-3 text-center"
              style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <p className="text-xs mb-0.5" style={{ color: '#8e8e93' }}>{s.label}</p>
              <p className="text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* [BOEK-028] Invoice table — outgoing + incoming merged */}
        <div className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>

          <div className="px-4 py-4 border-b"
            style={{ borderColor: 'var(--color-separator, #e5e5ea)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#1c1c1e' }}>
              Facturen
              <span className="text-sm font-normal ml-1.5" style={{ color: '#8e8e93' }}>
                ({invoices.length})
              </span>
            </h2>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-center py-12" style={{ color: '#8e8e93' }}>
              Geen betaalde facturen in Q{q} {year}
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-separator, #e5e5ea)' }}>
              {sorted.map(invoice => {
                const amount      = getAmount(invoice)
                const isExpanded  = expandedId === invoice.id
                const isDropdown  = openDropdownId === invoice.id
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
                        setOpenDropdownId(null)
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate" style={{ color: '#1c1c1e' }}>
                              {invoice.invoice_number}
                            </p>
                            {/* direction badge */}
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                              style={{
                                backgroundColor: isOutgoing ? '#d1fae5' : '#fee2e2',
                                color: isOutgoing ? '#065f46' : '#991b1b',
                              }}>
                              {isOutgoing ? 'Uitg.' : 'Ink.'}
                            </span>
                            {invoice.invoice_type === 'creditnota' && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                                style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                                Creditnota
                              </span>
                            )}
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: '#8e8e93' }}>
                            {fmt(invoice.invoice_date)}
                            {invoice.marked_paid_at && (
                              <span> · betaald {fmt(invoice.marked_paid_at)}</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <p className="text-sm font-bold"
                            style={{ color: amount >= 0 ? '#34c759' : '#ff3b30' }}>
                            {NL_NUMBER.format(amount)}
                          </p>
                          {/* ••• dropdown trigger */}
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              setOpenDropdownId(isDropdown ? null : invoice.id)
                              setExpandedId(null)
                            }}
                            className="text-sm px-1.5 py-0.5 rounded-lg"
                            style={{ backgroundColor: '#f2f2f7', color: '#8e8e93' }}
                          >
                            •••
                          </button>
                        </div>
                      </div>

                      {/* [BOEK-028] Inline action dropdown — 3 options only */}
                      {isDropdown && (
                        <div className="mt-2 grid grid-cols-3 gap-2"
                          onClick={e => e.stopPropagation()}>
                          {ACCOUNTANT_ACTIONS.map(a => (
                            <button key={a.value}
                              onClick={() => handleAction(invoice.id, a.value)}
                              className="py-2 rounded-xl text-xs font-semibold active:opacity-70"
                              style={{ backgroundColor: a.bg, color: a.color }}>
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Current status badge (shown when dropdown is closed) */}
                      {!isDropdown && invoice.accountant_status && (
                        <div className="mt-1.5">
                          <ActionBadge value={invoice.accountant_status} />
                        </div>
                      )}
                    </div>

                    {/* [BOEK-028] Inline expand — no page navigation */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1" onClick={e => e.stopPropagation()}>
                        <div className="rounded-2xl p-4 space-y-2"
                          style={{ backgroundColor: '#f2f2f7' }}>

                          {/* Client info */}
                          <div className="space-y-1 pb-2 border-b" style={{ borderColor: '#e5e5ea' }}>
                            <div className="flex justify-between text-xs">
                              <span style={{ color: '#8e8e93' }}>Aan</span>
                              <span className="font-semibold text-right" style={{ color: '#1c1c1e' }}>
                                {invoice.client_name || '—'}
                              </span>
                            </div>
                            {invoice.client_btw_number && (
                              <div className="flex justify-between text-xs">
                                <span style={{ color: '#8e8e93' }}>BTW</span>
                                <span className="font-medium" style={{ color: '#1c1c1e' }}>
                                  {invoice.client_btw_number}
                                </span>
                              </div>
                            )}
                            {/* [BOEK-028] replaced_by_number — shown on creditnota — May 2026 */}
                            {invoice.invoice_type === 'creditnota' && invoice.replaced_by_number && (
                              <div className="flex justify-between text-xs">
                                <span style={{ color: '#8e8e93' }}>Vervangt</span>
                                <span className="font-medium" style={{ color: '#ff3b30' }}>
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
                            <div key={row.label} className="flex justify-between text-xs">
                              <span style={{ color: '#8e8e93' }}>{row.label}</span>
                              <span className="font-semibold"
                                style={{ color: (row.value ?? 0) >= 0 ? '#1c1c1e' : '#ff3b30' }}>
                                {NL_NUMBER.format(row.value ?? 0)}
                              </span>
                            </div>
                          ))}

                          {/* Openen button — only this navigates */}
                          <div className="pt-2">
                            <button
                              onClick={() => router.push(`/dashboard/invoice/${invoice.id}`)}
                              className="w-full text-xs font-semibold py-2 rounded-xl"
                              style={{ backgroundColor: '#007aff', color: '#fff' }}>
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
          )}
        </div>

      </div>
    </div>
  )
}