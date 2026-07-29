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
// [TZ] The owner's Amsterdam day, never the UTC one — see format-nl.ts.
import { amsterdamToday } from '@/lib/format-nl'
import { STICKY_BELOW_HEADER } from '@/lib/design/tokens'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
import type { InvoiceRecon } from '@/lib/bank-reconciliation'
import { ReconBadge } from '@/components/invoice/InvoiceRow'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
// [PAY-SAFE] EPC QR payload + IBAN validation (pure, client-safe)
import { buildEpcQrPayload, isValidIban } from '@/lib/epc-qr'
// [BUNDEL-BETALING] several supplier invoices → ONE prepared transfer (pure, client-safe)
import { buildBundelBetaling, type BundelBetalingResult } from '@/lib/bundel-betaling'
// [PARTIAL-PAY] one shared definition of openstaand + the amount-field interpretation
import { openAmount, interpretAmountEntry } from '@/lib/partial-payment'
import { crossQuarterPayment } from '@/lib/quarter'
// [OVER-DATUM] one pure answer to "hoeveel dagen te laat?" — never an assumed payment term
import { overdueDays, daysUntilDue } from '@/lib/overdue'
import { rowMatchesQuery } from '@/lib/search'
// [SORT] Shared ordering (also used by Vandaag) — one implementation, no drift.
import { sortRows, SORTS, type SortKey } from '@/lib/invoice-sort'
// [INVOICE-REMOVE] The same rule the sales list uses, so "Verwijderen" means the same thing on
// both sides of the app — and the server re-checks it before writing.
import { decideRemoval, type RemovalDecision, type RemovalInvoice } from '@/lib/invoice-removal'

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
const NL_DATE_Y = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtEur  = (n: number | null) => NL_EUR.format(n ?? 0)
const fmtDate = (s: string | null) => s ? NL_DATE.format(new Date(s)) : '—'
// [DATE-VISIBLE] The row date, with the YEAR only when it isn't this year. "12 mrt" is fine for a
// recent bill and ambiguous on a two-year-old one; printing 2026 on every row is noise. Guards an
// unparseable date too — Intl.format THROWS on an Invalid Date, which would blank the whole list.
const fmtDateSmart = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.getFullYear() === new Date().getFullYear() ? NL_DATE.format(d) : NL_DATE_Y.format(d)
}
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
  // [PARTIAL-PAY] running total already settled by instalments (0 when fully open). A value between
  // 0 and |total_inc_btw| means the invoice is a deelbetaling: still openstaand, part paid.
  amount_paid?: number | null
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
  // [MANUAL-PARTIAL-PAY] null/absent = settle the whole open balance; a number = instalment.
  amount?: number | null
  clientKey?: string
  // What was still open when the dialog opened — the field's hint and cap.
  openAmount?: number
}

// [MATCH-BUTTON] The report POST /api/reconcile/run hands back — what the engine actually did,
// plus what it deliberately left for the owner. Shaped to be shown as-is; no client-side money math.
interface MatchRunResult {
  ok: boolean
  /** Names the passes that failed ('bank' | 'kas' | 'categorize' | 'map') — shown honestly. */
  failed: string[]
  booked: { invoiceId: string; invoiceNumber: string | null; amount: number; tier: string; paymentDate: string | null }[]
  bookedCount: number
  /** Of the bookings, the ones matched on amount + name only (no invoice number) — worth a check. */
  amountOnlyCount: number
  cash: { ok: boolean; created: number; updated: number; deleted: number }
  categorized: number
  /** Bank lines still unconfirmed after the run. 0 with 0 bookings ⇒ no statement to match against. */
  pendingTransactions: number
  /** Payments FOUND but too ambiguous to book — these need the owner on /dashboard/bank. */
  pendingMatchCount: number
  /** The post-run badge map, from the same builder the badges normally fetch (see applyMap). */
  byInvoice?: Record<string, InvoiceRecon>
}

type FilterTab = 'all' | 'received' | 'paid' | 'auto'
const FILTERS: { id: FilterTab; label: string }[] = [
  { id: 'all',      label: 'Alle'                  },
  { id: 'received', label: 'Te betalen'            },
  { id: 'paid',     label: 'Betaald'               },
  { id: 'auto',     label: 'Automatisch verwerkt'  },
]

