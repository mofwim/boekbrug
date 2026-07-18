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
import { useRouter, useSearchParams } from 'next/navigation'
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
import { ReconBadge } from '@/components/invoice/InvoiceRow'
import { useParentPath } from '@/lib/navigation-hooks'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
// [PAY-SAFE] EPC QR payload + IBAN validation (pure, client-safe)
import { buildEpcQrPayload, isValidIban } from '@/lib/epc-qr'
import { crossQuarterPayment } from '@/lib/quarter'

// ─── Design tokens — BoekBrug Design System v1.0 (Material You) ───────────────
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
  // [PAY-SAFE] vendor payment details — to PREPARE a payment (QR / copy).
  // Null on legacy rows (forward-only extraction) or when the AI didn't find it.
  vendor_iban: string | null
  payment_reference: string | null
  // [PAY-SAFE-CONFIRM] UI marker: owner generated a payment QR/details.
  // NOT a financial state — persists across the async pay round-trip so the
  // "Ik heb betaald" confirm CTA survives prepare → leave → pay → return.
  payment_prepared_at: string | null
  // [AUTO-ADVANCE] jsonb — carries _auto_verified when the app booked this invoice
  // without a manual tap, so the owner can review "wat is automatisch verwerkt".
  field_confidence: Record<string, unknown> | null
}

// [AUTO-ADVANCE] True when the app auto-verified this invoice (clean + confident) instead of
// the owner tapping confirm. Drives the review badge + filter — the opt-in double-check.
function isAutoVerified(inv: IncomingRow): boolean {
  const fc = inv.field_confidence
  return !!(fc && typeof fc === 'object' && (fc as Record<string, unknown>)._auto_verified)
}

// Pay confirm context — payment fields only (defense in depth: never amounts)
interface PayCtx {
  id: string
  number: string
  newStatus: 'paid' | 'received'
  paymentMethod?: 'bank' | 'kas'
  paymentDate?: string
}

type FilterTab = 'all' | 'received' | 'paid' | 'auto'
const FILTERS: { id: FilterTab; label: string }[] = [
  { id: 'all',      label: 'Alle'                  },
  { id: 'received', label: 'Te betalen'            },
  { id: 'paid',     label: 'Betaald'               },
  { id: 'auto',     label: 'Automatisch verwerkt'  },
]

// ─── [SORT] Ordering the list — the same options the market (Moneybird, e-Boekhouden,
// Exact) offers, so the owner can find an invoice by whatever date/number matters to them,
// not only "date added". Default stays 'added_desc' (nieuwste import bovenaan) so the screen
// looks unchanged until the owner picks another order.
type SortKey =
  | 'added_desc' | 'invdate_desc' | 'invdate_asc'
  | 'due_asc' | 'paydate_desc' | 'amount_desc' | 'amount_asc' | 'vendor_asc'
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'added_desc',   label: 'Toegevoegd (nieuwste eerst)'  },
  { id: 'invdate_desc', label: 'Factuurdatum (nieuwste eerst)' },
  { id: 'invdate_asc',  label: 'Factuurdatum (oudste eerst)'   },
  { id: 'due_asc',      label: 'Vervaldatum (eerst verlopen)'  },
  { id: 'paydate_desc', label: 'Betaaldatum (nieuwste eerst)'  },
  { id: 'amount_desc',  label: 'Bedrag (hoog → laag)'          },
  { id: 'amount_asc',   label: 'Bedrag (laag → hoog)'          },
  { id: 'vendor_asc',   label: 'Leverancier (A–Z)'             },
]

