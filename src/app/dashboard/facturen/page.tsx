'use client'

// src/app/dashboard/facturen/page.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { createNotification } from '@/lib/notifications'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'
import { InvoiceTypeBadge } from '@/components/invoice/InvoiceTypeBadge'

// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const M3 = {
  primary:           '#1A73E8',
  onPrimary:         '#FFFFFF',
  primaryContainer:  '#D3E3FD',
  onPrimaryContainer:'#041E49',
  surface:           '#FFFBFE',
  onSurface:         '#1C1B1F',
  surfaceVariant:    '#E7E0EC',
  outline:           '#79747E',
  error:             '#B3261E',
  errorContainer:    '#F9DEDC',
  success:           '#34A853',
  successContainer:  '#CEEAD6',
  warning:           '#E37400',
  warningContainer:  '#FEE8C4',
}
const FONT     = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const R = { sm: 8, md: 12, lg: 16, full: 9999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

// Status chip colors — Material You
const CHIP: Record<string, { bg: string; color: string }> = {
  paid:    { bg: '#CEEAD6', color: '#137333' },
  sent:    { bg: '#D3E3FD', color: '#1967D2' },
  overdue: { bg: '#F9DEDC', color: '#B3261E' },
  draft:   { bg: '#E7E0EC', color: '#49454F' },
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const NL_EUR  = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' })
const fmtEur  = (n: number | null) => NL_EUR.format(n ?? 0)
const fmtDate = (s: string | null) => s ? NL_DATE.format(new Date(s)) : '—'
// [BOEK-029] btw_rate does not exist in DB
const calcBtw = (btw: number | null, ex: number | null) =>
  ex && ex > 0 ? Math.round(((btw ?? 0) / ex) * 100) : 21

// ─── Types ────────────────────────────────────────────────────────────────────
type SortOrder = 'desc' | 'asc'
type FilterTab = 'all' | 'sent' | 'paid' | 'draft' | 'overdue' | 'offerte' | 'credit'
interface DeleteCtx { id: string; number: string; status: string }
interface ConfirmPayCtx { id: string; number: string; newStatus: 'paid' | 'sent' }

const FILTERS: { id: FilterTab; label: string }[] = [
  { id: 'all',     label: 'Alle'     },
  { id: 'sent',    label: 'Verzonden'},
  { id: 'paid',    label: 'Betaald'  },
  { id: 'draft',   label: 'Concept'  },
  { id: 'overdue', label: 'Verlopen' },
  { id: 'offerte', label: 'Offerte'  },
  { id: 'credit',  label: 'Credit'   },
]

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FacturenPage({ profile }: { profile: any }) {
  const router   = useRouter()
  const supabase = createClient()

  const [filter, setFilter]             = useState<FilterTab>('all')
  const [sort, setSort]                 = useState<SortOrder>('desc')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [deleteCtx, setDeleteCtx]       = useState<DeleteCtx | null>(null)
  const [payCtx, setPayCtx]             = useState<ConfirmPayCtx | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)

  // [BOEK-029] Archived — separate fetch, shown at end of "Alle" only
  const [archivedInvoices, setArchivedInvoices] = useState<any[]>([])

  useEffect(() => {
    supabase
      .from('invoices')
      .select('id, invoice_number, total_inc_btw, replaced_by_number, invoice_date, invoice_type')
      .eq('sender_id', profile.id)
      .eq('status', 'archived')
      .order('created_at', { ascending: false })
      .then(({ data }) => setArchivedInvoices(data ?? []))
  }, [])

  const statusMap: Record<FilterTab, InvoiceStatusFilter> = {
    all: 'all', sent: 'sent', paid: 'paid', draft: 'draft',
    overdue: 'overdue', offerte: 'all', credit: 'all',
  }

  const {
    invoices, loading, hasMore, refreshing,
    loadMore, refresh, updateOptimistic, removeOptimistic,
  } = useInfiniteInvoices({ userId: profile.id, status: statusMap[filter] })

  const displayed = invoices.filter(inv => {
    if (inv.status === 'archived') return false
    if (filter === 'offerte') return inv.invoice_type === 'pro_forma'
    if (filter === 'credit')  return inv.invoice_type === 'creditnota'
    return true
  })
  const sorted = sort === 'desc' ? displayed : [...displayed].reverse()

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  async function executePay(ctx: ConfirmPayCtx) {
    setPayCtx(null); setProcessingId(ctx.id)
    updateOptimistic(ctx.id, { status: ctx.newStatus })
    const patch: any = { status: ctx.newStatus }
    if (ctx.newStatus === 'paid') { patch.sent_to_accountant = true; patch.marked_paid_at = new Date().toISOString() }
    const { error } = await supabase.from('invoices').update(patch).eq('id', ctx.id)
    if (error) {
      updateOptimistic(ctx.id, { status: ctx.newStatus === 'paid' ? 'sent' : 'paid' })
    } else if (ctx.newStatus === 'paid') {
      await createNotification({ supabase, userId: profile.id, title: 'Factuur betaald', body: `Factuur ${ctx.number} is gemarkeerd als betaald.`, type: 'payment' })
      showToast(`Factuur ${ctx.number} betaald ✓`)
    }
    setProcessingId(null)
  }

  async function executeDelete(ctx: DeleteCtx) {
    setDeleteCtx(null)
    removeOptimistic(ctx.id)
    await supabase.from('invoice_lines').delete().eq('invoice_id', ctx.id)
    await supabase.from('invoices').delete().eq('id', ctx.id)
    showToast('Factuur verwijderd')
  }

  async function handleDeleteRequest(id: string, number: string, status: string) {
    if (status === 'paid') { router.push(`/dashboard/invoice/new?type=creditnota&original=${id}`); return }
    setDeleteCtx({ id, number, status })
  }

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && hasMore && !loading) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Top App Bar ── */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, color: M3.primary, fontWeight: 600, fontSize: 14, padding: 0, fontFamily: FONT }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: M3.onSurface, flex: 1, textAlign: 'center' }}>Mijn facturen</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Sort */}
            <button onClick={() => setSort(s => s === 'desc' ? 'asc' : 'desc')}
              style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#49454F', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{sort === 'desc' ? 'arrow_downward' : 'arrow_upward'}</span>
              {sort === 'desc' ? 'Nieuwste' : 'Oudste'}
            </button>
            {/* Refresh */}
            <button onClick={refresh} style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#49454F' }}>{refreshing ? 'hourglass_empty' : 'refresh'}</span>
            </button>
          </div>
        </div>

        {/* Filter chips — Material You */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              flexShrink: 0, padding: '6px 16px', borderRadius: R.full,
              border: filter === f.id ? 'none' : `1px solid #79747E`,
              background: filter === f.id ? M3.primaryContainer : 'transparent',
              color: filter === f.id ? M3.onPrimaryContainer : '#49454F',
              fontSize: 13, fontWeight: filter === f.id ? 600 : 400,
              cursor: 'pointer', fontFamily: FONT,
              transition: 'all 0.15s',
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Invoice list ── */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 100px' }}>
        {loading && sorted.length === 0 ? (
          <SkeletonList />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map(inv => {
              const isCredit  = inv.invoice_type === 'creditnota'
              const isOfferte = inv.invoice_type === 'pro_forma'
              const isPaid    = inv.status === 'paid'
              const expanded  = expandedId === inv.id
              const totalExBtw = (inv as any).total_ex_btw ?? null
              const btwAmount = (inv as any).btw_amount ?? (typeof inv.total_inc_btw === 'number' && typeof totalExBtw === 'number'
                ? inv.total_inc_btw - totalExBtw
                : null)
              const invoiceType = inv.invoice_type === 'creditnota' ? 'creditnota'
                : inv.invoice_type === 'pro_forma' ? 'pro_forma'
                : 'factuur'

              // Row tint
              const rowBg = isCredit ? '#FFF8F0' : isOfferte ? '#F8F9FA' : '#fff'

              return (
                <div key={inv.id} style={{ borderRadius: R.lg, overflow: 'hidden', boxShadow: EL1 }}>
                  {/* Main row */}
                  <div
                    onClick={() => setExpandedId(expanded ? null : inv.id)}
                    style={{ background: rowBg, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM }}>{inv.invoice_number ?? '—'}</p>
                        <InvoiceTypeBadge type={invoiceType} />
                        {/* Status chip */}
                        {CHIP[inv.status] && (
                          <span style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: CHIP[inv.status].bg, color: CHIP[inv.status].color }}>
                            {inv.status === 'paid' ? 'Betaald' : inv.status === 'sent' ? 'Verzonden' : inv.status === 'overdue' ? 'Verlopen' : 'Concept'}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: '#5F6368', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inv.client_name ?? '—'} · {fmtDate(inv.invoice_date)}
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, fontFamily: FONT_NUM }}>
                        {fmtEur(inv.total_inc_btw)}
                      </p>

                      {/* [BOEK-029] Single toggle button — Material You tonal */}
                      {!isOfferte && !isCredit && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: isPaid ? 'sent' : 'paid' })
                          }}
                          style={{
                            fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none',
                            cursor: 'pointer', padding: '6px 14px', fontFamily: FONT,
                            background: isPaid ? M3.successContainer : M3.surfaceVariant,
                            color: isPaid ? '#137333' : '#49454F',
                            display: 'flex', alignItems: 'center', gap: 4,
                            transition: 'all 0.15s',
                          }}
                        >
                          {processingId === inv.id ? (
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                          ) : isPaid ? (
                            <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span> Betaald</>
                          ) : (
                            'Betaald?'
                          )}
                        </button>
                      )}

                      {isCredit && (
                        <button onClick={e => { e.stopPropagation(); setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid' }) }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: isPaid ? M3.successContainer : '#FEF7E0', color: isPaid ? '#137333' : '#EA8600' }}>
                          {isPaid ? '✓ Voldaan' : 'Voldaan!'}
                        </button>
                      )}

                      {isOfferte && (
                        <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/new?from_offerte=${inv.id}`) }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer }}>
                          Maak factuur aan
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline expand — Material You surface variant */}
                  {expanded && (
                    <div style={{ background: '#F8F9FA', borderTop: `1px solid ${M3.surfaceVariant}`, padding: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 16 }}>
                        <InfoLine label="Aan"       value={inv.client_name} />
                        {(inv as any).client_btw_number && <InfoLine label="BTW" value={(inv as any).client_btw_number} />}
                        <InfoLine label="Excl. BTW" value={fmtEur(totalExBtw)} mono />
                        <InfoLine label={`BTW (${calcBtw(btwAmount, totalExBtw)}%)`} value={fmtEur(btwAmount)} mono />
                        <InfoLine label="Incl. BTW" value={fmtEur(inv.total_inc_btw)} mono />
                        {inv.due_date && <InfoLine label="Vervaldatum" value={fmtDate(inv.due_date)} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {!isPaid && (
                          <button
                            onClick={e => { e.stopPropagation(); handleDeleteRequest(inv.id, inv.invoice_number ?? '', inv.status) }}
                            style={{ fontSize: 13, color: M3.error, background: M3.errorContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                            Verwijderen
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/${inv.id}`) }}
                          style={{ fontSize: 13, color: M3.onPrimary, background: M3.primary, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                          Openen
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loading && sorted.length > 0 && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#5F6368', padding: '16px 0' }}>Laden...</p>
            )}

            {/* [BOEK-029] Archived — end of Alle only, no buttons */}
            {filter === 'all' && archivedInvoices.length > 0 && (
              <>
                <div style={{ padding: '8px 4px 2px' }}>
                  <p style={{ fontSize: 11, color: '#9AA0A6', fontWeight: 500, letterSpacing: 0.4 }}>GEARCHIVEERD</p>
                </div>
                {archivedInvoices.map(inv => (
                  <div key={inv.id} style={{ borderRadius: R.lg, overflow: 'hidden', boxShadow: EL1, opacity: 0.4 }}>
                    <div style={{ background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'default' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM }}>{inv.invoice_number ?? '—'}</p>
                        {inv.replaced_by_number && (
                          <p style={{ fontSize: 12, color: '#5F6368' }}>Vervangen door {inv.replaced_by_number}</p>
                        )}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#5F6368', fontFamily: FONT_NUM }}>{fmtEur(inv.total_inc_btw)}</p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>

      {/* ── [BOEK-029] FAB — fixed bottom-right — Material You ── */}
      <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: `calc(24px + env(safe-area-inset-bottom))`,
          right: 20,
          background: M3.primaryContainer,
          color: M3.onPrimaryContainer,
          borderRadius: R.lg,
          padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.95)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
        Nieuwe factuur
      </button>

      {/* ── Betaald dialog ── */}
      {payCtx && (
        <BottomSheet
          title={payCtx.newStatus === 'paid' ? 'Factuur markeren als betaald?' : 'Betaling ongedaan maken?'}
          body={payCtx.newStatus === 'paid'
            ? `Factuur ${payCtx.number} wordt als betaald gemarkeerd en doorgestuurd naar uw accountant. Weet u het zeker?`
            : `Factuur ${payCtx.number} wordt teruggeplaatst naar 'Verzonden'.`}
          confirmLabel={payCtx.newStatus === 'paid' ? 'Ja, markeer als betaald' : 'Ongedaan maken'}
          confirmBg={payCtx.newStatus === 'paid' ? M3.success : M3.warning}
          onConfirm={() => executePay(payCtx)}
          onCancel={() => setPayCtx(null)}
        />
      )}

      {/* ── Delete dialog ── */}
      {deleteCtx && (
        <BottomSheet
          title={deleteCtx.status === 'sent' ? 'Factuur verwijderen?' : 'Concept verwijderen?'}
          body={deleteCtx.status === 'sent'
            ? `Factuur ${deleteCtx.number} is al verzonden naar de klant. Weet je zeker dat je deze wilt verwijderen?`
            : `Factuur ${deleteCtx.number} wordt permanent verwijderd.`}
          confirmLabel={deleteCtx.status === 'sent' ? 'Ja, toch verwijderen' : 'Verwijderen'}
          confirmBg={M3.error}
          onConfirm={() => executeDelete(deleteCtx)}
          onCancel={() => setDeleteCtx(null)}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: '#1C1B1F', color: '#fff', fontSize: 13, fontWeight: 500,
          padding: '12px 20px', borderRadius: R.sm, zIndex: 300,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
          animation: 'fadeInUp 0.2s ease', fontFamily: FONT,
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes shimmer  { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoLine({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2, fontWeight: 500 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1C1B1F', fontFamily: mono ? "'Roboto Mono', monospace" : 'inherit' }}>{value}</p>
    </div>
  )
}

function BottomSheet({ title, body, confirmLabel, confirmBg, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; confirmBg: string
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#FFFBFE', borderRadius: '28px 28px 0 0', padding: '28px 20px max(env(safe-area-inset-bottom,0px),24px)', width: '100%', maxWidth: 480, boxShadow: '0 -4px 30px rgba(0,0,0,0.12)' }}>
        {/* Handle */}
        <div style={{ width: 32, height: 4, borderRadius: 2, background: '#79747E', margin: '0 auto 20px', opacity: 0.4 }} />
        <p style={{ fontSize: 18, fontWeight: 600, color: '#1C1B1F', marginBottom: 10, textAlign: 'center', fontFamily: FONT }}>{title}</p>
        <p style={{ fontSize: 14, color: '#49454F', textAlign: 'center', marginBottom: 28, lineHeight: 1.5, fontFamily: FONT }}>{body}</p>
        <button onClick={onConfirm} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}>{confirmLabel}</button>
        <button onClick={onCancel}  style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Annuleren</button>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, marginTop: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#C4C7C5', display: 'block', marginBottom: 12 }}>receipt_long</span>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1B1F', marginBottom: 4, fontFamily: FONT }}>Geen facturen</p>
      <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>Maak je eerste factuur aan</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{ height: 72, borderRadius: R.lg, background: 'linear-gradient(90deg,#F8F9FA 25%,#E8EAED 50%,#F8F9FA 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      ))}
    </div>
  )
}