// [SORT] Ordering moved to the shared module (@/lib/invoice-sort) — SORTS,
// SortKey and sortRows are imported above. Default stays 'added_desc' (nieuwste
// import bovenaan) so the screen looks unchanged until the owner picks another order.

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IncomingManageClient({
  profile,
  initialInvoices,
  totalCount = null,
}: {
  profile: { id: string }
  initialInvoices: IncomingRow[]
  // [INVOICE-COUNTER] How many confirmed inkoopfacturen the owner really has (server count).
  // Only used to disclose that this list is capped — never as the counter itself, because it
  // cannot move when the owner pays a factuur. Null when the count query failed.
  totalCount?: number | null
}) {
  const router   = useRouter()
  const supabase = createClient()
  // [BANK-RECON-BADGE] Per-invoice reconciliation vs the bank statement (fail-soft).
  // [MATCH-BUTTON] applyMap installs the post-run map the matcher returns (no second fetch).
  const { byInvoice: recon, confirmMatch, applyMap } = useInvoiceReconciliation()
  const [invoices, setInvoices]         = useState<IncomingRow[]>(initialInvoices)
  const [filter, setFilter]             = useState<FilterTab>('all')
  const [search, setSearch]             = useState('')  // [SEARCH] in-page live filter
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortBy, setSortBy]             = useState<SortKey>('added_desc')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [payCtx, setPayCtx]             = useState<PayCtx | null>(null)
  // [INVOICE-REMOVE] The confirm dialog for "Verwijderen": the invoice + what removing it means.
  const [removeCtx, setRemoveCtx]       = useState<{ id: string; decision: RemovalDecision } | null>(null)
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
  // [MATCH-BUTTON] On-demand reconciliation run (bank + kas + categorization) and its report.
  const [matchBusy, setMatchBusy]       = useState(false)
  const [matchResult, setMatchResult]   = useState<MatchRunResult | null>(null)

  // ── [BUNDEL-BETALING] Multi-select → pay several open inkoopfacturen of the
  // same leverancier in ONE transfer. Selection is a set of ids; the rows are
  // derived from this page's own list (single client-owned array, no pagination).
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({})
  // The sheet snapshot: the rows being paid + the pure-built QR/details.
  const [bundleCtx, setBundleCtx] = useState<{ rows: IncomingRow[]; built: BundelBetalingResult } | null>(null)
  // Bank/Contant + date dialog for the WHOLE set (one answer, N invoices).
  const [bundlePayRows, setBundlePayRows] = useState<IncomingRow[] | null>(null)
  const [bundleBusy, setBundleBusy] = useState(false)

  const selectedRows = invoices.filter(i => selectedIds[i.id])
  // Live validation — pure and cheap, so the action bar can explain itself
  // (same-IBAN rule, missing IBAN, sum) on every tap.
  const bundleBuilt = selectedRows.length >= 2 ? buildBundelBetaling(selectedRows) : null
  const openSum = selectedRows.reduce((s, r) => {
    const tot = Math.abs(r.total_inc_btw ?? 0)
    return s + Math.max(0, tot - Math.max(0, r.amount_paid ?? 0))
  }, 0)

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }
  function exitSelectMode() { setSelectMode(false); setSelectedIds({}) }

  // ── [BUNDEL-BETALING] "Ja, ik heb betaald" for the whole set: one Bank/Contant
  // + date answer, then N audited pay-toggle writes (the SAME server path as a
  // single invoice — every mutation audited, nothing new invented). Failures
  // (e.g. a verwerkt lock) leave that invoice open and are reported honestly.
  async function executeBundlePay(rows: IncomingRow[], method: 'bank' | 'kas', paymentDate: string) {
    setBundlePayRows(null)
    setBundleBusy(true)
    let okCount = 0
    const failedNumbers: string[] = []
    for (const row of rows) {
      try {
        const res = await fetch('/api/invoice/pay-toggle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId: row.id, action: 'pay', paymentMethod: method, paymentDate }),
        })
        if (res.ok) {
          okCount++
          patchLocal(row.id, {
            status: 'paid',
            payment_method: method,
            payment_date: paymentDate,
            payment_prepared_at: null,
          })
        } else {
          failedNumbers.push(row.invoice_number ?? '—')
        }
      } catch {
        failedNumbers.push(row.invoice_number ?? '—')
      }
    }
    if (okCount > 0) {
      // One summary notification for the batch (service role via API; non-blocking).
      try {
        await fetch('/api/notifications/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Inkoopfacturen betaald',
            body: `${okCount} inkoopfacturen zijn gemarkeerd als betaald.`,
            type: 'payment',
          }),
        })
      } catch { /* non-blocking — payments already succeeded */ }
      // [CASH-SETTLE] keep the kasboek in sync once for the whole batch.
      fetch('/api/cash/settle', { method: 'POST' }).catch(() => {})
    }
    showToast(
      failedNumbers.length === 0
        ? `${okCount} inkoopfacturen betaald ✓`
        : `${okCount} betaald ✓ — niet gelukt: ${failedNumbers.join(', ')}`
    )
    setBundleBusy(false)
    exitSelectMode()
  }

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
    // Expand + highlight on the next tick (never synchronously in the effect
    // body — avoids a cascading re-render during the effects pass).
    const applyTimer = setTimeout(() => {
      setExpandedId(focusId)
      setHighlightId(focusId)
    }, 0)
    // Wait a tick for the row to render, then scroll to it.
    const scrollTimer = setTimeout(() => {
      rowRefs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    // Fade the highlight after a few seconds — a cue, not a permanent state.
    const fadeTimer = setTimeout(() => setHighlightId(null), 3200)
    return () => { clearTimeout(applyTimer); clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
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

  // [SEARCH] In-page live filter (leverancier / factuurnummer / bedrag), on top of the
  // status tabs — in place, no navigation.
  const rawS = search.trim()
  const displayed = sortRows(
    invoices.filter(inv => {
      const tabOk = filter === 'all' ? true : filter === 'auto' ? isAutoVerified(inv) : inv.status === filter
      if (!tabOk) return false
      // [SMART-FILTER] shared matcher — leverancier / factuurnummer / bedrag
      // (decimaal- én duizendtal-bewust, zie src/lib/search.ts)
      return rowMatchesQuery(rawS, [inv.client_name, inv.invoice_number], [inv.total_inc_btw])
    }),
    sortBy,
  )
  // [AUTO-ADVANCE] Count for the review nudge — how many invoices the app booked for you.
  const autoCount = invoices.filter(isAutoVerified).length

  // ── [INVOICE-COUNTER] "Hoeveel facturen heb ik eigenlijk?" ───────────────────
  // Derived from `invoices` on every render, NOT from a server number fetched once. That is the
  // whole point: the moment a factuur is betaald, undone, matched by the bank-run or removed as a
  // duplicate, this array changes and so do the counts. A server total could not move with those
  // actions and would sit there contradicting the list.
  //
  // The trade-off is honest and disclosed: `invoices` is the fetched window (all open rows — the
  // 1000-cap is unreachable by design — plus the 200 most recent paid ones), so on a long history
  // these are the counts of THIS LIST. totalCount says what the owner really has, and the note
  // below the counter names the difference instead of passing 200 off as "everything".
  // [OVER-DATUM] Today as a plain ISO day, computed ONCE per render and passed to every row, so
  // all rows are judged against the same boundary (and overdueDays stays pure — it never reads a
  // clock itself). Local date, not toISOString(): near midnight UTC those are different days, and
  // "te laat" must follow the owner's calendar, not UTC's.
  const todayIso = (() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  })()

  const receivedCount = invoices.filter(i => i.status === 'received').length
  const paidCount     = invoices.filter(i => i.status === 'paid').length
  const listedCount   = invoices.length
  const hiddenCount   = totalCount != null ? Math.max(0, totalCount - listedCount) : 0
  const nFacturen = (n: number) => `${n} ${n === 1 ? 'factuur' : 'facturen'}`
  // Per-tab counts, so choosing a filter already tells you how much is behind it.
  const tabCount = (id: FilterTab) =>
    id === 'all' ? listedCount : id === 'received' ? receivedCount : id === 'paid' ? paidCount : autoCount

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // Local optimistic patch (no hook — this surface owns its list)
  function patchLocal(id: string, patch: Partial<IncomingRow>) {
    setInvoices(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  // ── [MATCH-BUTTON] "Matchen met bank & kas" ──────────────────────────────────
  // Turns the whole matching circle on demand instead of waiting for the hourly cron: the server
  // books the near-certain bank↔factuur matches, syncs the kasboek against the cash-paid invoices,
  // and codes the recognizable bank lines. It does NOT decide anything the automatic engine
  // wouldn't decide by itself — same helpers, same guards, so an ambiguous payment still stops at
  // the human (it comes back as pendingMatchCount, not as a booking).
  //
  // We patch the booked rows locally with the values the server actually wrote (incl. the bank
  // line's date as payment date) and install the returned reconciliation map, so the badges and
  // the report cannot disagree. No router.refresh(): this list is client-owned state seeded once,
  // so a server re-render would not update it — the patch is the update.
  async function runReconciliation() {
    if (matchBusy) return
    setMatchBusy(true)
    try {
      const res = await fetch('/api/reconcile/run', { method: 'POST' })
      if (!res.ok) {
        // Kept short on purpose — the toast is a single non-wrapping line. A 429 costs the owner
        // nothing: the run is idempotent and the hourly cron does the same work anyway.
        showToast(
          res.status === 429 ? 'Te vaak gematcht — probeer het straks opnieuw'
          : res.status === 401 ? 'Sessie verlopen — log opnieuw in'
          : 'Matchen mislukt — probeer het opnieuw'
        )
        return
      }
      const json = (await res.json()) as MatchRunResult
      for (const b of json.booked ?? []) {
        patchLocal(b.invoiceId, {
          status: 'paid',
          payment_method: 'bank',
          payment_date: b.paymentDate,
          // The payment is settled — the "voorbereid, nog bevestigen" nudge is done.
          payment_prepared_at: null,
        })
      }
      if (json.byInvoice) applyMap(json.byInvoice)
      setMatchResult(json)
    } catch {
      showToast('Matchen mislukt — probeer het opnieuw')
    } finally {
      setMatchBusy(false)
    }
  }

  // ── [PAY-SAFE] No-double-pay gate — runs BEFORE the mark-paid dialog ──
  // Server check (read-only) for an already-paid twin (same vendor + amount,
  // recent). If found → warn and let the owner decide. If not → open the normal
  // pay dialog. A failed check NEVER blocks paying (warn-don't-block, and the
  // check is a convenience, not a guard). 'received' → 'paid' only; an undo
  // (paid → received) skips the check entirely.
  async function requestPay(inv: IncomingRow) {
    // [MANUAL-PARTIAL-PAY] openAmount = what is still owed (the full total on an untouched
    // invoice, the remainder once instalments were recorded) — the amount field's hint and cap.
    const ctx: PayCtx = { id: inv.id, number: inv.invoice_number ?? '', newStatus: 'paid', openAmount: openAmount(inv) }
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

  // ── [INVOICE-REMOVE] "Verwijderen" on a purchase invoice ──────────────────────────────────
  // A supplier invoice lands here from e-mail, upload or intake — so a wrong one lands here too:
  // someone else's invoice, a duplicate the dedup missed, a scan of nothing. Removing it must be
  // as ordinary as adding it. Under the hood it ARCHIVES (status 'archived'), never a physical
  // delete: the bewaarplicht keeps the record and the owner keeps the undo (on /dashboard/incoming
  // under "Genegeerd"). The dialog says exactly that before anything happens, and a paid or
  // accountant-verwerkt invoice is refused with the way out named instead.
  function handleRemoveRequest(inv: IncomingRow) {
    setRemoveCtx({ id: inv.id, decision: decideRemoval(inv as RemovalInvoice) })
  }

  async function executeRemoval(ctx: { id: string; decision: RemovalDecision }) {
    const { id, decision } = ctx
    setRemoveCtx(null)
    if (!decision.allowed) return // a dead end the dialog already explained

    setProcessingId(id)
    try {
      const res = await fetch(`/api/invoice/${id}/archive`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server asked the same questions of fresher data. Show ITS answer, not ours.
        showToast(json?.detail || 'Verwijderen mislukt — ververs de pagina')
        return
      }
      setInvoices(prev => prev.filter(i => i.id !== id))
      const notices: string[] = Array.isArray(json?.notices) ? json.notices : []
      showToast(notices.length > 0 ? notices[0] : 'Verwijderd — terug te zetten bij Inkomend › Genegeerd')
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
    // [MANUAL-PARTIAL-PAY] A deelbetaling leaves the invoice on 'Te betalen' — only a full
    // settlement flips the status, so don't claim otherwise before the server answers.
    const isPartialIntent = ctx.newStatus === 'paid' && ctx.amount != null
    if (!isPartialIntent) patchLocal(ctx.id, { status: ctx.newStatus })

    // [PAY-TOGGLE] Route through the server so the mutation is AUDITED and — crucially on undo —
    // any bank transaction matched to this invoice is DETACHED (never a paid-undone invoice beside
    // a still-'matched' tx that the owner could pay a second time). The old direct client write did
    // neither.
    const res = await fetch('/api/invoice/pay-toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId: ctx.id,
        action: ctx.newStatus === 'paid' ? 'pay' : 'undo',
        paymentMethod: ctx.paymentMethod ?? 'bank',
        paymentDate: ctx.paymentDate ?? amsterdamToday(),
        ...(ctx.amount != null ? { amount: ctx.amount } : {}),
        ...(ctx.clientKey ? { clientKey: ctx.clientKey } : {}),
      }),
    })
    const json = await res.json().catch(() => ({} as { error?: string }))
    // [DEPLOY-SAFE] Prefer the server's own sentence when it has one (e.g. a partial cash
    // payment refused because the kasboek cannot date it per instalment yet) — the bare
    // error CODE would reach the owner as gibberish.
    const error = res.ok ? null : { message: (json as { detail?: string })?.detail || json?.error || 'Bijwerken mislukt' }

    if (error) {
      // rollback optimistic
      const prev = ctx.newStatus === 'paid' ? 'received' : 'paid'
      if (!isPartialIntent) patchLocal(ctx.id, { status: prev })
      // [BOEK-004] verwerkt conflict (trigger) → actionable dialog; else toast
      if (error.message && error.message.includes('verwerkt')) {
        setRequestSent(false)
        setVerwerktCtx({ id: ctx.id, number: ctx.number })
      } else {
        showToast(error.message || 'Bijwerken mislukt')
      }
    } else if (ctx.newStatus === 'paid') {
      const patch = {
        payment_method: (ctx.paymentMethod ?? 'bank') as 'kas' | 'bank',
        payment_date: ctx.paymentDate ?? amsterdamToday(),
      }
      // [MANUAL-PARTIAL-PAY] The server decides: the typed amount may have completed the
      // invoice after all (the last instalment).
      const partial = (json as { partial?: boolean }).partial === true
      if (partial) {
        patchLocal(ctx.id, {
          amount_paid: (json as { amountPaid?: number }).amountPaid ?? null,
          payment_date: patch.payment_date,
        })
        showToast(`${fmtEur((json as { applied?: number }).applied ?? 0)} genoteerd · nog ${fmtEur((json as { remaining?: number }).remaining ?? 0)} open`)
      } else {
      // reflect the new payment fields locally
      patchLocal(ctx.id, {
        status: 'paid',
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
      }
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

      {/* ── Controls toolbar ── [SUBNAV] back + "Inkoopfacturen" title come from the
          shared sub-page header; this block keeps the Verificatie link + filter/sort,
          sticking directly below the shared bar. */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '12px 16px', position: 'sticky', top: STICKY_BELOW_HEADER, zIndex: 40,
      }}>
        {/* [BUNDEL-BETALING] Left: the multi-select toggle — the entry point for
            paying several facturen van één leverancier with one QR. Given a clear
            affordance (blue tint + border in rest, solid blue when active) and put
            on the LEFT so it reads first, not tucked in the corner. Right: the
            Verificatie shortcut. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <button onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            style={{
              background: selectMode ? M3.primary : M3.primaryContainer,
              border: `1px solid ${selectMode ? M3.primary : '#A8C7FA'}`,
              borderRadius: R.full, padding: '8px 16px', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              color: selectMode ? M3.onPrimary : M3.onPrimaryContainer,
              display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: selectMode ? 'none' : EL1,
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {selectMode ? 'close' : 'checklist'}
            </span>
            {selectMode ? 'Klaar' : 'Meerdere betalen'}
          </button>
          <Link href="/dashboard/incoming" title="Verificatie" style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', flexShrink: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5f6368' }}>inbox</span>
          </Link>
        </div>

        {/* ── [MATCH-BUTTON] Matchen met bank & kas ──────────────────────────────
            The one tap that turns the whole matching circle now instead of waiting
            for the hourly automatic run: bankafschrift ↔ facturen, kasboek ↔ the
            cash-paid invoices, plus categorization of the recognizable bank lines.
            Sized EXACTLY like "Meerdere betalen" above it (same pill geometry, same
            13px label) so the toolbar reads as one family, but kept solid primary
            because it is the only ACTION here that moves the books forward —
            everything else on this screen filters or decides one row. */}
        <button
          onClick={runReconciliation}
          disabled={matchBusy}
          title="Koppelt je inkoopfacturen aan het bankafschrift en aan de kas, en werkt alles bij wat zeker is"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 12, padding: '8px 16px',
            borderRadius: R.full, border: 'none',
            background: matchBusy ? M3.surfaceVariant : M3.primary,
            color: matchBusy ? '#9AA0A6' : M3.onPrimary,
            fontSize: 13, fontWeight: 600, fontFamily: FONT,
            cursor: matchBusy ? 'default' : 'pointer',
            boxShadow: matchBusy ? 'none' : EL1,
          }}
        >
          {/* Icons come from the SUBSET font in layout.tsx (icon_names=…) — 'link' (koppelen, the
              exact verb this action performs) and a spinning 'refresh' are both already in it, so
              no shared allowlist change is needed and nothing can render as raw ligature text. */}
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, animation: matchBusy ? 'bbSpin 1s linear infinite' : undefined }}
          >
            {matchBusy ? 'refresh' : 'link'}
          </span>
          {matchBusy ? 'Bezig met matchen…' : 'Matchen met bank & kas'}
        </button>

        {/* Filter + Sort dropdowns (side by side) */}
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Filter */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <button
              onClick={() => { setShowFilterMenu(p => !p); setShowSortMenu(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', padding: '10px 14px', background: M3.primaryContainer, borderRadius: R.md, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              {/* [INVOICE-COUNTER] The active filter carries its count, so the number is on
                  screen even with the menu closed and the list scrolled away. */}
              <span style={{ fontSize: 13, fontWeight: 600, color: M3.onPrimaryContainer, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {FILTERS.find(f => f.id === filter)?.label ?? 'Alle'} · {tabCount(filter)}
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
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '12px 16px', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: filter === f.id ? 600 : 400, background: filter === f.id ? M3.primaryContainer : '#fff', color: filter === f.id ? M3.onPrimaryContainer : M3.onSurface, borderBottom: '0.5px solid #F1F3F4' }}
                  >
                    <span>{f.label}</span>
                    {/* [INVOICE-COUNTER] How many rows this filter would show — so the owner
                        sees the split without having to pick each tab to find out. */}
                    <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: FONT_NUM, color: filter === f.id ? M3.onPrimaryContainer : '#5F6368', background: filter === f.id ? 'rgba(255,255,255,0.6)' : M3.surfaceVariant, borderRadius: R.full, padding: '1px 8px', flexShrink: 0 }}>
                      {tabCount(f.id)}
                    </span>
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
        {/* [SEARCH] In-page live filter */}
        {invoices.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Zoek op leverancier, factuurnummer of bedrag…"
              aria-label="Inkomende facturen zoeken"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 38px', borderRadius: 12, border: '1px solid #d1d1d6', fontSize: 14, outline: 'none', background: '#fff', color: '#1c1c1e' }}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Wissen"
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#e5e5ea', color: '#3a3a3c', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
            )}
          </div>
        )}

        {/* ── [INVOICE-COUNTER] Hoeveel facturen heb ik? ──────────────────────────
            One line, right above the list, that always answers it — and adapts to
            what the owner is doing instead of repeating what the filter already says:
              · zoeken        → how many rows the query found (his explicit ask)
              · geen filter   → the total plus the te-betalen / betaald split
              · wél een filter→ how many of the total this tab holds
            All three counts come from the loaded rows, so they move the instant a
            factuur is betaald, teruggedraaid, gematcht of als dubbel verwijderd.
            aria-live so a screen reader hears the number change while typing.
            Suppressed on a fruitless search — the empty message below already says
            "geen facturen gevonden voor …" and "0 facturen gevonden" adds nothing. */}
        {invoices.length > 0 && !(rawS && displayed.length === 0) && (
          <div aria-live="polite" style={{ marginBottom: 10, padding: '0 2px' }}>
            <p style={{ fontSize: 12.5, color: '#5F6368', fontFamily: FONT, margin: 0, fontWeight: 500 }}>
              {rawS
                ? `${nFacturen(displayed.length)} gevonden`
                : filter === 'all'
                  ? `${nFacturen(listedCount)} · ${receivedCount} te betalen · ${paidCount} betaald`
                  : `${displayed.length} van ${nFacturen(listedCount)}`}
            </p>
            {/* The list is a window, not the archive: the paid query stops at 200. Say so rather
                than let the counter imply the owner owns fewer facturen than he does. */}
            {hiddenCount > 0 && (
              <p style={{ fontSize: 11.5, color: '#80868B', fontFamily: FONT, margin: '3px 0 0', lineHeight: 1.4 }}>
                Je hebt er {totalCount} in totaal. Deze lijst toont de {receivedCount} openstaande en de {paidCount} meest recente betaalde.
              </p>
            )}
          </div>
        )}

        {displayed.length === 0 ? (
          rawS ? (
            <p style={{ textAlign: 'center', color: '#8e8e93', fontSize: 14, padding: '40px 16px' }}>Geen facturen gevonden voor &ldquo;{rawS}&rdquo;.</p>
          ) : <EmptyState />
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
              // [OVER-DATUM] Whole days past the stated vervaldatum — null when the bill is paid
              // (a settled invoice cannot be late), when it isn't due yet, or when the invoice
              // never stated a due date at all. `todayIso` is computed once per render below.
              const daysLate = isPaid ? null : overdueDays(inv.due_date, todayIso)
              // [DATE-LINE] The other half of the same timeline: how long is still LEFT. Same rule
              // — null when paid (a settled bill has no deadline left to count), and null when the
              // invoice stated no vervaldatum. daysLate and daysLeft can never both be set.
              const daysLeft = isPaid ? null : daysUntilDue(inv.due_date, todayIso)
              // [ROW-HEAD] Does this row have ANY status chip? The chip row sits between the
              // header and the dates, so rendering it empty would push every plain row 5px taller
              // for nothing — across a list this long that reads as sloppy spacing.
              const hasChips = !!CHIP[inv.status] || !!recon[inv.id] || !!xq
                || isAutoVerified(inv) || isVerwerkt || isPrepared

              return (
                // [ROW-UNIT] De kaart en zijn prullenbak zijn nu buren, geen ouder en kind. De
                // knop stond ín de kaart en concurreerde daar met de tekst om breedte; ernaast
                // hoort hij zichtbaar bij deze rij (hij staat op zijn hoogte, beweegt met hem
                // mee, en zijn aria-label noemt het factuurnummer) zonder een pixel van de
                // inhoud af te snoepen. flex-start + marginTop houdt hem op de hoogte van de
                // kopregel, ook wanneer de kaart uitklapt en meters hoog wordt.
                <div
                  key={inv.id}
                  ref={el => { rowRefs.current[inv.id] = el }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
                >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    borderRadius: R.lg,
                    overflow: 'hidden',
                    boxShadow: highlightId === inv.id ? `0 0 0 2px ${M3.primary}, ${EL1}` : EL1,
                    transition: 'box-shadow 0.4s ease',
                  }}
                >
                  {/* Main row — in select mode a tap toggles the bundle selection
                      (only for open 'received' rows); otherwise it expands. */}
                  <div
                    className="inv-row"
                    onClick={() => selectMode
                      ? (inv.status === 'received' && toggleSelect(inv.id))
                      : setExpandedId(expanded ? null : inv.id)}
                    // [ROW-LAYOUT] display/align/gap live in the .inv-row class (globals.css) so
                    // the stack-on-mobile media query can override them; only dynamic styles here.
                    style={{ background: selectedIds[inv.id] ? M3.primaryContainer : highlightId === inv.id ? M3.primaryContainer : '#fff', padding: '14px 16px', cursor: selectMode && inv.status !== 'received' ? 'default' : 'pointer', transition: 'background 0.4s ease', opacity: selectMode && inv.status !== 'received' ? 0.4 : 1 }}
                  >
                    {/* [BUNDEL-BETALING] selection indicator */}
                    {selectMode && inv.status === 'received' && (
                      <span className="material-symbols-outlined" style={{ fontSize: 22, color: selectedIds[inv.id] ? M3.primary : '#9AA0A6', flexShrink: 0 }}>
                        {selectedIds[inv.id] ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                    )}
                    <div className="inv-row-main">
                      {/* ── [ROW-HEAD] Wie + welke factuur, op één kopregel ──────────────────
                          De "Ink."-badge is weg: op Inkoopfacturen is ELKE rij een inkoop, dus
                          hij herhaalde alleen de paginatitel — 336 keer.
                          Nummer en naam staan nu naast elkaar, met de statuschips op hun eigen
                          regel eronder. Ze deelden die kopregel, dus bij meerdere chips brak de
                          regel rommelig af (op een telefoon stond "Automatisch" ineens onder het
                          nummer); nu is de rijhoogte voorspelbaar zonder er één regel bij.
                          Geen van beide wordt afgekapt. Op een telefoon houdt de rechterkolom
                          (bedrag + "Heb je betaald?" + prullenbak) zoveel breedte vast dat er voor
                          de naam ~50px overbleef: "GROOTH…", "W.K…", "Enka Ho…". Een leverancier
                          die je niet kunt lezen is geen rij, het is een raadsel. Dus wrapt de kop:
                          past de naam ernaast, dan staat hij ernaast; past hij niet, dan zakt hij
                          naar zijn eigen regel over de volle breedte en breekt daar netjes af —
                          altijd volledig leesbaar. Het nummer blijft op één regel (flexShrink:0,
                          nowrap): een half nummer is waardeloos, daar zoek je een bankregel mee op.
                          overflowWrap:anywhere vangt het randgeval van één lange naam zonder
                          spaties, zodat die nooit uit de kaart loopt. */}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                        <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 500, color: '#5F6368', fontFamily: FONT_NUM, whiteSpace: 'nowrap' }}>
                          {inv.invoice_number ?? '—'}
                        </span>
                        <span
                          title={inv.client_name ?? undefined}
                          style={{ minWidth: 0, fontSize: 14, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {inv.client_name ?? '—'}
                        </span>
                      </div>
                      {/* Statusregel — alleen gerenderd als er iets te tonen is, zodat een kale
                          rij geen lege regel meesleept. */}
                      {hasChips && (
                      <div className="inv-strip" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
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
                      )}
                      {/* ── [DATE-LINE] Alle datumfeiten op hun eigen regel ──────────────────
                          [DATE-VISIBLE] had naam en factuurdatum op ÉÉN regel gezet, met de datum
                          op flexShrink:0 zodat een lange naam hem niet meer opat. Dat werkte, maar
                          de prijs stond op het scherm: de NAAM moest krimpen, dus las de lijst als
                          "DHL FR…", "GROOTH…". En één regel had geen plaats meer voor waar het bij
                          een openstaande rekening om draait — wanneer hij uiterlijk betaald moet
                          zijn, en hoeveel dagen dat nog is.
                          Nu staat dat hier: factuurdatum · vervaldatum · de aftelling. Die laatste
                          plek is dezelfde plek die "te laat" toont zodra de datum voorbij is, zodat
                          het oog voor beide maar één plek hoeft te leren. */}
                      <div className="inv-strip" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12.5, color: '#5F6368' }}>
                        <span style={{ whiteSpace: 'nowrap' }}>{fmtDateSmart(inv.invoice_date)}</span>
                        {/* [OVER-DATUM] The due date is only ever a FACT here — a printed
                            vervaldatum, or invoice date + a printed term (see lib/safecore.ts).
                            When the invoice stated neither we say so, rather than leaving a blank
                            that reads as "no rush" or inventing the customary 30 days. */}
                        {inv.due_date ? (
                          <span style={{ whiteSpace: 'nowrap' }}>· uiterlijk {fmtDateSmart(inv.due_date)}</span>
                        ) : (
                          <span style={{ whiteSpace: 'nowrap', color: '#9AA0A6' }}>· geen vervaldatum</span>
                        )}
                        {/* Past the date — the loud half. Unpaid bills only; a settled invoice
                            cannot be late. */}
                        {daysLate !== null && (
                          <span
                            title={`Vervaldatum ${fmtDateSmart(inv.due_date)} — ${daysLate} ${daysLate === 1 ? 'dag' : 'dagen'} te laat`}
                            style={{ whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, borderRadius: R.full, padding: '1px 8px', background: M3.errorContainer, color: M3.error }}
                          >
                            {daysLate} {daysLate === 1 ? 'dag' : 'dagen'} te laat
                          </span>
                        )}
                        {/* Still to come — the same spot, calm by default. Only the last week
                            warms up, so a row that genuinely needs attention this week stands out
                            instead of every open bill shouting at once. */}
                        {daysLeft !== null && (
                          <span
                            title={`Vervaldatum ${fmtDateSmart(inv.due_date)}${daysLeft === 0 ? ' — vandaag te betalen' : ` — nog ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagen'}`}`}
                            style={{
                              whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, borderRadius: R.full, padding: '1px 8px',
                              background: daysLeft <= 7 ? M3.warningContainer : M3.surfaceVariant,
                              color:      daysLeft <= 7 ? '#7C5800'           : '#5F6368',
                            }}
                          >
                            {daysLeft === 0 ? 'vandaag' : `nog ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagen'}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* [ROW-LAYOUT] flex column/align/gap/shrink live in .inv-row-side (globals.css)
                        so the media query can flip it to a full-width strip on a phone. */}
                    <div className="inv-row-side">
                      <p style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, fontFamily: FONT_NUM }}>
                        {fmtEur(inv.total_inc_btw)}
                      </p>

                      {/* [PARTIAL-PAY] Deelbetaling — part already settled, rest openstaand. Only
                          while 0 < amount_paid < |total| (a fully-paid invoice shows the 'paid'
                          chip instead). Makes the running balance visible where the owner pays. */}
                      {(() => {
                        const paid = Math.max(0, inv.amount_paid ?? 0)
                        const tot = Math.abs(inv.total_inc_btw ?? 0)
                        // [MATCH-BUTTON] A settled invoice never offers "nog te betalen", whatever
                        // amount_paid says. The arithmetic below expressed that only indirectly, so
                        // any row whose amount_paid trails its status showed BOTH "Betaald" and a
                        // tappable "Deels betaald · € X open" — an invitation to pay it twice. The
                        // on-demand matcher can produce exactly that: a multi-invoice batch settles
                        // a part-paid invoice in full, and the list is patched from the booking.
                        if (isPaid) return null
                        if (!(paid > 0.005 && paid < tot - 0.005)) return null
                        const remaining = openAmount(inv)
                        return (
                          // [MANUAL-PARTIAL-PAY] The chip is now the way back in: tapping it
                          // reopens the pay dialog offering the REMAINING balance, so recording
                          // the next instalment starts where the owner reads the number.
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              if (processingId === inv.id || checkingId === inv.id) return
                              requestPay(inv)
                            }}
                            title={`Deelbetaling: € ${paid.toFixed(2)} van € ${tot.toFixed(2)} betaald — tik om de rest te noteren`}
                            style={{
                              fontSize: 11, fontWeight: 600, color: '#b06000', background: '#fef7e0',
                              border: '1px solid #fde293', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap',
                              cursor: 'pointer', fontFamily: FONT,
                            }}
                          >
                            Deels betaald · € {remaining.toFixed(2)} open
                          </button>
                        )
                      })()}

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
                        {/* [DATE-VISIBLE] The full dates live HERE, where there is room for them —
                            the collapsed row keeps only the short factuurdatum. Vervaldatum is shown
                            only when the invoice stated one; a missing due date is left out rather
                            than printed as "—", which would read like a field we failed to fill. */}
                        <InfoLine label="Factuurdatum" value={fmtDateSmart(inv.invoice_date)} />
                        {inv.due_date && <InfoLine label="Vervaldatum" value={fmtDateSmart(inv.due_date)} />}
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

                {/* [INVOICE-REMOVE] Verwijderen — naast de kaart, niet erin. Een inkoopfactuur die
                    niet van jou is (verkeerde leverancier, een dubbele, een scan van niets) hoort
                    weg te kunnen zonder een vraag aan support. Het archiveert: uit kosten,
                    voorbelasting en de werkplek van de boekhouder, zeven jaar bewaard, en met één
                    tik terug onder Inkomend › Genegeerd. Verborgen tijdens het selecteren voor een
                    gebundelde betaling. */}
                {!selectMode && (
                  <button
                    onClick={e => { e.stopPropagation(); handleRemoveRequest(inv) }}
                    disabled={processingId === inv.id}
                    aria-label={`Inkoopfactuur ${inv.invoice_number ?? ''} verwijderen`}
                    title="Verwijderen"
                    style={{
                      flexShrink: 0, marginTop: 12, width: 36, height: 36, borderRadius: R.full,
                      border: 'none', background: 'transparent', color: '#9AA0A6',
                      cursor: processingId === inv.id ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = M3.errorContainer; e.currentTarget.style.color = M3.error }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9AA0A6' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 19 }}>delete</span>
                  </button>
                )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* ── [BUNDEL-BETALING] Selection action bar — one transfer for the set.
          Enabled when the pure builder approves (≥2 open rows, same IBAN). ── */}
      {selectMode && (
        <div style={{
          position: 'fixed', left: 16, right: 16, bottom: `calc(20px + env(safe-area-inset-bottom))`,
          maxWidth: 648, margin: '0 auto', zIndex: 60,
          background: '#fff', borderRadius: R.lg, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: '12px 16px', fontFamily: FONT,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface, margin: 0 }}>
                {selectedRows.length} geselecteerd · {fmtEur(Math.round(openSum * 100) / 100)}
              </p>
              <p style={{ fontSize: 11.5, color: bundleBuilt && !bundleBuilt.ok ? M3.error : '#5F6368', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedRows.length < 2
                  ? 'Kies minimaal 2 open inkoopfacturen'
                  : bundleBuilt && !bundleBuilt.ok
                    ? bundleBuilt.error
                    : `Eén betaling aan ${bundleBuilt?.beneficiaryName ?? 'deze leverancier'}`}
              </p>
            </div>
            <button
              onClick={() => { if (bundleBuilt?.ok) setBundleCtx({ rows: selectedRows, built: bundleBuilt }) }}
              disabled={!bundleBuilt?.ok || bundleBusy}
              style={{
                flexShrink: 0, border: 'none', borderRadius: R.full, padding: '10px 18px',
                fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
                background: bundleBuilt?.ok && !bundleBusy ? M3.primary : M3.surfaceVariant,
                color: bundleBuilt?.ok && !bundleBusy ? '#fff' : '#9AA0A6',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>qr_code_2</span>
              {bundleBusy ? 'Bezig…' : 'Betalen'}
            </button>
          </div>
        </div>
      )}

      {/* ── [BUNDEL-BETALING] Prepare sheet for the whole set — one QR, the
          per-factuur lines, copyable details. Same discipline as the single
          PreparePaymentSheet: pure preparation, closing changes nothing. ── */}
      {bundleCtx && (
        <BundelBetalenSheet
          rows={bundleCtx.rows}
          built={bundleCtx.built}
          onClose={() => {
            for (const row of bundleCtx.rows) markPrepared(row)
            setBundleCtx(null)
          }}
          onConfirmPaid={() => {
            const rows = bundleCtx.rows
            for (const row of rows) markPrepared(row)
            setBundleCtx(null)
            setBundlePayRows(rows)
          }}
          onCopied={(what) => showToast(`${what} gekopieerd ✓`)}
        />
      )}

      {/* ── [BUNDEL-BETALING] One Bank/Contant + date answer for the whole set ── */}
      {bundlePayRows && (
        <BottomSheet
          title={`${bundlePayRows.length} inkoopfacturen markeren als betaald?`}
          body={`De geselecteerde inkoopfacturen van ${bundlePayRows[0]?.client_name ?? 'deze leverancier'} worden allemaal als betaald gemarkeerd.`}
          confirmLabel="Ja, markeer als betaald"
          confirmBg={M3.success}
          onConfirm={() => { /* paymentChoice handles it */ }}
          onCancel={() => setBundlePayRows(null)}
          paymentChoice={(method, paymentDate) => executeBundlePay(bundlePayRows, method, paymentDate)}
        />
      )}

      {/* ── [INVOICE-REMOVE] Remove dialog — the decision, rendered ── */}
      {removeCtx && (
        <BottomSheet
          title={removeCtx.decision.title}
          body={removeCtx.decision.body}
          warning={removeCtx.decision.warning}
          confirmLabel={removeCtx.decision.confirmLabel}
          confirmBg={removeCtx.decision.allowed ? M3.error : '#5F6368'}
          onConfirm={() => executeRemoval(removeCtx)}
          onCancel={() => setRemoveCtx(null)}
        />
      )}

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
              ? (method, paymentDate, amount) => executePay({
                  ...payCtx, paymentMethod: method, paymentDate, amount,
                  clientKey: payCtx.clientKey ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined),
                })
              : undefined
          }
          // [MANUAL-PARTIAL-PAY] Amount field only when marking as paid; an undo is
          // all-or-nothing ("Deelbetalingen wissen" resets to zero paid).
          openAmount={payCtx.newStatus === 'paid' ? payCtx.openAmount : undefined}
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

      {/* ── [MATCH-BUTTON] What the run actually did — including what it left alone ── */}
      {matchResult && (
        <MatchResultSheet
          result={matchResult}
          onClose={() => setMatchResult(null)}
          onOpenBank={() => { setMatchResult(null); router.push('/dashboard/bank') }}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: '#202124', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.sm, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', animation: 'fadeInUp 0.2s ease', fontFamily: FONT }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes bbSpin { to { transform: rotate(360deg); } }
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

function BottomSheet({ title, body, warning, confirmLabel, confirmBg, onConfirm, onCancel, paymentChoice, secondaryAction, openAmount: openBalance }: {
  title: string
  body: string
  // [INVOICE-REMOVE] The consequence to weigh before tapping — shown in an amber box, the same
  // one the sales list uses, so a warning looks identical wherever the owner meets it.
  warning?: string
  confirmLabel: string
  confirmBg: string
  onConfirm: () => void
  onCancel: () => void
  // [MANUAL-PARTIAL-PAY] the third argument is the typed amount (null = pay the whole rest)
  paymentChoice?: (method: 'bank' | 'kas', paymentDate: string, amount: number | null) => void
  // [PAY-NOT-YET] Optional third answer between confirm and Annuleren — e.g.
  // "Nee, nog niet betaald" (clears the prepared marker; invoice stays open).
  // Distinct from Annuleren: this is an ANSWER (writes state), Annuleren is
  // "ask me later" (keeps everything). Absent → sheet renders exactly as before.
  secondaryAction?: { label: string; onClick: () => void }
  // [MANUAL-PARTIAL-PAY] What is still open. Present → the "Betaald bedrag" field is offered.
  // Absent → no field (a bundle payment stays all-or-nothing).
  openAmount?: number
}) {
  // [TZ] Amsterdam, not UTC — see format-nl.ts. A betaaldatum one day early can land in a
  // kasstelsel quarter that is already filed.
  const [paymentDate, setPaymentDate] = useState(amsterdamToday())
  // [MANUAL-PARTIAL-PAY] Empty means "all of it" — zero keystrokes for the ordinary case.
  const [amountText, setAmountText] = useState('')
  const entry = openBalance != null ? interpretAmountEntry(amountText, openBalance) : null
  // [MANUAL-PARTIAL-PAY] Cash may settle an invoice, never part of one — see the Contant button.
  // [CASH-INSTALMENT] A cash instalment is a real, dated drawer movement now — see cash.ts.
  const canPayCash = !entry || entry.valid
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', borderRadius: 28, padding: '28px 24px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 48px rgba(0,0,0,0.24)', fontFamily: FONT }}>
        <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 12, textAlign: 'center', letterSpacing: -0.3 }}>{title}</p>
        <p style={{ fontSize: 14, color: '#5f6368', textAlign: 'center', marginBottom: warning ? 16 : 24, lineHeight: 1.5 }}>{body}</p>

        {warning && (
          <div style={{ background: '#FEF7E0', borderRadius: 12, padding: '12px 14px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#EA8600', flexShrink: 0, marginTop: 1 }}>warning</span>
            <p style={{ fontSize: 12.5, color: '#7C5800', lineHeight: 1.5, margin: 0 }}>{warning}</p>
          </div>
        )}

        {paymentChoice ? (
          <>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 6 }}>Betaaldatum</label>
            <input
              type="date"
              value={paymentDate}
              max={amsterdamToday()}
              onChange={e => setPaymentDate(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #DADCE0', fontSize: 15, marginBottom: 16, fontFamily: FONT, color: '#202124', background: '#fff', boxSizing: 'border-box' }}
            />
            {/* [MANUAL-PARTIAL-PAY] Betaald bedrag — optional. Empty pays the whole open
                balance (unchanged behaviour); a number records an instalment and leaves the
                invoice on "Te betalen" for the rest, with the pay-QR asking only that rest. */}
            {entry && openBalance != null && (
              <>
                <label htmlFor="ink-betaald-bedrag" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#202124', marginBottom: 6 }}>
                  Betaald bedrag
                </label>
                <input
                  id="ink-betaald-bedrag"
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  placeholder={openBalance.toFixed(2).replace('.', ',')}
                  onChange={e => setAmountText(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 12,
                    border: `1px solid ${entry.error ? M3.error : '#DADCE0'}`,
                    fontSize: 15, fontFamily: FONT, color: '#202124', background: '#fff', boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: 12, color: entry.error ? M3.error : '#5F6368', margin: '6px 2px 16px', lineHeight: 1.45 }}>
                  {entry.error
                    ? entry.error
                    : amountText.trim() === ''
                      ? `Leeg laten = alles betaald (${fmtEur(openBalance)})`
                      : entry.settlesFully
                        ? 'Hiermee is de factuur volledig betaald.'
                        : `Nog openstaand: ${fmtEur(entry.remainingAfter)} — kies hieronder hoe je dit deel betaalde`}
                </p>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <button
                onClick={() => { if (!entry || entry.valid) paymentChoice('bank', paymentDate, entry?.amount ?? null) }}
                disabled={!!entry && !entry.valid}
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: (!entry || entry.valid) ? confirmBg : M3.surfaceVariant, color: (!entry || entry.valid) ? '#fff' : '#9AA0A6', fontSize: 15, fontWeight: 600, border: 'none', cursor: (!entry || entry.valid) ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>account_balance</span>
                Bank
              </button>
              {/* [MANUAL-PARTIAL-PAY] Contant is disabled for a PARTIAL amount, on purpose.
                  The kasboek can hold exactly one settlement entry per invoice
                  (cash_entries_one_settlement_per_invoice), so two cash instalments would
                  collapse into a single entry re-dated to the last one — silently moving money
                  out of an already-filed quarter and making the daily drawer balance wrong in
                  between. A partial payment via Bank has no such limit. Lift this once the
                  kasboek can represent one entry per instalment. */}
              <button
                onClick={() => { if (canPayCash) paymentChoice('kas', paymentDate, entry?.amount ?? null) }}
                disabled={!canPayCash}
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: canPayCash ? confirmBg : M3.surfaceVariant, color: canPayCash ? '#fff' : '#9AA0A6', fontSize: 15, fontWeight: 600, border: 'none', cursor: canPayCash ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
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

// ─── [MATCH-BUTTON] Result sheet — the honest report of one reconciliation run ──
// Reports three things, in this order, and never rounds any of them up:
//   1. what was BOOKED (and which bookings deserve a second look),
//   2. what the KASBOEK did (created / healed / reversed — or that it could not run),
//   3. what is LEFT for the owner (found-but-ambiguous payments → the Bank page).
// A run that changed nothing says so plainly instead of implying work happened. A pass that
// FAILED is named — a partial run must never read as a clean one.
function MatchResultSheet({ result, onClose, onOpenBank }: {
  result: MatchRunResult
  onClose: () => void
  onOpenBank: () => void
}) {
  const { bookedCount, amountOnlyCount, cash, categorized, pendingTransactions, pendingMatchCount, failed } = result
  const cashTouched = cash.created + cash.updated + cash.deleted
  const bankFailed = failed.includes('bank')
  const kasFailed  = failed.includes('kas')
  const changedNothing = bookedCount === 0 && cashTouched === 0 && categorized === 0
  const nFact = (n: number) => (n === 1 ? '1 factuur' : `${n} facturen`)

  const title = bookedCount > 0
    ? `${nFact(bookedCount)} gekoppeld`
    : changedNothing
      ? (pendingTransactions === 0 ? 'Niets om te matchen' : 'Niets nieuws gevonden')
      : 'Bijgewerkt'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 28, padding: '28px 24px 24px', width: '100%', maxWidth: 420, maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.24)', fontFamily: FONT }}>
        {/* Both glyphs are in the layout.tsx icon subset — see the button's note. */}
        <span className="material-symbols-outlined" style={{ fontSize: 40, color: bookedCount > 0 ? M3.success : M3.primary, display: 'block', textAlign: 'center', marginBottom: 8 }}>
          {bookedCount > 0 ? 'task_alt' : 'link'}
        </span>
        <p style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, marginBottom: 16, textAlign: 'center', letterSpacing: -0.3 }}>{title}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {/* 1) Bank ↔ facturen */}
          <ResultLine
            icon="account_balance"
            tone={bankFailed ? 'error' : bookedCount > 0 ? 'good' : 'neutral'}
            text={
              bankFailed
                ? 'Het bankafschrift kon niet worden gematcht — probeer het straks opnieuw.'
                : bookedCount > 0
                  ? `${nFact(bookedCount)} herkend in je bankafschrift en op betaald gezet.`
                  : pendingTransactions === 0
                    ? 'Geen open banktransacties om tegen te matchen.'
                    : 'Geen nieuwe betalingen herkend in je bankafschrift.'
            }
          />
          {/* Booked on amount + name only — real bookings, but the ones worth checking. */}
          {amountOnlyCount > 0 && (
            <ResultLine
              icon="error"
              tone="warn"
              text={`${amountOnlyCount === 1 ? '1 koppeling is' : `${amountOnlyCount} koppelingen zijn`} alleen op bedrag herkend (geen factuurnummer in de omschrijving) — controleer die even.`}
            />
          )}
          {/* 2) Kas ↔ facturen */}
          <ResultLine
            icon="payments"
            tone={kasFailed ? 'error' : cashTouched > 0 ? 'good' : 'neutral'}
            text={
              kasFailed
                ? 'Het kasboek kon niet worden bijgewerkt — probeer het straks opnieuw.'
                : cashTouched === 0
                  ? 'Kasboek was al in balans met je contant betaalde facturen.'
                  : [
                      cash.created > 0 ? `${cash.created} kasboeking toegevoegd` : null,
                      cash.updated > 0 ? `${cash.updated} bijgewerkt` : null,
                      cash.deleted > 0 ? `${cash.deleted} teruggedraaid` : null,
                    ].filter(Boolean).join(' · ')
            }
          />
          {/* 3) Learned categorization — lands in the P&L immediately, so it stays reviewable. */}
          {categorized > 0 && (
            <ResultLine
              icon="label"
              tone="neutral"
              text={`${categorized} banktransactie(s) automatisch gecategoriseerd — controleer ze op de Bank-pagina.`}
            />
          )}
          {/* 4) What the engine deliberately did NOT decide. */}
          {pendingMatchCount > 0 && (
            <ResultLine
              icon="help"
              tone="warn"
              text={`${pendingMatchCount === 1 ? '1 betaling is' : `${pendingMatchCount} betalingen zijn`} gevonden maar te onzeker om zelf te boeken — die bevestig je zelf.`}
            />
          )}
          {/* Nothing to work with at all → say what to do about it. */}
          {pendingTransactions === 0 && bookedCount === 0 && !bankFailed && (
            <ResultLine
              icon="upload_file"
              tone="neutral"
              text="Upload een bankafschrift op de Bank-pagina, dan kan de matching zijn werk doen."
            />
          )}
          {/* A pass we could not run at all — never let a partial run read as a clean one. */}
          {failed.includes('categorize') && (
            <ResultLine icon="error" tone="error" text="Automatisch categoriseren is niet gelukt — de rest is wel bijgewerkt." />
          )}
        </div>

        {pendingMatchCount > 0 ? (
          <>
            <button onClick={onOpenBank} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: FONT }}>
              Bekijk op de Bank-pagina
            </button>
            <button onClick={onClose} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Klaar</button>
          </>
        ) : (
          <button onClick={onClose} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}>Klaar</button>
        )}
      </div>
    </div>
  )
}

function ResultLine({ icon, text, tone }: { icon: string; text: string; tone: 'good' | 'warn' | 'error' | 'neutral' }) {
  const color = tone === 'good' ? '#137333' : tone === 'warn' ? '#B26A00' : tone === 'error' ? M3.error : '#5F6368'
  const bg    = tone === 'good' ? M3.successContainer : tone === 'warn' ? '#FFF3E0' : tone === 'error' ? M3.errorContainer : M3.surfaceVariant
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: R.md, background: bg }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <p style={{ fontSize: 13, color, lineHeight: 1.45, margin: 0, fontWeight: 500 }}>{text}</p>
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

  // [PARTIAL-PAY] The QR must request the REMAINING openstaand, never the full
  // total: a €1.000 invoice with a €400 bank-confirmed instalment would
  // otherwise pre-fill €1.000 in the owner's bank app → €600 over-payment.
  // Same remainder rule as the "Deels betaald · €X open" chip on the card;
  // sign preserved (a negative creditnota stays negative → EPC refuses it).
  const amount = (() => {
    const total = inv.total_inc_btw ?? 0
    const paid = Math.max(0, inv.amount_paid ?? 0)
    if (paid <= 0.005) return total
    return (total < 0 ? -1 : 1) * Math.max(0, Math.abs(total) - paid)
  })()
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

// ─── [BUNDEL-BETALING] Prepare sheet for SEVERAL invoices of one supplier ─────
// Mirror of PreparePaymentSheet, fed by the pure buildBundelBetaling result:
// one QR for the sum, the per-factuur lines, copyable IBAN/bedrag/kenmerk.
// PURE preparation — no DB write, no money movement; the owner confirms the
// transfer inside their OWN bank app.
function BundelBetalenSheet({
  rows,
  built,
  onClose,
  onConfirmPaid,
  onCopied,
}: {
  rows: IncomingRow[]
  built: BundelBetalingResult
  onClose: () => void
  onConfirmPaid: () => void
  onCopied: (what: string) => void
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  const amount = built.amount ?? 0
  const reference = built.reference ?? ''
  const ibanDisplay = (built.iban ?? '').replace(/(.{4})/g, '$1 ').trim()

  useEffect(() => {
    let cancelled = false
    async function gen() {
      if (!built.epcPayload) { setQrError(built.error ?? 'Geen QR mogelijk'); return }
      try {
        // Dynamic import keeps qrcode out of the main bundle until needed.
        const QR = await import('qrcode')
        const url = await QR.toDataURL(built.epcPayload, { margin: 1, width: 240 })
        if (!cancelled) setQrDataUrl(url)
      } catch {
        if (!cancelled) setQrError('QR kon niet worden gegenereerd')
      }
    }
    gen()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built.epcPayload])

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
        <p style={{ fontSize: 20, fontWeight: 700, color: '#202124', marginBottom: 4, textAlign: 'center', letterSpacing: -0.3 }}>
          {rows.length} facturen betalen
        </p>
        <p style={{ fontSize: 13, color: '#5F6368', textAlign: 'center', marginBottom: 16 }}>
          Eén overboeking van {fmtEur(amount)} aan {built.beneficiaryName ?? '—'}.
          Scan met je bankapp of kopieer de gegevens — je betaalt in je eigen bank.
        </p>

        {/* The invoices this ONE transfer settles */}
        <div style={{ background: '#F8F9FA', borderRadius: R.md, padding: '4px 14px', marginBottom: 16 }}>
          {(built.items ?? []).map((it, i) => (
            <div key={it.invoiceId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: i === (built.items?.length ?? 0) - 1 ? 'none' : '1px solid #EEF0F1' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: FONT_NUM }}>
                {it.invoiceNumber ?? '—'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#202124', fontFamily: FONT_NUM, whiteSpace: 'nowrap' }}>
                {fmtEur(it.amount)}
              </span>
            </div>
          ))}
        </div>

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
        <CopyRow label="IBAN" value={ibanDisplay} raw={built.iban ?? ''} onCopy={copy} />
        <CopyRow label="Bedrag" value={fmtEur(amount)} raw={amount.toFixed(2)} onCopy={copy} />
        {reference && <CopyRow label="Kenmerk" value={reference} raw={reference} onCopy={copy} />}
        <CopyRow label="Naam" value={built.beneficiaryName ?? '—'} raw={built.beneficiaryName ?? ''} onCopy={copy} />

        {/* Same honest confirm as the single sheet: closing the QR ≠ paid. */}
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