// Comparators — a MISSING value always sorts LAST (a dateless/amountless invoice must never
// jump to the top and hide a real one), regardless of asc/desc. Dates are ISO "YYYY-MM-DD"
// so a plain string compare is chronological.
function cmpDate(a: string | null, b: string | null, dir: 'asc' | 'desc'): number {
  const aa = a ?? '', bb = b ?? ''
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return dir === 'asc' ? aa.localeCompare(bb) : bb.localeCompare(aa)
}
function cmpNum(a: number | null, b: number | null, dir: 'asc' | 'desc'): number {
  const aNull = a == null, bNull = b == null
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  return dir === 'asc' ? (a as number) - (b as number) : (b as number) - (a as number)
}
function cmpStr(a: string | null, b: string | null): number {
  const aa = (a ?? '').trim(), bb = (b ?? '').trim()
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return aa.localeCompare(bb, 'nl', { sensitivity: 'base' })
}
// Array.prototype.sort is stable, so equal keys keep the incoming order (created_at desc
// from the server) — a deterministic tiebreak with no extra code.
function sortRows(rows: IncomingRow[], key: SortKey): IncomingRow[] {
  const s = [...rows]
  switch (key) {
    case 'invdate_desc': return s.sort((a, b) => cmpDate(a.invoice_date, b.invoice_date, 'desc'))
    case 'invdate_asc':  return s.sort((a, b) => cmpDate(a.invoice_date, b.invoice_date, 'asc'))
    case 'due_asc':      return s.sort((a, b) => cmpDate(a.due_date, b.due_date, 'asc'))
    case 'paydate_desc': return s.sort((a, b) => cmpDate(a.payment_date, b.payment_date, 'desc'))
    case 'amount_desc':  return s.sort((a, b) => cmpNum(a.total_inc_btw, b.total_inc_btw, 'desc'))
    case 'amount_asc':   return s.sort((a, b) => cmpNum(a.total_inc_btw, b.total_inc_btw, 'asc'))
    case 'vendor_asc':   return s.sort((a, b) => cmpStr(a.client_name, b.client_name))
    case 'added_desc':
    default:             return s.sort((a, b) => cmpDate(a.created_at, b.created_at, 'desc'))
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IncomingManageClient({
  profile,
  initialInvoices,
}: { profile: any; initialInvoices: IncomingRow[] }) {
  const router   = useRouter()
  const supabase = createClient()
  // [BANK-RECON-BADGE] Per-invoice reconciliation vs the bank statement (fail-soft).
  const { byInvoice: recon, confirmMatch } = useInvoiceReconciliation()
  const parentHref = useParentPath(profile.role ?? 'zzper')

  const [invoices, setInvoices]         = useState<IncomingRow[]>(initialInvoices)
  const [filter, setFilter]             = useState<FilterTab>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortBy, setSortBy]             = useState<SortKey>('added_desc')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [payCtx, setPayCtx]             = useState<PayCtx | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  // [BOEK-004] dialog when a change is blocked because the accountant verwerkt it
  const [verwerktCtx, setVerwerktCtx]   = useState<{ id: string; number: string } | null>(null)
  const [requestSent, setRequestSent]   = useState(false)
  // [PAY-SAFE] Prepare-payment sheet (QR + copy details). Holds the row to pay.
  const [prepareCtx, setPrepareCtx]     = useState<IncomingRow | null>(null)
  // [PAY-SAFE] No-double-pay warning before marking paid. Holds the pending pay
  // context + the matched already-paid invoice so the owner can decide.
  const [dupWarn, setDupWarn]           = useState<{
    ctx: PayCtx
    match: { id?: string; invoice_number: string | null; client_name: string | null; total_inc_btw: number | null; payment_date: string | null }
  } | null>(null)
  const [checkingId, setCheckingId]     = useState<string | null>(null)

  // ── [BRIDGE-NOTIF] Deep-link focus from a notification (?focus={invoiceId}) ──
  // Lands the user on the exact row: auto-expand, scroll into view, brief highlight.
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')
  // [TODAY-AL-BETAALD] patch note (cross-ticket: owned by TODAY-UX, lives here):
  // Vandaag's "Al betaald?" routes here with ?action=pay to open the EXISTING
  // mark-as-paid dialog directly. We do NOT add any new pay/write logic — we call
  // the same requestPay() the in-row button uses, so the no-double-pay check and
  // the single write path are fully preserved. Read-only intent passed via URL.
  const actionParam = searchParams.get('action')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!focusId) return
    // Only act if the focused row actually exists in this list.
    if (!invoices.some(i => i.id === focusId)) return
    setExpandedId(focusId)
    setHighlightId(focusId)
    // Wait a tick for the row to render, then scroll to it.
    const scrollTimer = setTimeout(() => {
      rowRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    // Fade the highlight after a few seconds — a cue, not a permanent state.
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  // [TODAY-AL-BETAALD] When arriving with ?action=pay, open the mark-as-paid
  // dialog for the focused invoice — but only if it is still 'received' (unpaid).
  // Runs once the row is present in the list. Uses the SAME requestPay() as the
  // manual button (no logic duplicated). Separate effect so the focus/scroll
  // behaviour above is untouched.
  useEffect(() => {
    if (actionParam !== 'pay' || !focusId) return
    const target = invoices.find(i => i.id === focusId)
    if (!target) return
    if (target.status !== 'received') return
    // Small delay so the row is expanded/scrolled first, then the dialog opens.
    const t = setTimeout(() => { requestPay(target) }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParam, focusId, invoices.length])

  const displayed = sortRows(
    invoices.filter(inv =>
      filter === 'all' ? true
        : filter === 'auto' ? isAutoVerified(inv)
        : inv.status === filter,
    ),
    sortBy,
  )
  // [AUTO-ADVANCE] Count for the review nudge — how many invoices the app booked for you.
  const autoCount = invoices.filter(isAutoVerified).length

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // Local optimistic patch (no hook — this surface owns its list)
  function patchLocal(id: string, patch: Partial<IncomingRow>) {
    setInvoices(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  // ── [PAY-SAFE] No-double-pay gate — runs BEFORE the mark-paid dialog ──
  // Server check (read-only) for an already-paid twin (same vendor + amount,
  // recent). If found → warn and let the owner decide. If not → open the normal
  // pay dialog. A failed check NEVER blocks paying (warn-don't-block, and the
  // check is a convenience, not a guard). 'received' → 'paid' only; an undo
  // (paid → received) skips the check entirely.
  async function requestPay(inv: IncomingRow) {
    const ctx: PayCtx = { id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid' }
    setCheckingId(inv.id)
    try {
      const res = await fetch('/api/incoming/check-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id }),
      })
      const data = await res.json()
      if (res.ok && data.duplicate && data.match) {
        setDupWarn({ ctx, match: data.match })
      } else {
        setPayCtx(ctx) // no twin → normal flow
      }
    } catch {
      // Check failed (network etc.) — never block paying; open the normal dialog.
      setPayCtx(ctx)
    } finally {
      setCheckingId(null)
    }
  }

  // ── [PAY-SAFE] Duplicate warning actions ──
  // viewOriginal: jump to the already-paid original and highlight it (same deep-
  // link mechanism as a notification: expand + highlight + scroll). If it isn't
  // in the current list (paid rows are), fall back to a focus URL.
  function viewOriginal(originalId?: string) {
    setDupWarn(null)
    if (!originalId) return
    if (invoices.some(i => i.id === originalId)) {
      setExpandedId(originalId)
      setHighlightId(originalId)
      setTimeout(() => {
        rowRefs.current[originalId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 60)
      setTimeout(() => setHighlightId(null), 3200)
    } else {
      router.push(`/dashboard/incoming/manage?focus=${originalId}`)
    }
  }

  // archiveDuplicate: the second copy is the SAME invoice re-uploaded. Remove it
  // from the queue. Under the hood this ARCHIVES (status='archived') — never a
  // physical delete (Bewaarplicht). Routes through the existing confirm DELETE
  // (archive, recoverable). The original paid invoice is untouched.
  async function archiveDuplicate(dupId: string) {
    setDupWarn(null)
    setProcessingId(dupId)
    try {
      const res = await fetch(`/api/email/confirm/${dupId}`, { method: 'DELETE' })
      if (res.ok) {
        setInvoices(prev => prev.filter(i => i.id !== dupId))
        showToast('Dubbele factuur verwijderd')
      } else {
        showToast('Verwijderen mislukt — probeer opnieuw')
      }
    } catch {
      showToast('Verwijderen mislukt — probeer opnieuw')
    } finally {
      setProcessingId(null)
    }
  }

  // ── [PAY-SAFE-CONFIRM] Mark a row as "payment prepared" (UI marker only) ──
  // Written when the prepare sheet closes. NOT a financial state: only the
  // payment_prepared_at timestamp, never status/amounts. Session client (row
  // belongs to the receiver). Idempotent — re-preparing just refreshes the ts.
  // Skipped if the row is already paid (no marker needed) or already marked.
  async function markPrepared(inv: IncomingRow) {
    if (inv.status !== 'received' || inv.payment_prepared_at) return
    const now = new Date().toISOString()
    patchLocal(inv.id, { payment_prepared_at: now })
    const { error } = await supabase
      .from('invoices')
      .update({ payment_prepared_at: now })
      .eq('id', inv.id)
      .eq('receiver_id', profile.id)
      .eq('direction', 'incoming')
    if (error) {
      // Non-fatal: the marker is a convenience. Roll back the local flag so the
      // UI doesn't claim a state the DB doesn't have.
      patchLocal(inv.id, { payment_prepared_at: null })
    }
  }

  // ── [PAY-NOT-YET] The owner's honest "no": clear the prepared marker ──
  // Mirror of markPrepared. Invoked from the pay dialog's "Nee, nog niet
  // betaald": the owner opened the QR/prepared a payment but did NOT send it.
  // Effect: payment_prepared_at → null → the "Voorbereid" chip disappears and
  // the card's button returns to its calm state. The invoice itself stays
  // 'received' / te betalen — nothing financial changes (UI marker only,
  // same non-financial write path as markPrepared; never status/amounts).
  // ALWAYS clears (no state pre-check): if a slow markPrepared write lands
  // after this clear, executePay wipes the field again on any later payment,
  // so a ghost timestamp is harmless — and clearing unconditionally keeps
  // this a safe answer even when nothing was prepared (no-op in the DB).
  async function markNotPaid(inv: IncomingRow) {
    patchLocal(inv.id, { payment_prepared_at: null })
    const { error } = await supabase
      .from('invoices')
      .update({ payment_prepared_at: null })
      .eq('id', inv.id)
      .eq('receiver_id', profile.id)
      .eq('direction', 'incoming')
    if (error) {
      // Non-fatal (same philosophy as markPrepared): restore the local flag so
      // the UI doesn't claim a cleared state the DB still has.
      patchLocal(inv.id, { payment_prepared_at: inv.payment_prepared_at })
    }
    showToast('Genoteerd — factuur blijft open als te betalen')
  }

  // ── [PAY-SAFE-CONFIRM] Gate Betalen-action through the existing pay flow ──

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
      // [PAY-SAFE-CONFIRM] Confirmed paid → the "prepared" marker has served
      // its purpose; clear it so a paid row never shows "wacht op bevestiging".
      patch.payment_prepared_at = null
    } else {
      patch.payment_method = null
      patch.marked_paid_at = null
      patch.payment_date   = null
      // [PAY-SAFE-CONFIRM] Undo paid → back to a clean unpaid row, no stale marker.
      patch.payment_prepared_at = null
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
        payment_prepared_at: null,
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
      patchLocal(ctx.id, { payment_method: null, payment_date: null, payment_prepared_at: null })
      showToast(`Betaling ongedaan gemaakt`)
    }
    // [CASH-SETTLE] Keep the kasboek in sync with this cash pay/undo — create/heal the linked
    // 'betaling' entry, or remove it on an undo. This UI updates the invoice directly (not via
    // the confirm endpoint), so it must trigger the reconcile itself. Fire-and-forget; the
    // invoice write already succeeded, and the kasboek load reconciles again as a backstop.
    if (!error) fetch('/api/cash/settle', { method: 'POST' }).catch(() => {})
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

  // [BRIDGE-POLISH 3b fix] Open PDF via the signed-URL route — NOT the raw
  // pdf_url. Storage paths (e.g. "incoming/...pdf") are not directly fetchable;
  // they 404 as relative URLs. /api/email/file/[id] returns a short-lived signed
  // URL, exactly as the verification queue (IncomingInvoicesClient) does.
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null)
  async function openPdf(id: string) {
    setPdfLoadingId(id)
    try {
      const res = await fetch(`/api/email/file/${id}`)
      const data = await res.json()
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer')
      } else {
        showToast(data.error || 'Kon bestand niet openen')
      }
    } catch {
      showToast('Kon bestand niet openen')
    } finally {
      setPdfLoadingId(null)
    }
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
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5f6368' }}>inbox</span>
          </Link>
        </div>

        {/* Filter + Sort dropdowns (side by side) */}
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Filter */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <button
              onClick={() => { setShowFilterMenu(p => !p); setShowSortMenu(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', padding: '10px 14px', background: M3.primaryContainer, borderRadius: R.md, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: M3.onPrimaryContainer, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {FILTERS.find(f => f.id === filter)?.label ?? 'Alle'}
              </span>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.onPrimaryContainer, flexShrink: 0 }}>
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

          {/* [SORT] Sorteren op — invoice/payment/due date, amount, vendor, or date added */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <button
              onClick={() => { setShowSortMenu(p => !p); setShowFilterMenu(false) }}
              title="Sorteren"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', padding: '10px 14px', background: '#F1F3F4', borderRadius: R.md, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#49454F', flexShrink: 0 }}>swap_vert</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#49454F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {SORTS.find(s => s.id === sortBy)?.label ?? 'Sorteren'}
                </span>
              </span>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#49454F', flexShrink: 0 }}>
                {showSortMenu ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {showSortMenu && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', borderRadius: R.md, marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', maxHeight: '60vh', overflowY: 'auto' }}>
                {SORTS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSortBy(s.id); setShowSortMenu(false) }}
                    style={{ display: 'block', width: '100%', padding: '12px 16px', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: sortBy === s.id ? 600 : 400, background: sortBy === s.id ? M3.primaryContainer : '#fff', color: sortBy === s.id ? M3.onPrimaryContainer : M3.onSurface, borderBottom: '0.5px solid #F1F3F4' }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── List ── */}
      <main style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px 100px' }}>
        {/* [AUTO-ADVANCE] Review nudge — the opt-in double-check for what the app booked itself. */}
        {autoCount > 0 && filter !== 'auto' && (
          <button
            onClick={() => { setFilter('auto'); setShowFilterMenu(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginBottom: 10, padding: '10px 14px', borderRadius: R.md, border: '1px solid #D2E3FC', background: '#E8F0FE', color: '#1A73E8', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600, textAlign: 'left' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>auto_awesome</span>
            {autoCount === 1 ? '1 factuur is automatisch verwerkt — bekijk' : `${autoCount} facturen zijn automatisch verwerkt — bekijk`}
          </button>
        )}
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
              // [PAY-SAFE-CONFIRM] prepared-but-unconfirmed: payment QR generated,
              // owner hasn't confirmed paying yet. Only meaningful while unpaid.
              const isPrepared = inv.status === 'received' && !!inv.payment_prepared_at
              // [CROSS-QUARTER] Paid in a different quarter than booked → marker (accrual
              // unchanged). null for same-quarter / unpaid / undated.
              const xq = isPaid ? crossQuarterPayment(inv.invoice_date, inv.payment_date) : null

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
                    style={{ background: highlightId === inv.id ? M3.primaryContainer : '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.4s ease' }}
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
                        {recon[inv.id] && (
                          <ReconBadge recon={recon[inv.id]} mode="zzp" invoiceId={inv.id} onReconConfirm={async (id) => {
                            // [BANK-RECON-CONFIRM] Book a safe (reference-backed) match in one tap;
                            // an amount-only match ('navigate') opens the bank page to review.
                            const r = await confirmMatch(id)
                            if (r === 'ok') { patchLocal(id, { status: 'paid' }); showToast('Betaling bevestigd ✓') }
                            else if (r === 'navigate') router.push('/dashboard/bank')
                            else showToast('Bevestigen mislukt — probeer het op de Bank-pagina')
                          }} />
                        )}
                        {xq && (
                          <span
                            title={`Voor de btw telt deze factuur mee in ${xq.bookedQuarterLabel} (factuurdatum). De betaling kwam binnen in ${xq.paidQuarterLabel}.`}
                            style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: '#FFF3E0', color: '#B26A00', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>event_available</span>
                            Betaald in {xq.paidQuarterLabel}
                          </span>
                        )}
                        {/* [AUTO-ADVANCE] booked automatically (clean + confident) — a review cue,
                            not an alarm. The owner can open the invoice and undo if it's wrong. */}
                        {isAutoVerified(inv) && (
                          <span
                            title="Deze factuur was duidelijk leesbaar en is automatisch geverifieerd. Controleer indien je twijfelt."
                            style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: '#E8F0FE', color: '#1A73E8', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>auto_awesome</span>
                            Automatisch
                          </span>
                        )}
                        {/* [3b-2] accountant Verwerkt — READ-ONLY badge */}
                        {isVerwerkt && (
                          <span style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: M3.successContainer, color: '#137333' }}>
                            Verwerkt
                          </span>
                        )}
                        {/* [PAY-SAFE-CONFIRM] prepared, awaiting the owner's confirm.
                            A UI marker — NOT a paid state. */}
                        {isPrepared && (
                          <span style={{ fontSize: 11, fontWeight: 500, borderRadius: R.full, padding: '2px 10px', background: M3.primaryContainer, color: M3.onPrimaryContainer, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>schedule</span>
                            Voorbereid
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

                      {/* received → confirm payment (gated by no-double-pay check).
                          After prepare, becomes a prominent "Ik heb betaald" CTA
                          that PERSISTS — catching the owner on return from their
                          bank. Both variants route through the SAME requestPay
                          (check → Bank/Contant + date → paid). */}
                      {inv.status === 'received' && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (processingId === inv.id || checkingId === inv.id) return
                            requestPay(inv)
                          }}
                          style={{
                            fontSize: 12, fontWeight: isPrepared ? 600 : 500, borderRadius: R.full,
                            border: 'none', cursor: 'pointer', padding: '6px 14px', fontFamily: FONT,
                            background: isPrepared ? M3.primary : M3.surfaceVariant,
                            color: isPrepared ? M3.onPrimary : '#5f6368',
                            display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                          }}>
                          {processingId === inv.id || checkingId === inv.id
                            ? <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_empty</span>
                            : isPrepared
                              ? <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>task_alt</span> Heb je betaald?</>
                              : 'Heb je betaald?'}
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
                        {/* [PAY-SAFE] Prepare payment — only for unpaid rows. Opens
                            the QR + copy sheet. No DB write; pure preparation. */}
                        {inv.status === 'received' && (
                          <button
                            onClick={e => { e.stopPropagation(); setPrepareCtx(inv) }}
                            style={{ fontSize: 13, color: M3.onPrimary, background: M3.primary, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>qr_code_2</span>
                            Betalen
                          </button>
                        )}
                        {inv.pdf_url && (
                          <button
                            onClick={e => { e.stopPropagation(); if (pdfLoadingId !== inv.id) openPdf(inv.id) }}
                            style={{ fontSize: 13, color: M3.primary, background: M3.primaryContainer, border: 'none', borderRadius: R.full, padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              {pdfLoadingId === inv.id ? 'hourglass_empty' : 'picture_as_pdf'}
                            </span>
                            Bekijk PDF
                          </button>
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
          // [PAY-NOT-YET] Third answer on mark-paid only: "no, I have not paid".
          // Clears the prepared marker (Voorbereid chip + nudge disappear); the
          // invoice stays open as te betalen. Undo-paid keeps its two buttons.
          secondaryAction={
            payCtx.newStatus === 'paid'
              ? {
                  label: 'Nee, nog niet betaald',
                  onClick: () => {
                    const inv = invoices.find(i => i.id === payCtx.id)
                    setPayCtx(null)
                    if (inv) markNotPaid(inv)
                  },
                }
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

      {/* ── [PAY-SAFE] Prepare-payment sheet (QR + copy details) ── */}
      {prepareCtx && (
        <PreparePaymentSheet
          inv={prepareCtx}
          onClose={() => { markPrepared(prepareCtx); setPrepareCtx(null) }}
          onConfirmPaid={() => {
            const inv = prepareCtx
            markPrepared(prepareCtx)
            setPrepareCtx(null)
            if (inv) requestPay(inv)
          }}
          onCopied={(what) => showToast(`${what} gekopieerd ✓`)}
        />
      )}

      {/* ── [PAY-SAFE] No-double-pay warning ── */}
      {dupWarn && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setDupWarn(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24, color: M3.warning }}>warning</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: M3.onSurface, margin: 0 }}>Mogelijk al betaald</h3>
            </div>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 8px' }}>
              Je hebt mogelijk al een factuur van dezelfde leverancier voor hetzelfde bedrag betaald:
            </p>
            <div style={{ background: '#F8F9FA', borderRadius: R.md, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#202124' }}>
              <div style={{ fontWeight: 600 }}>{dupWarn.match.client_name ?? '—'}</div>
              <div style={{ color: '#5F6368', marginTop: 2 }}>
                {dupWarn.match.invoice_number ? `Factuur ${dupWarn.match.invoice_number} · ` : ''}
                {fmtEur(dupWarn.match.total_inc_btw)}
                {dupWarn.match.payment_date ? ` · betaald ${fmtDate(dupWarn.match.payment_date)}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
              {/* [PAY-SAFE] Primary helpers: see the original, or remove this copy */}
              {dupWarn.match.id && (
                <button
                  onClick={() => viewOriginal(dupWarn.match.id)}
                  style={{ width: '100%', padding: '12px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  Bekijk de betaalde factuur
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                </button>
              )}
              <button
                onClick={() => archiveDuplicate(dupWarn.ctx.id)}
                style={{ width: '100%', padding: '12px', borderRadius: R.full, background: M3.primaryContainer, color: M3.onPrimaryContainer, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                Deze dubbele verwijderen
              </button>
              {/* The owner can still insist this is a separate, genuinely-due invoice */}
              <button
                onClick={() => { const c = dupWarn.ctx; setDupWarn(null); setPayCtx(c) }}
                style={{ width: '100%', padding: '12px', borderRadius: R.full, background: 'transparent', color: M3.warning, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                Toch markeren als betaald
              </button>
              <button onClick={() => setDupWarn(null)} style={{ width: '100%', padding: '12px', borderRadius: R.full, background: 'transparent', color: '#5F6368', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: '#202124', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.sm, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', animation: 'fadeInUp 0.2s ease', fontFamily: FONT }}>
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
      <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: mono ? "'Roboto Mono', monospace" : 'inherit' }}>{value}</p>
    </div>
  )
}

function BottomSheet({ title, body, confirmLabel, confirmBg, onConfirm, onCancel, paymentChoice, secondaryAction }: {
  title: string
  body: string
  confirmLabel: string
  confirmBg: string
  onConfirm: () => void
  onCancel: () => void
  paymentChoice?: (method: 'bank' | 'kas', paymentDate: string) => void
  // [PAY-NOT-YET] Optional third answer between confirm and Annuleren — e.g.
  // "Nee, nog niet betaald" (clears the prepared marker; invoice stays open).
  // Distinct from Annuleren: this is an ANSWER (writes state), Annuleren is
  // "ask me later" (keeps everything). Absent → sheet renders exactly as before.
  secondaryAction?: { label: string; onClick: () => void }
}) {
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: 28, padding: '28px 24px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 48px rgba(0,0,0,0.24)', fontFamily: FONT }}>
        <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 12, textAlign: 'center', letterSpacing: -0.3 }}>{title}</p>
        <p style={{ fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>{body}</p>

        {paymentChoice ? (
          <>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 6 }}>Betaaldatum</label>
            <input
              type="date"
              value={paymentDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setPaymentDate(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #DADCE0', fontSize: 15, marginBottom: 16, fontFamily: FONT, color: '#202124', background: '#fff', boxSizing: 'border-box' }}
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
            {/* [PAY-NOT-YET] The third honest answer: "no, I have not paid".
                An ANSWER (clears the prepared marker via secondaryAction), not
                Annuleren ("ask me later", which keeps the marker + nudge). */}
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                style={{ width: '100%', padding: '13px', borderRadius: R.full, background: '#fff', color: '#5f6368', fontSize: 15, fontWeight: 600, border: '1px solid #DADCE0', cursor: 'pointer', fontFamily: FONT, marginBottom: 10 }}
              >
                {secondaryAction.label}
              </button>
            )}
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
      <p style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 4, fontFamily: FONT }}>Geen inkoopfacturen</p>
      <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT }}>Bevestigde inkoopfacturen verschijnen hier</p>
    </div>
  )
}

// ─── [PAY-SAFE] Prepare-payment sheet — QR + copy details ─────────────────────
// PURE preparation. Generates an EPC069-12 QR (client-side, the IBAN never
// leaves the browser) the owner scans with their OWN bank app, plus copyable
// IBAN / amount / reference for mobile (the cashier's primary case). NO DB
// write, NO money movement. Closing it leaves the invoice exactly as it was
// ('received') — preparing then cancelling has zero effect, by design.
function PreparePaymentSheet({
  inv,
  onClose,
  onConfirmPaid,
  onCopied,
}: {
  inv: IncomingRow
  onClose: () => void
  onConfirmPaid: () => void
  onCopied: (what: string) => void
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  const amount = inv.total_inc_btw ?? 0
  // Reference: betalingskenmerk when present, else the invoice number (the EPC
  // remittance field — what the owner quotes when paying).
  const reference = (inv.payment_reference ?? inv.invoice_number ?? '').trim()
  const ibanOk = isValidIban(inv.vendor_iban)
  const ibanDisplay = (inv.vendor_iban ?? '').replace(/(.{4})/g, '$1 ').trim()

  useEffect(() => {
    let cancelled = false
    async function gen() {
      const built = buildEpcQrPayload({
        iban: inv.vendor_iban ?? '',
        name: inv.client_name ?? '',
        amount,
        reference,
      })
      if (!built.ok || !built.payload) {
        if (!cancelled) setQrError(built.error ?? 'Geen QR mogelijk')
        return
      }
      try {
        // Dynamic import keeps qrcode out of the main bundle until needed.
        const QR = await import('qrcode')
        const url = await QR.toDataURL(built.payload, { margin: 1, width: 240 })
        if (!cancelled) setQrDataUrl(url)
      } catch {
        if (!cancelled) setQrError('QR kon niet worden gegenereerd')
      }
    }
    gen()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.id])

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      onCopied(label)
    } catch {
      onCopied(label) // best-effort; clipboard may be blocked in some contexts
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: '28px 28px 0 0', padding: '24px 20px 32px', width: '100%', maxWidth: 480, boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', fontFamily: FONT, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ width: 32, height: 4, background: '#DADCE0', borderRadius: 2, margin: '0 auto 20px' }} />
        <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 4, textAlign: 'center', letterSpacing: -0.3 }}>Betalen</p>
        <p style={{ fontSize: 13, color: '#5F6368', textAlign: 'center', marginBottom: 20 }}>
          Scan met je bankapp of kopieer de gegevens. Je betaalt in je eigen bank.
        </p>

        {ibanOk ? (
          <>
            {/* QR */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="Betaal-QR" width={220} height={220} style={{ borderRadius: 12, border: '1px solid #E0E0E0' }} />
              ) : qrError ? (
                <div style={{ fontSize: 13, color: M3.error, textAlign: 'center', padding: 20 }}>{qrError}</div>
              ) : (
                <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9AA0A6' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 32 }}>hourglass_empty</span>
                </div>
              )}
            </div>

            {/* Copy rows */}
            <CopyRow label="IBAN" value={ibanDisplay} raw={(inv.vendor_iban ?? '')} onCopy={copy} />
            <CopyRow label="Bedrag" value={fmtEur(amount)} raw={amount.toFixed(2)} onCopy={copy} />
            {reference && <CopyRow label="Kenmerk" value={reference} raw={reference} onCopy={copy} />}
            <CopyRow label="Naam" value={inv.client_name ?? '—'} raw={inv.client_name ?? ''} onCopy={copy} />
          </>
        ) : (
          // No valid IBAN → honest fallback, no QR.
          <div style={{ background: M3.warningContainer, borderRadius: R.md, padding: '14px 16px', marginBottom: 20, fontSize: 13, color: '#7C5800', lineHeight: 1.5 }}>
            Geen geldig IBAN gevonden op deze factuur. Open de PDF om het rekeningnummer te bekijken en betaal handmatig in je bankapp.
          </div>
        )}

        {/* [PAY-SAFE-CONFIRM] Closing the QR ≠ paid. Ask directly — "Ja" routes
            to the Bank/Contant + date flow; "Nog niet" just closes (stays unpaid).
            Wording = "verstuurd" (sent), not "aangekomen" — SEPA takes time. */}
        <p style={{ fontSize: 15, fontWeight: 700, color: '#202124', textAlign: 'center', margin: '4px 0 12px', fontFamily: FONT }}>
          Heb je de betaling verstuurd?
        </p>
        <button onClick={onConfirmPaid} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>
          Ja, ik heb betaald
        </button>
        <button onClick={onClose} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: M3.surfaceVariant, color: '#5f6368', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, marginTop: 8 }}>
          Nog niet
        </button>
      </div>
    </div>
  )
}

function CopyRow({ label, value, raw, onCopy }: {
  label: string
  value: string
  raw: string
  onCopy: (value: string, label: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#F8F9FA', borderRadius: R.md, marginBottom: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, color: '#5F6368', fontWeight: 500, marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', fontFamily: FONT_NUM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</p>
      </div>
      <button
        onClick={() => onCopy(raw, label)}
        aria-label={`Kopieer ${label}`}
        style={{ background: M3.primaryContainer, border: 'none', borderRadius: R.full, width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.primary }}>content_copy</span>
      </button>
    </div>
  )
}