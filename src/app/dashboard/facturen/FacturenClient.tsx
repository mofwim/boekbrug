'use client'

// src/app/dashboard/facturen/FacturenClient.tsx
// [BOEK-029] Client component — profile always passed from server wrapper
// Material You design — BoekBrug Design System v1.0 — May 2026

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useInfiniteInvoices } from '@/hooks/useInfiniteInvoices'
import type { InvoiceStatusFilter, InvoiceRow } from '@/hooks/useInfiniteInvoices'

// [BOEK-029] Archived rows carry only the columns their end-of-list card renders.
type ArchivedRow = {
  id: string
  invoice_number: string | null
  total_inc_btw: number | null
  replaced_by_number: string | null
  invoice_date: string | null
  invoice_type: string | null
}
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
import { ReconBadge } from '@/components/invoice/InvoiceRow'
import { InvoiceTypeBadge } from '@/components/invoice/InvoiceTypeBadge'
import { crossQuarterPayment } from '@/lib/quarter'

// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const M3 = {
  primary:           '#1A73E8',
  onPrimary:         '#FFFFFF',
  primaryContainer:  '#D3E3FD',
  onPrimaryContainer:'#041E49',
  surface:           '#ffffff',
  onSurface:         '#202124',
  surfaceVariant:    '#f1f3f4',
  outline:           '#80868b',
  error:             '#B3261E',
  errorContainer:    '#F9DEDC',
  success:           '#34A853',
  successContainer:  '#CEEAD6',
  warning:           '#E37400',
  warningContainer:  '#FEE8C4',
}
const FONT     = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const R = { sm: 8, md: 12, lg: 16, full: 9999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

// Status chip colors — Material You
const CHIP: Record<string, { bg: string; color: string }> = {
  paid:    { bg: '#CEEAD6', color: '#137333' },
  sent:    { bg: '#D3E3FD', color: '#1967D2' },
  overdue: { bg: '#F9DEDC', color: '#B3261E' },
  draft:   { bg: '#f1f3f4', color: '#5f6368' },
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
// [BOEK-029] Fix 1+3: invoiceType distinguishes factuur vs creditnota dialogs
interface ConfirmPayCtx {
  id: string
  number: string
  newStatus: 'paid' | 'sent'
  invoiceType: 'factuur' | 'creditnota' | 'pro_forma'
  // [BOEK-003] payment method — required by DB constraint invoices_paid_requires_method
  // UI shows "Bank" / "Contant"; DB stores 'bank' / 'kas'
  paymentMethod?: 'bank' | 'kas'
  // [BRIDGE-QUARTER] real payment date (YYYY-MM-DD) — Axis 2 / cash
  paymentDate?: string
}
// [BOEK-029] Send confirmation for draft → sent
interface SendCtx {
  id: string
  number: string
  clientName: string
  clientEmail: string
  totalIncBtw: number
  invoiceType: string
  // [BOEK-RESEND] the status to restore on failure (draft for first send,
  // sent/overdue for a resend) — so a failed resend doesn't wrongly become draft.
  prevStatus: string
  isResend?: boolean
}

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
export default function FacturenClient({ profile }: { profile: { id: string } }) {
  const router   = useRouter()
  const supabase = createClient()
  // [BANK-RECON-BADGE] Per-invoice reconciliation vs the bank statement (fail-soft).
  const { byInvoice: recon, confirmMatch } = useInvoiceReconciliation()

  const [filter, setFilter]             = useState<FilterTab>('all')
  const [sort, setSort]                 = useState<SortOrder>('desc')
  const [showFilterMenu, setShowFilterMenu] = useState(false)  // [BOEK-029] dropdown
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [deleteCtx, setDeleteCtx]       = useState<DeleteCtx | null>(null)
  const [payCtx, setPayCtx]             = useState<ConfirmPayCtx | null>(null)
  const [sendCtx, setSendCtx]           = useState<SendCtx | null>(null)  // [BOEK-029] Versturen confirm
  const [processingId, setProcessingId] = useState<string | null>(null)
  // [BOEK-004] dialog shown when client tries to unpay an accountant-verwerkt invoice
  const [verwerktCtx, setVerwerktCtx] = useState<{ id: string; number: string } | null>(null)
  const [requestSent, setRequestSent] = useState(false)

  // ── [BRIDGE-NOTIF] Deep-link focus from a notification (?focus={invoiceId}) ──
  // Reached when the accountant marks an OUTGOING invoice 'verwerkt'. Lands on
  // the row: auto-expand, scroll, brief highlight. Best-effort — if the row
  // isn't in the currently loaded page (infinite list), the page still opens.
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // [SEARCH] Quick text-filter over the loaded invoices. Seeded from ?search= (set by
  // the global search bar's Enter fallback). The global bar is now reachable on every
  // page, so a ?search= push can arrive while we're already mounted on /dashboard/facturen
  // (no remount) — sync on param change, not just at mount. Local typing doesn't change
  // the param, so it never clobbers the user's input.
  const searchParam = searchParams.get('search') ?? ''
  const [search, setSearch] = useState(searchParam)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchParam), 0)
    return () => clearTimeout(t)
  }, [searchParam])

  // [SEARCH] In-page live filter, SERVER-backed: finds ALL matching invoices (every
  // status, not only the loaded/paginated rows), in place — no navigation, no reload.
  // Active from 2 chars; falls back to the normal infinite list when empty.
  const [searchResults, setSearchResults] = useState<InvoiceRow[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // [BOEK-029] Archived — separate fetch, shown at end of "Alle" only
  const [archivedInvoices, setArchivedInvoices] = useState<ArchivedRow[]>([])

  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('invoices')
      .select('id, invoice_number, total_inc_btw, replaced_by_number, invoice_date, invoice_type')
      .eq('sender_id', profile.id)
      .eq('status', 'archived')
      .order('created_at', { ascending: false })
      .then(({ data }) => setArchivedInvoices((data ?? []) as unknown as ArchivedRow[]))
  }, [profile?.id])

  // [SEARCH] Debounced server query over ALL the user's invoices (any status), so a
  // match that hasn't been scrolled into the infinite list is still found instantly.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      const t0 = setTimeout(() => { setSearchResults(null); setSearchLoading(false) }, 0)
      return () => clearTimeout(t0)
    }
    const esc = q.replace(/[,()%_*\\":]/g, ' ').trim()
    if (esc.length < 1) {
      const t0 = setTimeout(() => { setSearchResults([]); setSearchLoading(false) }, 0)
      return () => clearTimeout(t0)
    }
    let active = true
    const tLoad = setTimeout(() => setSearchLoading(true), 0)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, client_name, status, accountant_status, direction, total_inc_btw, total_ex_btw, btw_amount, invoice_date, due_date, created_at, replaced_by_number, invoice_type')
        .eq('sender_id', profile.id)
        .neq('status', 'archived')
        .or(`invoice_number.ilike.%${esc}%,client_name.ilike.%${esc}%`)
        .order('created_at', { ascending: false })
        .limit(50)
      if (!active) return
      setSearchResults((data ?? []) as unknown as InvoiceRow[])
      setSearchLoading(false)
    }, 250)
    return () => { active = false; clearTimeout(tLoad); clearTimeout(t) }
  }, [search, profile.id])

  const statusMap: Record<FilterTab, InvoiceStatusFilter> = {
    all: 'all', sent: 'sent', paid: 'paid', draft: 'draft',
    overdue: 'overdue', offerte: 'all', credit: 'all',
  }

  const {
    invoices, loading, hasMore, refreshing,
    loadMore, refresh, updateOptimistic, removeOptimistic,
  } = useInfiniteInvoices({ userId: profile.id, status: statusMap[filter] })

  // [BRIDGE-NOTIF] Reveal a ?focus= row once it's present in the loaded list.
  useEffect(() => {
    if (!focusId || loading) return
    if (!invoices.some(i => i.id === focusId)) return
    const applyTimer = setTimeout(() => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    }, 0)
    const scrollTimer = setTimeout(() => {
      rowRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(applyTimer); clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, invoices.length])

  // When searching (>=2 chars) the SERVER result set is authoritative — it already
  // covers every status and all matches, so no client-side/tab filtering is applied
  // (the user is looking for a specific invoice, wherever it is).
  const searching = search.trim().length >= 2
  const displayed = searching
    ? (searchResults ?? [])
    : invoices.filter(inv => {
        if (inv.status === 'archived') return false
        if (filter === 'offerte') return inv.invoice_type === 'pro_forma'
        if (filter === 'credit')  return inv.invoice_type === 'creditnota'
        return true
      })
  const sorted = sort === 'desc' ? displayed : [...displayed].reverse()

  // [TAB-DRAIN] Offerte/Credit are CLIENT-side filters over server pages of
  // 'all'. When the loaded pages contain zero (or few) pro_forma/creditnota
  // rows, the list used to render "Geen facturen" with the scroll sentinel
  // unmounted — loadMore could never fire and every older offerte/creditnota
  // was unreachable (a dead end). While such a tab shows fewer than a handful
  // of rows and older pages exist, keep pulling pages until matches appear or
  // the pages run out.
  const typeFiltered = filter === 'offerte' || filter === 'credit'
  useEffect(() => {
    if (!typeFiltered || searching) return
    if (loading || !hasMore) return
    if (displayed.length >= 5) return
    loadMore()
  }, [typeFiltered, searching, loading, hasMore, displayed.length, loadMore])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  async function executePay(ctx: ConfirmPayCtx) {
    setPayCtx(null); setProcessingId(ctx.id)
    updateOptimistic(ctx.id, { status: ctx.newStatus })
    // [PAY-TOGGLE] Route through the audited server endpoint (same as Crediteuren). On UNDO it also
    // detaches any bank transaction matched to this invoice — the old direct client write undid the
    // invoice side only, stranding the tx as 'matched' (payable a second time) and left no audit row.
    const res = await fetch('/api/invoice/pay-toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId: ctx.id,
        action: ctx.newStatus === 'paid' ? 'pay' : 'undo',
        paymentMethod: ctx.paymentMethod ?? 'bank',
        paymentDate: ctx.paymentDate ?? new Date().toISOString().slice(0, 10),
      }),
    })
    const json = await res.json().catch(() => ({} as { error?: string }))
    const error = res.ok ? null : { message: json?.error || 'Bijwerken mislukt' }
    if (error) {
      const prev = ctx.newStatus === 'paid' ? 'sent' : 'paid'
      updateOptimistic(ctx.id, { status: prev })
      // [BOEK-004] verwerkt conflict (trigger) → show actionable dialog; else toast
      if (error.message && error.message.includes('verwerkt')) {
        setRequestSent(false)
        setVerwerktCtx({ id: ctx.id, number: ctx.number })
      } else {
        showToast(error.message || 'Bijwerken mislukt')
      }
    } else if (ctx.newStatus === 'paid') {
      if (ctx.invoiceType === 'creditnota') {
        showToast(`Creditnota ${ctx.number} voldaan ✓`)
      } else {
        // Notification insert needs service role (RLS blocks client insert) → API route
        try {
          await fetch('/api/notifications/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Factuur betaald',
              body: `Factuur ${ctx.number} is gemarkeerd als betaald.`,
              type: 'payment',
              // [BRIDGE-NOTIF] dead-click fix: open the invoices list.
              link: '/dashboard/facturen',
            }),
          })
        } catch { /* non-blocking — payment already succeeded */ }
        showToast(`Factuur ${ctx.number} betaald ✓`)
      }
    }
    setProcessingId(null)
  }

  // [BOEK-004] Ask the linked accountant to undo "verwerkt" so payment can change.
  async function requestUnverwerkt() {
    if (!verwerktCtx || !profile?.id) return
    // find the linked accountant for this client
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
        content: `Verzoek: maak de verwerking van factuur ${verwerktCtx.number} ongedaan, zodat ik de betaalstatus kan aanpassen.`,
      }),
    })

    if (res.ok) {
      setRequestSent(true)
    } else {
      showToast('Versturen mislukt')
    }
  }

  async function executeDelete(ctx: DeleteCtx) {
    setDeleteCtx(null)
    removeOptimistic(ctx.id)
    await supabase.from('invoice_lines').delete().eq('invoice_id', ctx.id)
    await supabase.from('invoices').delete().eq('id', ctx.id)
    showToast('Factuur verwijderd')
  }

  async function handleDeleteRequest(id: string, number: string, status: string) {
    // [COHERENCE-CREDITNOTA] A paid invoice may never be deleted — it is corrected with
    // a creditnota. Send the owner to the invoice detail with ?action=credit, which opens
    // the creditnota dialog that calls /api/invoice/creditnota (copies lines, keeps the
    // link). The old target (/invoice/new?type=creditnota) was a dead blank form that
    // produced an orphan creditnota with original_invoice_id=null.
    if (status === 'paid') { router.push(`/dashboard/invoice/${id}?action=credit`); return }
    setDeleteCtx({ id, number, status })
  }

  // [BOEK-029] Versturen flow — open modal with client details
  // [BOEK-RESEND] isResend=true when re-sending an already-sent invoice.
  async function handleSendRequest(invoiceId: string, isResend = false) {
    // Fetch full data to verify required fields before showing modal
    const { data: inv } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_type, client_name, client_email, total_inc_btw, status')
      .eq('id', invoiceId)
      .single()

    if (!inv) { showToast('Factuur niet gevonden'); return }
    if (!inv.client_email) { showToast('Klant e-mail ontbreekt'); return }
    if (!inv.client_name)  { showToast('Klant naam ontbreekt'); return }
    // [BOEK-029 v2] invoice_number check REMOVED — generated by /api/invoice/send
    // Drafts may have null invoice_number until sent. — May 2026

    const isProForma = inv.invoice_type === 'pro_forma' || inv.invoice_type === 'offerte'
    setSendCtx({
      id: inv.id,
      // Pro forma: show placeholder — number will change to official factuur number
      number: isProForma ? '' : (inv.invoice_number ?? ''),
      clientName: inv.client_name,
      clientEmail: inv.client_email,
      totalIncBtw: inv.total_inc_btw ?? 0,
      invoiceType: inv.invoice_type ?? 'factuur',
      prevStatus: inv.status ?? 'draft',
      isResend,
    })
  }

  // [BOEK-029] Versturen execute — call /api/invoice/send
  async function executeSend(ctx: SendCtx) {
    setSendCtx(null); setProcessingId(ctx.id)
    // Optimistic — flip status immediately (a resend stays/returns to 'sent')
    updateOptimistic(ctx.id, { status: 'sent' })
    try {
      const res = await fetch('/api/invoice/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // [BOEK-RESEND-FIX] forward the resend flag — without it the route treats
        // an already-sent invoice as a first send and 400s ("al verzonden").
        body: JSON.stringify({ invoiceId: ctx.id, resend: ctx.isResend }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Verzenden mislukt' }))
        // [BOEK-RESEND] rollback to the ORIGINAL status (draft for a first send,
        // sent/overdue for a resend) — never wrongly downgrade a sent invoice.
        updateOptimistic(ctx.id, { status: ctx.prevStatus })
        showToast(err.error || 'Verzenden mislukt')
      } else {
        // [BOEK-031 FIX] Get generated invoice_number + invoice_type from API response
        // Pro forma → factuur conversion: both number and type change
        const result = await res.json().catch(() => ({}))
        updateOptimistic(ctx.id, {
          ...(result.invoice_number ? { invoice_number: result.invoice_number } : {}),
          ...(result.invoice_type   ? { invoice_type: result.invoice_type }     : {}),
        })
        const displayNumber = result.invoice_number || ctx.number
        // [SEND-PDF-HONEST] A pdf_failed response means the number was issued but the PDF/email did
        // NOT go out — never toast "verzonden ✓". Tell the owner to resend so the state is honest.
        if (result.warning === 'pdf_failed' || result.delivered === false) {
          showToast(
            displayNumber
              ? `Factuur ${displayNumber} kreeg een nummer, maar de PDF kon niet worden gemaakt — verstuur opnieuw`
              : 'De PDF kon niet worden gemaakt — verstuur de factuur opnieuw'
          )
        } else {
          showToast(
            ctx.isResend
              ? (displayNumber ? `Factuur ${displayNumber} opnieuw verzonden ✓` : 'Factuur opnieuw verzonden ✓')
              : (displayNumber ? `Factuur ${displayNumber} verzonden ✓` : 'Factuur verzonden ✓')
          )
        }
      }
    } catch {
      // [BOEK-RESEND] rollback to original status on network failure too
      updateOptimistic(ctx.id, { status: ctx.prevStatus })
      showToast('Verzenden mislukt — controleer je verbinding')
    } finally {
      setProcessingId(null)
    }
  }

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current; if (!el) return
    // [SEARCH] Don't paginate the infinite list while a server search is active.
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting && hasMore && !loading && !searching) loadMore() }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, searching, loadMore])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* ── Filters toolbar ── [SUBNAV] back + "Mijn facturen" title now come from
          the shared sub-page header (see DashboardChrome); this block keeps the
          page's own controls (sort/refresh/search/filter) and sticks directly
          BELOW the shared bar via top: calc(56px + safe-area). */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px', position: 'sticky', top: 'calc(56px + env(safe-area-inset-top))', zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Sort */}
            <button onClick={() => setSort(s => s === 'desc' ? 'asc' : 'desc')}
              style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#5f6368', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{sort === 'desc' ? 'arrow_downward' : 'arrow_upward'}</span>
              {sort === 'desc' ? 'Nieuwste' : 'Oudste'}
            </button>
            {/* Refresh */}
            <button onClick={refresh} aria-label="Vernieuwen" style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5f6368' }}>{refreshing ? 'hourglass_empty' : 'refresh'}</span>
            </button>
          </div>
        </div>

        {/* [SEARCH] Quick text-filter (invoice number / client name) */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <span className="material-symbols-outlined" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: '#5F6368' }}>search</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Zoek op factuurnummer of klant..."
            aria-label="Facturen zoeken"
            style={{ width: '100%', borderRadius: R.full, border: `1px solid ${M3.outline}`, padding: '10px 40px 10px 40px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT, background: M3.surface, color: M3.onSurface }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Zoekopdracht wissen"
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 22, height: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f6368' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
            </button>
          )}
        </div>

        {/* [BOEK-029] Filter dropdown — works on all screen sizes */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowFilterMenu(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '10px 14px',
              background: M3.primaryContainer, borderRadius: R.md,
              border: 'none', cursor: 'pointer', fontFamily: FONT,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: M3.onPrimaryContainer }}>
              {FILTERS.find(f => f.id === filter)?.label ?? 'Alle'}
            </span>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.onPrimaryContainer }}>
              {showFilterMenu ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {showFilterMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: '#fff', borderRadius: R.md, marginTop: 4,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              overflow: 'hidden',
            }}>
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); setShowFilterMenu(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '12px 16px',
                    textAlign: 'left', border: 'none', cursor: 'pointer',
                    fontFamily: FONT, fontSize: 14,
                    fontWeight: filter === f.id ? 600 : 400,
                    background: filter === f.id ? M3.primaryContainer : '#fff',
                    color: filter === f.id ? M3.onPrimaryContainer : M3.onSurface,
                    borderBottom: '0.5px solid #F1F3F4',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Invoice list ── */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 100px' }}>
        {(searching ? searchLoading : loading) && sorted.length === 0 ? (
          <SkeletonList />
        ) : sorted.length === 0 ? (
          searching ? (
            <p style={{ textAlign: 'center', color: '#5F6368', fontSize: 14, padding: '48px 16px', fontFamily: FONT }}>
              Geen facturen gevonden voor &ldquo;{search.trim()}&rdquo;
            </p>
          ) : typeFiltered && (hasMore || loading) ? (
            // [TAB-DRAIN] Older pages are still being pulled in — an honest
            // "searching" state, never a false "Geen facturen" while matches
            // may exist further back.
            <p style={{ textAlign: 'center', color: '#5F6368', fontSize: 14, padding: '48px 16px', fontFamily: FONT }}>
              Zoeken in oudere facturen…
            </p>
          ) : <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map(inv => {
              const isCredit  = inv.invoice_type === 'creditnota'
              const isOfferte = inv.invoice_type === 'pro_forma'
              const isPaid    = inv.status === 'paid'
              const expanded  = expandedId === inv.id
              const totalExBtw = inv.total_ex_btw ?? null
              const btwAmount = inv.btw_amount ?? (typeof inv.total_inc_btw === 'number' && typeof totalExBtw === 'number'
                ? inv.total_inc_btw - totalExBtw
                : null)
              const invoiceType = inv.invoice_type === 'creditnota' ? 'creditnota'
                : inv.invoice_type === 'pro_forma' ? 'pro_forma'
                : 'factuur'

              // [CROSS-QUARTER] Only a paid invoice whose money actually moved in a different
              // quarter than its invoice date gets the marker — accrual is unchanged, this is
              // purely "when was it settled". null (no marker) for everything else.
              const xq = isPaid ? crossQuarterPayment(inv.invoice_date, inv.payment_date) : null

              // Row tint
              const rowBg = isCredit ? '#FFF8F0' : isOfferte ? '#F8F9FA' : '#fff'

              return (
                <div
                  key={inv.id}
                  ref={el => { rowRefs.current[inv.id] = el }}
                  style={{
                    borderRadius: R.lg,
                    overflow: 'hidden',
                    boxShadow: highlightId === inv.id ? `0 0 0 2px ${M3.primary}, ${EL1}` : EL1,
                    transition: 'box-shadow 0.4s ease',
                  }}
                >
                  {/* Main row */}
                  <div
                    onClick={() => setExpandedId(expanded ? null : inv.id)}
                    style={{ background: highlightId === inv.id ? M3.primaryContainer : rowBg, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.4s ease' }}
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
                        {recon[inv.id] && (
                          <ReconBadge recon={recon[inv.id]} mode="zzp" invoiceId={inv.id} onReconConfirm={async (id) => {
                            // [BANK-RECON-CONFIRM] Book a safe (reference-backed) match in one tap;
                            // an amount-only match ('navigate') opens the bank page to review.
                            const r = await confirmMatch(id)
                            if (r === 'ok') { showToast('Betaling bevestigd ✓'); refresh() }
                            else if (r === 'navigate') router.push('/dashboard/bank')
                            else showToast('Bevestigen mislukt — probeer het op de Bank-pagina')
                          }} />
                        )}
                        {xq && (
                          <span
                            title={`De factuur telt voor de btw mee in ${xq.bookedQuarterLabel} (factuurdatum). De betaling kwam binnen in ${xq.paidQuarterLabel}.`}
                            style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: '#FFF3E0', color: '#B26A00', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>event_available</span>
                            Betaald in {xq.paidQuarterLabel}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: '#5F6368', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inv.client_name ?? '—'} · {fmtDate(inv.invoice_date)}
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                      {/* [BOEK-029] Amount: always total_inc_btw — never total_ex_btw */}
                      <p style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, fontFamily: FONT_NUM }}>
                        {fmtEur(inv.total_inc_btw)}
                      </p>

                      {/* [BOEK-029] Fix 1: correct button per type+status */}

                      {/* factuur + draft → Versturen (opens send modal) */}
                      {!isCredit && !isOfferte && inv.status === 'draft' && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            handleSendRequest(inv.id)
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>send</span> Versturen</>}
                        </button>
                      )}

                      {/* pro_forma + draft → Versturen (converts to official factuur on send) */}
                      {isOfferte && inv.status === 'draft' && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            handleSendRequest(inv.id)
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>send</span> Versturen</>}
                        </button>
                      )}

                      {/* [BOEK-RESEND] factuur + sent/overdue → Opnieuw versturen */}
                      {!isCredit && !isOfferte && (inv.status === 'sent' || inv.status === 'overdue') && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            handleSendRequest(inv.id, true)
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.primaryContainer, color: M3.onPrimaryContainer, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>forward_to_inbox</span> Opnieuw versturen</>}
                        </button>
                      )}

                      {/* factuur + sent/overdue → Betaald? */}
                      {!isCredit && !isOfferte && (inv.status === 'sent' || inv.status === 'overdue') && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid', invoiceType: 'factuur' })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.surfaceVariant, color: '#5f6368', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : 'Betaald?'}
                        </button>
                      )}

                      {/* factuur + paid → ✓ Betaald (toggle back) */}
                      {!isCredit && !isOfferte && isPaid && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'sent', invoiceType: 'factuur' })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: M3.successContainer, color: '#137333', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                          {processingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span> Betaald</>}
                        </button>
                      )}

                      {/* creditnota → Voldaan! / ✓ Voldaan toggle — Fix 3 */}
                      {isCredit && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id) return
                            // 'voldaan' is UI-only, never a DB status — a paid
                            // creditnota IS the "voldaan" state (status 'paid').
                            setPayCtx({
                              id: inv.id,
                              number: inv.invoice_number ?? '',
                              newStatus: isPaid ? 'sent' : 'paid',
                              invoiceType: 'creditnota',
                            })
                          }}
                          style={{ fontSize: 12, fontWeight: 500, borderRadius: R.full, border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT, background: isPaid ? M3.successContainer : '#FEF7E0', color: isPaid ? '#137333' : '#EA8600' }}>
                          {processingId === inv.id ? '...'
                            : isPaid ? '✓ Voldaan'
                            : 'Voldaan!'}
                        </button>
                      )}

                      {/* pro_forma + sent → Maak factuur aan (manual conversion for legacy sent pro_formas) */}
                      {isOfferte && inv.status === 'sent' && (
                        <button
                          onClick={async e => {
                            e.stopPropagation()
                            // [BOEK-029] Fetch complete invoice data — hook SELECT may be incomplete
                            const { data: full } = await supabase
                              .from('invoices')
                              .select('id, client_name, client_email, client_address, client_postal_code, client_city, client_btw_number, total_inc_btw, total_ex_btw, btw_amount')
                              .eq('id', inv.id)
                              .single()

                            const src = (full ?? inv) as {
                              client_name?: string | null; client_email?: string | null
                              client_address?: string | null; client_postal_code?: string | null
                              client_city?: string | null; client_btw_number?: string | null
                              total_inc_btw?: number | null; total_ex_btw?: number | null
                              btw_amount?: number | null
                            }
                            router.push(
                              `/dashboard/invoice/new?from_offerte=${inv.id}` +
                              `&client_name=${encodeURIComponent(src.client_name ?? '')}` +
                              `&client_email=${encodeURIComponent(src.client_email ?? '')}` +
                              `&client_address=${encodeURIComponent(src.client_address ?? '')}` +
                              `&client_postal_code=${encodeURIComponent(src.client_postal_code ?? '')}` +
                              `&client_city=${encodeURIComponent(src.client_city ?? '')}` +
                              `&client_btw_number=${encodeURIComponent(src.client_btw_number ?? '')}` +
                              `&total_inc_btw=${src.total_inc_btw ?? 0}` +
                              `&total_ex_btw=${src.total_ex_btw ?? 0}` +
                              `&btw_amount=${src.btw_amount ?? 0}`
                            )
                          }}
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
                        {(inv as InvoiceRow & { client_btw_number?: string | null }).client_btw_number && <InfoLine label="BTW" value={(inv as InvoiceRow & { client_btw_number?: string | null }).client_btw_number ?? null} />}
                        <InfoLine label="Excl. BTW" value={fmtEur(totalExBtw)} mono />
                        <InfoLine label={`BTW (${calcBtw(btwAmount, totalExBtw)}%)`} value={fmtEur(btwAmount)} mono />
                        <InfoLine label="Incl. BTW" value={fmtEur(inv.total_inc_btw)} mono />
                        {inv.due_date && <InfoLine label="Vervaldatum" value={fmtDate(inv.due_date)} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* [BOEK-029] Delete rules: draft (not creditnota) + pro_forma only */}
                        {(() => {
                          const canDelete =
                            (inv.status === 'draft' && inv.invoice_type !== 'creditnota') ||
                            inv.invoice_type === 'pro_forma'
                          return canDelete ? (
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteRequest(inv.id, inv.invoice_number ?? '', inv.status) }}
                              style={{ fontSize: 13, color: M3.error, background: M3.errorContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                              Verwijderen
                            </button>
                          ) : null
                        })()}
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

            {/* [BOEK-029] Archived — end of Alle only, no buttons (hidden while searching) */}
            {filter === 'all' && !searching && archivedInvoices.length > 0 && (
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

      {/* ── [BOEK-029] Fix 3: Smart pay dialog — factuur vs creditnota ── */}
      {payCtx && (
        <BottomSheet
          title={
            payCtx.invoiceType === 'creditnota'
              ? (payCtx.newStatus === 'paid' ? 'Creditnota als voldaan markeren?' : 'Voldaan status ongedaan maken?')
              : (payCtx.newStatus === 'paid' ? 'Factuur markeren als betaald?'    : 'Betaling ongedaan maken?')
          }
          body={
            payCtx.invoiceType === 'creditnota'
              ? (payCtx.newStatus === 'paid'
                  ? `Weet u zeker dat u creditnota ${payCtx.number} als voldaan wilt markeren?`
                  : `Creditnota ${payCtx.number} wordt teruggeplaatst naar 'Verzonden'.`)
              : (payCtx.newStatus === 'paid'
                  ? `Factuur ${payCtx.number} wordt als betaald gemarkeerd en doorgestuurd naar uw accountant. Weet u het zeker?`
                  : `Factuur ${payCtx.number} wordt teruggeplaatst naar 'Verzonden'.`)
          }
          confirmLabel={
            payCtx.invoiceType === 'creditnota'
              ? (payCtx.newStatus === 'paid' ? 'Ja, voldaan' : 'Ja, ongedaan maken')
              : (payCtx.newStatus === 'paid' ? 'Ja, markeer als betaald' : 'Ongedaan maken')
          }
          confirmBg={
            payCtx.newStatus === 'paid' ? M3.success : M3.warning
          }
          onConfirm={() => executePay(payCtx)}
          onCancel={() => setPayCtx(null)}
          /* [BOEK-003] factuur + marking as paid → ask Bank/Contant.
             creditnota and undo (newStatus='sent') keep single confirm button. */
          paymentChoice={
            payCtx.invoiceType === 'factuur' && payCtx.newStatus === 'paid'
              ? (method, paymentDate) => executePay({ ...payCtx, paymentMethod: method, paymentDate })
              : undefined
          }
        />
      )}

      {/* [BOEK-029] ── Send confirmation modal ── */}
      {sendCtx && (
        <BottomSheet
          title={`Versturen naar ${sendCtx.clientName}?`}
          body={
            sendCtx.invoiceType === 'pro_forma' || sendCtx.invoiceType === 'offerte'
              ? 'Deze pro forma wordt omgezet naar een officiële factuur met een nieuw factuurnummer.'
              : 'Bevestig de gegevens voordat je de factuur verstuurt.'
          }
          details={[
            { label: 'Factuurnummer', value: sendCtx.number || 'Wordt toegekend bij verzenden' },
            { label: 'E-mail',        value: sendCtx.clientEmail },
            { label: 'Bedrag',        value: fmtEur(sendCtx.totalIncBtw) },
          ]}
          warning="Na verzending kun je deze factuur niet meer wijzigen. Voor correcties moet je een creditnota maken."
          confirmLabel="Versturen"
          confirmBg={M3.primary}
          onConfirm={() => executeSend(sendCtx)}
          onCancel={() => setSendCtx(null)}
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

      {/* [BOEK-004] Verwerkt conflict dialog */}
      {verwerktCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setVerwerktCtx(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)', fontFamily: FONT }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>
              Factuur is verwerkt
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              {requestSent
                ? `Je verzoek voor factuur ${verwerktCtx.number} is naar de boekhouder gestuurd.`
                : `De boekhouder heeft factuur ${verwerktCtx.number} verwerkt. Vraag eerst om de verwerking ongedaan te maken voordat je de betaalstatus wijzigt.`}
            </p>
            <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
              {!requestSent && (
                <button
                  onClick={requestUnverwerkt}
                  style={{ width: '100%', padding: '12px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
                >
                  Stuur verzoek naar boekhouder
                </button>
              )}
              <button
                onClick={() => setVerwerktCtx(null)}
                style={{ width: '100%', padding: '12px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: '#202124', color: '#fff', fontSize: 13, fontWeight: 500,
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
      <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: mono ? "'Roboto Mono', monospace" : 'inherit' }}>{value}</p>
    </div>
  )
}

function BottomSheet({ title, body, confirmLabel, confirmBg, onConfirm, onCancel, details, warning, paymentChoice }: {
  title: string
  body: string
  confirmLabel: string
  confirmBg: string
  onConfirm: () => void
  onCancel: () => void
  details?: { label: string; value: string }[]
  warning?: string
  // [BOEK-003] when set, replaces single confirm button with Bank / Contant choice
  // [BRIDGE-QUARTER] now also receives the real payment date (YYYY-MM-DD)
  paymentChoice?: (method: 'bank' | 'kas', paymentDate: string) => void
}) {
  // [BRIDGE-QUARTER] real payment date — only relevant when paymentChoice is set
  // (marking as paid). Defaults to today; user corrects if they paid earlier.
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  // [BOEK-029] CenteredModal — replaces bottom sheet for all dialogs
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 28,
          padding: '28px 24px 24px',
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 24px 48px rgba(0,0,0,0.24)',
          fontFamily: FONT,
        }}
      >
        <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 12, textAlign: 'center', letterSpacing: -0.3 }}>{title}</p>
        <p style={{ fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: details && details.length > 0 ? 20 : 24, lineHeight: 1.5 }}>{body}</p>

        {/* [BOEK-029] Optional details list */}
        {details && details.length > 0 && (
          <div style={{ background: '#F1F3F4', borderRadius: 12, padding: '14px 16px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {details.map(d => (
              <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#5F6368', flexShrink: 0 }}>{d.label}</span>
                <span style={{ fontSize: 13, color: '#202124', fontWeight: 600, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* [BOEK-029] Optional warning box */}
        {warning && (
          <div style={{ background: '#FEF7E0', borderRadius: 12, padding: '12px 14px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#EA8600', flexShrink: 0, marginTop: 1 }}>warning</span>
            <p style={{ fontSize: 12.5, color: '#7C5800', lineHeight: 1.5, margin: 0 }}>{warning}</p>
          </div>
        )}

        {/* [BOEK-003] payment method choice (Bank / Contant) or standard confirm */}
        {paymentChoice ? (
          <>
            {/* [BRIDGE-QUARTER] Real payment date — the day money actually moved */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 6 }}>Betaaldatum</label>
            <input
              type="date"
              value={paymentDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setPaymentDate(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #DADCE0', fontSize: 15, marginBottom: 16, fontFamily: FONT, color: '#202124', background: '#fff', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <button
                onClick={() => paymentChoice('bank', paymentDate)}
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>account_balance</span>
                Bank
              </button>
              <button
                onClick={() => paymentChoice('kas', paymentDate)}
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>payments</span>
                Contant
              </button>
            </div>
            <button onClick={onCancel} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Annuleren</button>
          </>
        ) : (
          <>
            <button onClick={onConfirm} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: confirmBg, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}>{confirmLabel}</button>
            <button onClick={onCancel}  style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Annuleren</button>
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
      <p style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 4, fontFamily: FONT }}>Geen facturen</p>
      <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>Maak je eerste factuur aan</p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{ height: 72, borderRadius: R.lg, background: 'linear-gradient(90deg,#F8F9FA 25%,#e0e0e0 50%,#F8F9FA 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
      ))}
    </div>
  )
}