'use client'

// src/app/dashboard/incoming/manage/IncomingManageClient.tsx
// [BRIDGE-POLISH 3b] Incoming-invoice MANAGEMENT surface — the owner's view of
// CONFIRMED incoming invoices (Crediteuren). Mirrors FacturenClient 1:1 in
// structure + Material You tokens (BoekBrug Design System v1.0). This is a
// ZZP/owner path (the cashier on their phone, per identity v3) → Material You,
// mobile-first. NOT the verification queue (that stays in IncomingInvoicesClient).
//
// Design law: ZZP/owner surface → Material You (#1A73E8, rounded). No iOS here.
//
// What it does:
//   - lists received (unpaid Crediteur) + paid incoming invoices
//   - mark paid  (received → paid)   → asks Bank/Contant + payment date
//   - undo paid  (paid → received)   → clears method/date
//   - shows the accountant's 'Verwerkt' state READ-ONLY (3b-2)
//   - B.4: if the trigger blocks a change because the invoice is 'verwerkt',
//     surface the same "ask the accountant to undo" dialog as the outgoing flow
//
// Financial write path rule (hard): session client only (auth.uid() = receiver
// → B.4 receiver-exclusion fires → write passes). NEVER service_role here.
// Defense in depth: the update touches ONLY payment fields — never amounts.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useParentPath } from '@/lib/navigation-hooks'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'

