'use client'

// src/app/dashboard/facturen/page.tsx
// [BOEK-029] Mijn facturen — full invoice table with inline expand — May 2026

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { createNotification } from '@/lib/notifications'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter } from '@/hooks/useInfiniteInvoices'
import { InvoiceTypeBadge } from '@/components/invoice/InvoiceTypeBadge'

// ─── Formatters ───────────────────────────────────────────────────────────────
const NL_EUR  = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE = new Intl.DateTimeFormat('nl-NL')
const fmtEur  = (n: number | null) => NL_EUR.format(n ?? 0)
const fmtDate = (s: string | null) => s ? NL_DATE.format(new Date(s)) : '—'
// [BOEK-029] btw_rate does not exist in DB — always calculate
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

  const [filter, setFilter]         = useState<FilterTab>('all')
  const [sort, setSort]             = useState<SortOrder>('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toast, setToast]           = useState<string | null>(null)
  const [deleteCtx, setDeleteCtx]   = useState<DeleteCtx | null>(null)
  const [payCtx, setPayCtx]         = useState<ConfirmPayCtx | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)

  // [BOEK-029] Archived invoices — fetched separately, shown at end of "Alle" only
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

  // Map FilterTab → InvoiceStatusFilter (hook expects different type)
  const statusMap: Record<FilterTab, InvoiceStatusFilter> = {
    all: 'all', sent: 'sent', paid: 'paid', draft: 'draft',
    overdue: 'overdue', offerte: 'all', credit: 'all',
  }

  const {
    invoices, loading, hasMore, refreshing, loadMore, refresh, updateOptimistic, removeOptimistic,
  } = useInfiniteInvoices({ userId: profile.id, status: statusMap[filter] })

  // Client-side filter — exclude archived from hook results (hook may return them)
  // offerte / credit filtered by invoice_type
  const displayed = invoices.filter(inv => {
    if (inv.status === 'archived') return false   // handled separately below
    if (filter === 'offerte') return inv.invoice_type === 'pro_forma'
    if (filter === 'credit')  return inv.invoice_type === 'creditnota'
    return true
  })

  // Sort toggle (hook already sorts desc; for asc we reverse)
  const sorted = sort === 'desc' ? displayed : [...displayed].reverse()

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ── Pay / Unpay ──────────────────────────────────────────────────────────────
  async function executePay(ctx: ConfirmPayCtx) {
    setPayCtx(null)
    setProcessingId(ctx.id)
    updateOptimistic(ctx.id, { status: ctx.newStatus })
    const patch: any = { status: ctx.newStatus }
    if (ctx.newStatus === 'paid') {
      patch.sent_to_accountant = true
      patch.marked_paid_at = new Date().toISOString()
    }
    const { error } = await supabase.from('invoices').update(patch).eq('id', ctx.id)
    if (error) {
      updateOptimistic(ctx.id, { status: ctx.newStatus === 'paid' ? 'sent' : 'paid' })
    } else if (ctx.newStatus === 'paid') {
      await createNotification({ supabase, userId: profile.id, title: 'Factuur betaald', body: `Factuur ${ctx.number} is gemarkeerd als betaald.`, type: 'payment' })
      showToast(`Factuur ${ctx.number} gemarkeerd als betaald`)
    }
    setProcessingId(null)
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function executeDelete(ctx: DeleteCtx) {
    setDeleteCtx(null)
    removeOptimistic(ctx.id)
    await supabase.from('invoice_lines').delete().eq('invoice_id', ctx.id)
    await supabase.from('invoices').delete().eq('id', ctx.id)
    showToast('Factuur verwijderd')
  }

  async function handleDeleteRequest(id: string, number: string, status: string) {
    if (status === 'paid') {
      // Cannot delete paid — redirect to creditnota
      router.push(`/dashboard/invoice/new?type=creditnota&original=${id}`)
      return
    }
    setDeleteCtx({ id, number, status })
  }

  // ── IntersectionObserver for infinite scroll ──────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && hasMore && !loading) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading])

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--color-bg, #f2f2f7)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>

      {/* ── Header ── */}
      <div style={{
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)',
        borderBottom: '0.5px solid rgba(0,0,0,0.1)',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#007aff', fontWeight: 600, padding: 0, flexShrink: 0 }}>
            ← Terug
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e', flex: 1, textAlign: 'center' }}>Mijn facturen</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Sort toggle */}
            <button onClick={() => setSort(s => s === 'desc' ? 'asc' : 'desc')}
              style={{ background: '#f2f2f7', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, color: '#3c3c43', fontWeight: 500 }}>
              {sort === 'desc' ? '↓ Nieuwste' : '↑ Oudste'}
            </button>
            {/* Refresh */}
            <button onClick={refresh} style={{ background: '#f2f2f7', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 16 }}>
              {refreshing ? '⏳' : '↻'}
            </button>
            {/* New */}
            <button onClick={() => router.push('/dashboard/invoice/new')}
              style={{ background: '#007aff', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 700 }}>
              + Nieuw
            </button>
          </div>
        </div>

        {/* Filter bar — horizontal scroll */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{
                flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: 'none',
                background: filter === f.id ? '#007aff' : '#f2f2f7',
                color: filter === f.id ? '#fff' : '#3c3c43',
                fontSize: 13, fontWeight: filter === f.id ? 700 : 500, cursor: 'pointer',
                transition: 'all 0.15s',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Invoice list ── */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 80px' }}>
        {loading && sorted.length === 0 ? (
          <SkeletonList />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map(inv => {
              const isArchived = inv.status === 'archived'
              const isCredit   = inv.invoice_type === 'creditnota'
              const isOfferte  = inv.invoice_type === 'pro_forma'
              const isPaid     = inv.status === 'paid'
              const isSent     = inv.status === 'sent'
              const expanded   = expandedId === inv.id

              // Row background tint
              const rowBg = isArchived ? '#f9f9fb'
                : isCredit  ? '#fff9f0'
                : isOfferte ? '#f9f9fb'
                : '#fff'

              return (
                <div key={inv.id} style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                  {/* ── Main row ── */}
                  <div
                    onClick={() => !isArchived && setExpandedId(expanded ? null : inv.id)}
                    style={{
                      background: rowBg, padding: '14px 16px',
                      display: 'flex', alignItems: 'center', gap: 12,
                      opacity: isArchived ? 0.45 : 1,
                      cursor: isArchived ? 'default' : 'pointer',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {/* Left: number + client */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#1c1c1e' }}>{inv.invoice_number ?? '—'}</p>
                        <InvoiceTypeBadge type={inv.invoice_type} />
                        {isArchived && inv.replaced_by_number && (
                          <span style={{ fontSize: 10, color: '#8e8e93' }}>Vervangen door {inv.replaced_by_number}</span>
                        )}
                      </div>
                      <p style={{ fontSize: 12, color: '#8e8e93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inv.client_name ?? '—'} · {fmtDate(inv.invoice_date)}
                      </p>
                    </div>

                    {/* Right: amount + action button */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e' }}>
                        {fmtEur(inv.total_inc_btw)}
                      </p>

                      {/* [BOEK-029] Single toggle button per invoice type */}
                      {!isArchived && !isOfferte && !isCredit && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            if (isPaid) {
                              setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'sent' })
                            } else {
                              setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid' })
                            }
                          }}
                          style={{
                            fontSize: 12, fontWeight: 600, borderRadius: 20, border: 'none', cursor: 'pointer', padding: '5px 12px',
                            background: isPaid ? '#e8f9ed' : '#f2f2f7',
                            color: isPaid ? '#34c759' : '#3c3c43',
                            transition: 'all 0.15s',
                          }}
                        >
                          {processingId === inv.id ? '...' : isPaid ? '✓ Betaald' : 'Betaald?'}
                        </button>
                      )}

                      {/* Credit → Voldaan button */}
                      {isCredit && !isArchived && (
                        <button onClick={e => { e.stopPropagation(); setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid' }) }}
                          style={{ fontSize: 12, fontWeight: 600, borderRadius: 20, border: 'none', cursor: 'pointer', padding: '5px 12px', background: isPaid ? '#e8f9ed' : '#fff3e0', color: isPaid ? '#34c759' : '#ff9500' }}>
                          {isPaid ? '✓ Voldaan' : 'Voldaan!'}
                        </button>
                      )}

                      {/* Offerte → Maak factuur */}
                      {isOfferte && (
                        <button onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/new?from_offerte=${inv.id}`) }}
                          style={{ fontSize: 12, fontWeight: 600, borderRadius: 20, border: 'none', cursor: 'pointer', padding: '5px 10px', background: '#e8f1ff', color: '#007aff' }}>
                          Maak factuur aan
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Inline expand ── */}
                  {expanded && !isArchived && (
                    <div style={{ background: '#f9f9fb', borderTop: '0.5px solid #e5e5ea', padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 12 }}>
                        <InfoLine label="Aan" value={inv.client_name} />
                        {inv.client_btw_number && <InfoLine label="BTW" value={inv.client_btw_number} />}
                        <InfoLine label="Excl. BTW" value={fmtEur(inv.total_ex_btw)} />
                        <InfoLine label={`BTW (${calcBtw(inv.btw_amount, inv.total_ex_btw)}%)`} value={fmtEur(inv.btw_amount)} />
                        <InfoLine label="Incl. BTW" value={fmtEur(inv.total_inc_btw)} />
                        {inv.due_date && <InfoLine label="Vervaldatum" value={fmtDate(inv.due_date)} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* Delete */}
                        {!isPaid && (
                          <button
                            onClick={e => { e.stopPropagation(); handleDeleteRequest(inv.id, inv.invoice_number ?? '', inv.status) }}
                            style={{ fontSize: 12, color: '#ff3b30', background: '#fff0ef', border: 'none', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontWeight: 600 }}>
                            Verwijderen
                          </button>
                        )}
                        {/* Open full page */}
                        <button
                          onClick={e => { e.stopPropagation(); router.push(`/dashboard/invoice/${inv.id}`) }}
                          style={{ fontSize: 13, color: '#fff', background: '#007aff', border: 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>
                          Openen →
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
              <p style={{ textAlign: 'center', fontSize: 12, color: '#8e8e93', padding: '12px 0' }}>Laden...</p>
            )}

            {/* [BOEK-029] Archived invoices — shown at end, only in "Alle" filter */}
            {filter === 'all' && archivedInvoices.length > 0 && (
              <>
                <div style={{ padding: '8px 4px 4px' }}>
                  <p style={{ fontSize: 11, color: '#c7c7cc', fontWeight: 500 }}>Gearchiveerd</p>
                </div>
                {archivedInvoices.map(inv => (
                  <div key={inv.id} style={{
                    borderRadius: 14, overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    opacity: 0.4,
                  }}>
                    <div style={{
                      background: '#f9f9fb', padding: '12px 16px',
                      display: 'flex', alignItems: 'center', gap: 12,
                      cursor: 'default',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>
                          {inv.invoice_number ?? '—'}
                        </p>
                        {inv.replaced_by_number && (
                          <p style={{ fontSize: 11, color: '#8e8e93' }}>
                            Vervangen door {inv.replaced_by_number}
                          </p>
                        )}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#8e8e93' }}>
                        {fmtEur(inv.total_inc_btw)}
                      </p>
                      {/* No action buttons — display only */}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>

      {/* ── [BOEK-029] Confirm Betaald dialog ── */}
      {payCtx && (
        <BottomSheet
          title={payCtx.newStatus === 'paid' ? 'Factuur markeren als betaald?' : 'Betaling ongedaan maken?'}
          body={payCtx.newStatus === 'paid'
            ? `Factuur ${payCtx.number} wordt als betaald gemarkeerd en doorgestuurd naar uw accountant. Weet u het zeker?`
            : `Factuur ${payCtx.number} wordt teruggeplaatst naar 'Verzonden'.`}
          confirmLabel={payCtx.newStatus === 'paid' ? 'Ja, markeer als betaald' : 'Ongedaan maken'}
          confirmColor={payCtx.newStatus === 'paid' ? '#34c759' : '#ff9500'}
          onConfirm={() => executePay(payCtx)}
          onCancel={() => setPayCtx(null)}
        />
      )}

      {/* ── [BOEK-029] Delete dialog — 3 states ── */}
      {deleteCtx && (
        <BottomSheet
          title={deleteCtx.status === 'sent' ? 'Factuur verwijderen?' : 'Concept verwijderen?'}
          body={deleteCtx.status === 'sent'
            ? `Factuur ${deleteCtx.number} is al verzonden naar de klant. Weet je zeker dat je deze wilt verwijderen?`
            : `Factuur ${deleteCtx.number} wordt permanent verwijderd.`}
          confirmLabel={deleteCtx.status === 'sent' ? 'Ja, toch verwijderen' : 'Verwijderen'}
          confirmColor="#ff3b30"
          onConfirm={() => executeDelete(deleteCtx)}
          onCancel={() => setDeleteCtx(null)}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(28,28,30,0.88)', color: '#fff', fontSize: 13, fontWeight: 600,
          padding: '10px 20px', borderRadius: 20, zIndex: 300,
          backdropFilter: 'blur(10px)', whiteSpace: 'nowrap', animation: 'fadeInUp 0.2s ease',
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes shimmer { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '20', borderRadius: 6, padding: '2px 6px' }}>
      {label}
    </span>
  )
}

function InfoLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 10, color: '#8e8e93', marginBottom: 1 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e' }}>{value}</p>
    </div>
  )
}

function BottomSheet({ title, body, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; confirmColor: string
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px max(env(safe-area-inset-bottom,0px),24px)', width: '100%', maxWidth: 480, boxShadow: '0 -4px 30px rgba(0,0,0,0.12)' }}>
        <p style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e', marginBottom: 8, textAlign: 'center' }}>{title}</p>
        <p style={{ fontSize: 14, color: '#8e8e93', textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>{body}</p>
        <button onClick={onConfirm} style={{ width: '100%', padding: '14px', borderRadius: 14, background: confirmColor, color: '#fff', fontSize: 16, fontWeight: 700, border: 'none', cursor: 'pointer', marginBottom: 10 }}>{confirmLabel}</button>
        <button onClick={onCancel} style={{ width: '100%', padding: '14px', borderRadius: 14, background: '#f2f2f7', color: '#1c1c1e', fontSize: 16, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Annuleren</button>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.06)', marginTop: 8 }}>
      <p style={{ fontSize: 40, marginBottom: 10 }}>📄</p>
      <p style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e', marginBottom: 4 }}>Geen facturen</p>
      <p style={{ fontSize: 13, color: '#8e8e93' }}>Maak je eerste factuur aan</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{ height: 66, borderRadius: 14, background: 'linear-gradient(90deg,#f2f2f7 25%,#e5e5ea 50%,#f2f2f7 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      ))}
    </div>
  )
}