// ─── Design tokens — BoekBrug Design System v1.0 (Material You) ───────────────
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
const CHIP: Record<string, { bg: string; color: string; label: string }> = {
  received: { bg: '#FEE8C4', color: '#7C5800', label: 'Te betalen' },
  paid:     { bg: '#CEEAD6', color: '#137333', label: 'Betaald'   },
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const NL_EUR  = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const NL_DATE = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' })
const fmtEur  = (n: number | null) => NL_EUR.format(n ?? 0)
const fmtDate = (s: string | null) => s ? NL_DATE.format(new Date(s)) : '—'
// [BOEK-029] btw_rate does not exist in DB — always compute
const calcBtw = (btw: number | null, ex: number | null) =>
  ex && ex > 0 ? Math.round(((btw ?? 0) / ex) * 100) : 21

// ─── Types ────────────────────────────────────────────────────────────────────
interface IncomingRow {
  id: string
  invoice_number: string | null
  client_name: string | null            // supplier/vendor for incoming
  status: string                         // 'received' | 'paid'
  accountant_status: string | null       // 'verwerkt' etc. — read-only badge
  direction: string
  total_inc_btw: number | null
  total_ex_btw: number | null
  btw_amount: number | null
  invoice_date: string | null
  due_date: string | null
  payment_method: 'bank' | 'kas' | null
  payment_date: string | null
  created_at: string
  document_id: string | null
  pdf_url: string | null
}

// Pay confirm context — payment fields only (defense in depth: never amounts)
interface PayCtx {
  id: string
  number: string
  newStatus: 'paid' | 'received'
  paymentMethod?: 'bank' | 'kas'
  paymentDate?: string
}

type FilterTab = 'all' | 'received' | 'paid'
const FILTERS: { id: FilterTab; label: string }[] = [
  { id: 'all',      label: 'Alle'       },
  { id: 'received', label: 'Te betalen' },
  { id: 'paid',     label: 'Betaald'    },
]

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IncomingManageClient({
  profile,
  initialInvoices,
}: { profile: any; initialInvoices: IncomingRow[] }) {
  const router   = useRouter()
  const supabase = createClient()
  const parentHref = useParentPath(profile.role ?? 'zzper')

  const [invoices, setInvoices]         = useState<IncomingRow[]>(initialInvoices)
  const [filter, setFilter]             = useState<FilterTab>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [payCtx, setPayCtx]             = useState<PayCtx | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  // [BOEK-004] dialog when a change is blocked because the accountant verwerkt it
  const [verwerktCtx, setVerwerktCtx]   = useState<{ id: string; number: string } | null>(null)
  const [requestSent, setRequestSent]   = useState(false)

  const displayed = invoices.filter(inv => {
    if (filter === 'all') return true
    return inv.status === filter
  })

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // Local optimistic patch (no hook — this surface owns its list)
  function patchLocal(id: string, patch: Partial<IncomingRow>) {
    setInvoices(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  // ── Mark paid / undo — session client, PAYMENT FIELDS ONLY ──
  async function executePay(ctx: PayCtx) {
    setPayCtx(null); setProcessingId(ctx.id)
    patchLocal(ctx.id, { status: ctx.newStatus })

    // Tight, specific update: status + payment fields. Never amounts (B.4 guards
    // them, and we don't even include them). Session client → auth.uid()=receiver
    // → B.4 receiver-exclusion fires → write passes for a non-verwerkt invoice.
    const patch: Record<string, any> = { status: ctx.newStatus }
    if (ctx.newStatus === 'paid') {
      patch.payment_method = ctx.paymentMethod ?? 'bank'
      patch.marked_paid_at = new Date().toISOString()
      patch.payment_date   = ctx.paymentDate ?? new Date().toISOString().slice(0, 10)
    } else {
      patch.payment_method = null
      patch.marked_paid_at = null
      patch.payment_date   = null
    }

    const { error } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', ctx.id)
      .eq('receiver_id', profile.id)        // ownership guard (incoming → receiver)
      .eq('direction', 'incoming')

    if (error) {
      // rollback optimistic
      const prev = ctx.newStatus === 'paid' ? 'received' : 'paid'
      patchLocal(ctx.id, { status: prev })
      // [BOEK-004] verwerkt conflict (trigger) → actionable dialog; else toast
      if (error.message && error.message.includes('verwerkt')) {
        setRequestSent(false)
        setVerwerktCtx({ id: ctx.id, number: ctx.number })
      } else {
        showToast(error.message || 'Bijwerken mislukt')
      }
    } else if (ctx.newStatus === 'paid') {
      // reflect the new payment fields locally
      patchLocal(ctx.id, {
        payment_method: patch.payment_method,
        payment_date: patch.payment_date,
      })
      // Notify the user — confirmation (service role via API; non-blocking)
      try {
        await fetch('/api/notifications/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Inkoopfactuur betaald',
            body: `Inkoopfactuur ${ctx.number} is gemarkeerd als betaald.`,
            type: 'payment',
          }),
        })
      } catch { /* non-blocking — payment already succeeded */ }
      showToast(`Inkoopfactuur ${ctx.number} betaald ✓`)
    } else {
      patchLocal(ctx.id, { payment_method: null, payment_date: null })
      showToast(`Betaling ongedaan gemaakt`)
    }
    setProcessingId(null)
  }

  // [BOEK-004] Ask the linked accountant to undo "verwerkt" so payment can change.
  // Same pattern as FacturenClient — the zzper↔accountant link is identical.
  async function requestUnverwerkt() {
    if (!verwerktCtx || !profile?.id) return
    const { data: link } = await supabase
      .from('accountant_clients')
      .select('accountant_id')
      .eq('zzper_id', profile.id)
      .limit(1)
      .maybeSingle()

    if (!link?.accountant_id) {
      showToast('Geen boekhouder gekoppeld')
      setVerwerktCtx(null)
      return
    }

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiver_id: link.accountant_id,
        content: `Verzoek: maak de verwerking van inkoopfactuur ${verwerktCtx.number} ongedaan, zodat ik de betaalstatus kan aanpassen.`,
      }),
    })

    if (res.ok) setRequestSent(true)
    else showToast('Versturen mislukt')
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Top App Bar ── */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Link href={parentHref} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, color: M3.primary, fontWeight: 600, fontSize: 14, padding: 0, fontFamily: FONT, textDecoration: 'none' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
          </Link>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: M3.onSurface, flex: 1, textAlign: 'center' }}>Inkoopfacturen</h1>
          <Link href="/dashboard/incoming" title="Verificatie" style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#49454F' }}>inbox</span>
          </Link>
        </div>

        {/* Filter dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowFilterMenu(p => !p)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 14px', background: M3.primaryContainer, borderRadius: R.md, border: 'none', cursor: 'pointer', fontFamily: FONT }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: M3.onPrimaryContainer }}>
              {FILTERS.find(f => f.id === filter)?.label ?? 'Alle'}
            </span>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.onPrimaryContainer }}>
              {showFilterMenu ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {showFilterMenu && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', borderRadius: R.md, marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); setShowFilterMenu(false) }}
                  style={{ display: 'block', width: '100%', padding: '12px 16px', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: filter === f.id ? 600 : 400, background: filter === f.id ? M3.primaryContainer : '#fff', color: filter === f.id ? M3.onPrimaryContainer : M3.onSurface, borderBottom: '0.5px solid #F1F3F4' }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 100px' }}>
        {displayed.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayed.map(inv => {
              const isPaid    = inv.status === 'paid'
              const expanded  = expandedId === inv.id
              const totalExBtw = inv.total_ex_btw ?? null
              const btwAmount = inv.btw_amount ?? (typeof inv.total_inc_btw === 'number' && typeof totalExBtw === 'number'
                ? inv.total_inc_btw - totalExBtw
                : null)
              const isVerwerkt = inv.accountant_status === 'verwerkt'

              return (
                <div key={inv.id} style={{ borderRadius: R.lg, overflow: 'hidden', boxShadow: EL1 }}>
                  {/* Main row */}
                  <div
                    onClick={() => setExpandedId(expanded ? null : inv.id)}
                    style={{ background: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        {/* [BRIDGE-POLISH 3a-1 parity] incoming direction marker */}
                        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: R.full, padding: '2px 8px', background: M3.errorContainer, color: M3.error }}>Ink.</span>
                        <p style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface, fontFamily: FONT_NUM }}>{inv.invoice_number ?? '—'}</p>
                        {/* Status chip */}
                        {CHIP[inv.status] && (
                          <span style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: CHIP[inv.status].bg, color: CHIP[inv.status].color }}>
                            {CHIP[inv.status].label}
                          </span>
                        )}
                        {/* [3b-2] accountant Verwerkt — READ-ONLY badge */}
                        {isVerwerkt && (
                          <span style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: M3.successContainer, color: '#137333' }}>
                            Verwerkt
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

                      {/* received → Betaald? */}
                      {inv.status === 'received' && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid' })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.surfaceVariant, color: '#49454F', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : 'Betaald?'}
                        </button>
                      )}

                      {/* paid → ✓ Betaald (toggle back to received) */}
                      {isPaid && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'received' })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.successContainer, color: '#137333', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span> Betaald</>}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline expand */}
                  {expanded && (
                    <div style={{ background: '#F8F9FA', borderTop: `1px solid ${M3.surfaceVariant}`, padding: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 16 }}>
                        <InfoLine label="Leverancier" value={inv.client_name} />
                        <InfoLine label="Excl. BTW" value={fmtEur(totalExBtw)} mono />
                        <InfoLine label={`BTW (${calcBtw(btwAmount, totalExBtw)}%)`} value={fmtEur(btwAmount)} mono />
                        <InfoLine label="Incl. BTW" value={fmtEur(inv.total_inc_btw)} mono />
                        {inv.payment_date && <InfoLine label="Betaaldatum" value={fmtDate(inv.payment_date)} />}
                        {inv.payment_method && <InfoLine label="Methode" value={inv.payment_method === 'kas' ? 'Contant' : 'Bank'} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {inv.pdf_url && (
                          <a
                            href={inv.pdf_url} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ fontSize: 13, color: M3.primary, background: M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>picture_as_pdf</span>
                            Bekijk PDF
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* ── Pay dialog (Bank/Contant + date on mark-paid; single confirm on undo) ── */}
      {payCtx && (
        <BottomSheet
          title={payCtx.newStatus === 'paid' ? 'Inkoopfactuur markeren als betaald?' : 'Betaling ongedaan maken?'}
          body={
            payCtx.newStatus === 'paid'
              ? `Inkoopfactuur ${payCtx.number} wordt als betaald gemarkeerd.`
              : `Inkoopfactuur ${payCtx.number} wordt teruggeplaatst naar 'Te betalen'.`
          }
          confirmLabel={payCtx.newStatus === 'paid' ? 'Ja, markeer als betaald' : 'Ongedaan maken'}
          confirmBg={payCtx.newStatus === 'paid' ? M3.success : M3.warning}
          onConfirm={() => executePay(payCtx)}
          onCancel={() => setPayCtx(null)}
          paymentChoice={
            payCtx.newStatus === 'paid'
              ? (method, paymentDate) => executePay({ ...payCtx, paymentMethod: method, paymentDate })
              : undefined
          }
        />
      )}

      {/* [BOEK-004] Verwerkt conflict dialog */}
      {verwerktCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setVerwerktCtx(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)', fontFamily: FONT }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>Factuur is verwerkt</h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              {requestSent
                ? `Je verzoek voor inkoopfactuur ${verwerktCtx.number} is naar de boekhouder gestuurd.`
                : `De boekhouder heeft inkoopfactuur ${verwerktCtx.number} verwerkt. Vraag eerst om de verwerking ongedaan te maken voordat je de betaalstatus wijzigt.`}
            </p>
            <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
              {!requestSent && (
                <button onClick={requestUnverwerkt} style={{ width: '100%', padding: '12px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                  Stuur verzoek naar boekhouder
                </button>
              )}
              <button onClick={() => setVerwerktCtx(null)} style={{ width: '100%', padding: '12px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: '#1C1B1F', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.sm, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', animation: 'fadeInUp 0.2s ease', fontFamily: FONT }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        ::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

// ─── Sub-components (mirrored from FacturenClient — same tokens) ───────────────

function InfoLine({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2, fontWeight: 500 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1C1B1F', fontFamily: mono ? "'Roboto Mono', monospace" : 'inherit' }}>{value}</p>
    </div>
  )
}

function BottomSheet({ title, body, confirmLabel, confirmBg, onConfirm, onCancel, paymentChoice }: {
  title: string
  body: string
  confirmLabel: string
  confirmBg: string
  onConfirm: () => void
  onCancel: () => void
  paymentChoice?: (method: 'bank' | 'kas', paymentDate: string) => void
}) {
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#FFFBFE', borderRadius: 28, padding: '28px 24px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 48px rgba(0,0,0,0.24)', fontFamily: FONT }}>
        <p style={{ fontSize: 20, fontWeight: 700, color: '#1C1B1F', marginBottom: 12, textAlign: 'center', letterSpacing: -0.3 }}>{title}</p>
        <p style={{ fontSize: 14, color: '#49454F', textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>{body}</p>

        {paymentChoice ? (
          <>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1C1B1F', marginBottom: 6 }}>Betaaldatum</label>
            <input
              type="date"
              value={paymentDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setPaymentDate(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #DADCE0', fontSize: 15, marginBottom: 16, fontFamily: FONT, color: '#1C1B1F', background: '#fff', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <button onClick={() => paymentChoice('bank', paymentDate)} style={{ flex: 1, padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>account_balance</span>
                Bank
              </button>
              <button onClick={() => paymentChoice('kas', paymentDate)} style={{ flex: 1, padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>payments</span>
                Contant
              </button>
            </div>
            <button onClick={onCancel} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Annuleren</button>
          </>
        ) : (
          <>
            <button onClick={onConfirm} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}>{confirmLabel}</button>
            <button onClick={onCancel} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Annuleren</button>
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, marginTop: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#C4C7C5', display: 'block', marginBottom: 12 }}>receipt_long</span>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1B1F', marginBottom: 4, fontFamily: FONT }}>Geen inkoopfacturen</p>
      <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>Bevestigde inkoopfacturen verschijnen hier</p>
    </div>
  )
}