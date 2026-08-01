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
// [PAY-DATE-SANE] the floor the date picker offers — the ceiling is amsterdamToday() below
import { PAYMENT_DATE_FLOOR } from '@/lib/payment-date'
import { M3, R, STICKY_BELOW_HEADER, columnInner, COLUMN } from '@/lib/design/tokens'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
import type { InvoiceRecon } from '@/lib/bank-reconciliation'
import { ReconBadge } from '@/components/invoice/InvoiceRow'
import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
// [PAY-SAFE] EPC QR payload + IBAN validation (pure, client-safe)
import { buildEpcQrPayload, isValidIban } from '@/lib/epc-qr'
// [BUNDEL-BETALING] several supplier invoices → ONE prepared transfer (pure, client-safe)
import { buildBundelBetaling, type BundelBetalingResult } from '@/lib/bundel-betaling'
// [PARTIAL-PAY] one shared definition of openstaand + the amount-field interpretation
import { openAmount, openAmountSigned, settledAmountSigned, interpretAmountEntry } from '@/lib/partial-payment'
// [CREDITNOTA-SIGNAL] Spots a credit note booked as an ordinary invoice — signals, never decides.
// [ARITHMETIC-VISIBLE] The same read-time health verdict the verify queue shows. This screen never
// showed it, so an invoice that entered the books with a broken breakdown looked perfectly fine on
// the one screen the owner pays from.
import { classifyImportHealth } from '@/lib/import-health'
// [INVOICE-SCAN] How many booked invoices are wrong, and which quarters they touch — read-only.
import { scanInvoices, scanFindingIds, type InvoiceScan } from '@/lib/invoice-scan'
import { quarterLabelOf } from '@/lib/quarter'
// [AMOUNT-TRIPLET] ex + btw = total keeps holding, whichever of the three you type.
import { setExcl, setBtw, setIncl } from '@/lib/amount-triplet'
import { looksLikeCreditnota, creditnotaSignalText, creditnotaSignConflict } from '@/lib/creditnota-signal'
import { crossQuarterPayment } from '@/lib/quarter'
// [PERIODE] Welke [start, eind] "deze maand" / "vorig kwartaal" / "dit jaar" betekent — puur en
// getest, zodat de randen (januari → december, Q1 → Q4 vorig jaar, schrikkeljaar) vaststaan.
import { INVOICE_PERIODS, resolveInvoicePeriod, isInPeriod, type InvoicePeriod } from '@/lib/invoice-period'
// [OVER-DATUM] one pure answer to "hoeveel dagen te laat?" — never an assumed payment term
import { overdueDays, daysUntilDue } from '@/lib/overdue'
import { rowMatchesQuery } from '@/lib/search'
import { useToast } from '@/components/ui/Toast'
// [SORT] Shared ordering (also used by Vandaag) — one implementation, no drift.
import { sortRows, SORTS, type SortKey } from '@/lib/invoice-sort'
// [INVOICE-REMOVE] The same rule the sales list uses, so "Verwijderen" means the same thing on
// both sides of the app — and the server re-checks it before writing.
import { decideRemoval, type RemovalDecision, type RemovalInvoice } from '@/lib/invoice-removal'

// ─── Design tokens — BoekBrug Design System v1.0 (Material You) ───────────────
const FONT     = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

// Status chip colors — Material You
const CHIP: Record<string, { bg: string; color: string; label: string }> = {
  received: { bg: '#FEE8C4', color: '#7C5800', label: 'Te betalen' },
  paid:     { bg: '#CEEAD6', color: '#137333', label: 'Betaald'   },
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const NL_EUR  = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
// [TZ] timeZone PINNED on both. These format DATE-ONLY strings, and `new Date('2026-01-01')` is
// midnight UTC: rendered in the BROWSER's zone, every invoice date west of UTC came out a day
// early — and with NL_DATE_Y that is a day in the wrong YEAR. format-nl.ts:17-23 forbids exactly
// this. The Dutch short shape ("12 mrt") is deliberately kept: the DD-MM-YYYY rule in that module
// is scoped to forms, invoice detail, PDF and e-mail (format-nl.ts:6), not to compact lists — the
// rule these two were breaking is the timezone one, so that is the one being fixed.
const NL_DATE = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' })
const NL_DATE_Y = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Amsterdam' })
const fmtEur  = (n: number | null) => NL_EUR.format(n ?? 0)
const fmtDate = (s: string | null) => s ? NL_DATE.format(new Date(s)) : '—'
// [DATE-VISIBLE] The row date, with the YEAR only when it isn't this year. "12 mrt" is fine for a
// recent bill and ambiguous on a two-year-old one; printing 2026 on every row is noise. Guards an
// unparseable date too — Intl.format THROWS on an Invalid Date, which would blank the whole list.
const fmtDateSmart = (s: string | null, thisYear: string) => {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  // [TZ] "Is this year?" compared d.getFullYear() (the DEVICE's year for a UTC-midnight date)
  // against the device's own year — so west of UTC the decision to PRINT the year flipped on the
  // same boundary that made the printed date wrong. Both sides now read the Amsterdam calendar:
  // the row's year off the ISO string it came from, today's from `thisYear`.
  //
  // `thisYear` is PASSED IN rather than read here. amsterdamToday() builds a fresh
  // Intl.DateTimeFormat on every call (format-nl.ts:107-115, nothing memoised), and this runs up
  // to four times per row on an unvirtualised list that re-renders on every search keystroke —
  // calling it inside would have turned a correctness fix into hundreds of formatter constructions
  // per keypress. The caller already computes the Amsterdam day once per render (todayIso).
  const rowYear = /^\d{4}-/.test(s) ? s.slice(0, 4) : String(d.getFullYear())
  return rowYear === thisYear ? NL_DATE.format(d) : NL_DATE_Y.format(d)
}
// [BOEK-029] btw_rate does not exist in DB — always computed from the two stored amounts.
// [BTW-NO-GUESS] Returns null when there is no grondslag to compute from. It used to fall back
// to 21, printing "BTW (21%)" for an invoice whose total_ex_btw was 0, null or negative (a
// creditnota, or an OCR read that found no net amount) — a tax rate nobody read, shown as fact.
// A 9%-invoice missing its grondslag was labelled 21%. The caller drops the percentage from the
// label rather than inventing one; the AMOUNT beside it is stored and stays exact either way.
const calcBtw = (btw: number | null, ex: number | null): number | null =>
  ex && ex > 0 ? Math.round(((btw ?? 0) / ex) * 100) : null

// ─── Types ────────────────────────────────────────────────────────────────────
interface IncomingRow {
  id: string
  invoice_number: string | null
  client_name: string | null            // supplier/vendor for incoming
  status: string                         // 'received' | 'paid'
  accountant_status: string | null       // 'verwerkt' etc. — read-only badge
  direction: string
  // [CREDITNOTA-SIGNAL] 'factuur' | 'creditnota' | 'pro_forma' | 'offerte'. A credit note is MONEY
  // OWED TO YOU: it belongs in the list with a minus sign, comes off the outstanding balance, and
  // cannot be "late" by definition.
  invoice_type?: string | null
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

// [PAY-REASON] What the owner reads when /api/invoice/pay-toggle refuses.
//
// That route answers with a machine CODE in `error` and only sometimes a written `detail`. The
// existing call site preferred `detail || error`, which was right for the handful of refusals that
// carry a sentence and wrong for every other one — "invoice_already_paid", "verwerkt",
// "invoice_not_found" would land on a shop owner's phone as-is. Its own [DEPLOY-SAFE] note says
// exactly that ("the bare error CODE would reach the owner as gibberish"); it just never covered
// the codes that have no detail. A bundle makes it worse, because it collects several at once.
//
// So: a curated sentence when the server wrote one AND the status says it is ours to trust
// (a 5xx `detail` is a raw Postgres string — never for a phone), then a Dutch line per known code,
// then a neutral fallback. Never a code, never a database message.
const PAY_TOGGLE_REASON: Record<string, string> = {
  verwerkt: 'je boekhouder heeft deze factuur al verwerkt',
  invoice_already_paid: 'deze factuur staat al als betaald',
  invoice_not_found: 'deze factuur is niet gevonden',
  not_paid: 'er staat geen betaling op deze factuur',
  status_conflict: 'de status is inmiddels veranderd — ververs de pagina',
  unauthorized: 'je sessie is verlopen — log opnieuw in',
  invalid_amount: 'het ingevoerde bedrag is niet geldig',
  // [PAY-DATE-SANE] The route sends its own sentence with this one (and payToggleReason prefers a
  // <500 detail), so this line is the belt to that braces — never a bare code on a phone.
  invalid_payment_date: 'de betaaldatum kan niet kloppen — controleer het jaartal',
  undo_read_failed: 'we konden de gekoppelde betalingen niet lezen — er is niets gewijzigd',
  undo_failed: 'terugdraaien is niet gelukt — er is niets gewijzigd',
}
function payToggleReason(status: number, json: { detail?: string; error?: string } | null): string {
  if (status < 500 && typeof json?.detail === 'string' && json.detail.trim()) return json.detail.trim()
  const code = typeof json?.error === 'string' ? json.error : ''
  return PAY_TOGGLE_REASON[code] ?? 'bijwerken is niet gelukt — ververs de pagina'
}

// [AUTO-ADVANCE] True when the app auto-verified this invoice (clean + confident) instead of
// the owner tapping confirm. Drives the review badge + filter — the opt-in double-check.
function isAutoVerified(inv: IncomingRow): boolean {
  const fc = inv.field_confidence
  return !!(fc && typeof fc === 'object' && (fc as Record<string, unknown>)._auto_verified)
}

// Pay confirm context — payment fields only (defense in depth: never amounts)
// [MOVE-PAYMENT] What /api/invoice/payment/move returns: one booked payment plus the invoices it
// CAN go to. The server ranks them (same supplier first, then an exactly-fitting amount, then the
// nearest date) — the screen shows that order and invents nothing on top of it.
interface MoveTarget {
  id: string
  invoice_number?: string | null
  client_name?: string | null
  invoice_date?: string | null
  total_inc_btw?: number | null
  amount_paid?: number | null
}
interface MovePayment {
  id: string
  amount_applied: number
  transaction_id?: string | null
  paid_on?: string | null
  method?: string | null
  /** false for a pre-[PARTIAL-PAY] link row: no recorded amount, so there is nothing to move. */
  movable: boolean
  targets: MoveTarget[]
}

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
  // [REMOVAL-ALTERNATIVE] This undo was opened FROM the remove dialog ("Betaling terugdraaien").
  // On success the remove sheet re-opens, so taking the money off and taking the invoice out is
  // one flow instead of two errands the owner has to remember to finish.
  thenRemove?: boolean
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
  readFailed = [], filedQuarters, bookScan = null,
}: {
  profile: { id: string }
  initialInvoices: IncomingRow[]
  // [INVOICE-COUNTER] How many confirmed inkoopfacturen the owner really has (server count).
  // Only used to disclose that this list is capped — never as the counter itself, because it
  // cannot move when the owner pays a factuur. Null when the count query failed.
  totalCount?: number | null
  // [NO-SILENT-EMPTY] Which of the two source reads failed on the server ('openstaande facturen'
  // / 'betaalde facturen'). Empty on a healthy load. Never a reason to hide the list — a stale
  // list beats a blank screen — but always a reason to stop the page CLAIMING the list is
  // complete, because "je hoeft niemand te betalen" is the one thing this screen must not say
  // when it does not know.
  readFailed?: string[]
  // [INVOICE-SCAN] Quarters the owner has already filed. null = we could not look — the banner then
  // omits the filed warning rather than implying every quarter is still open.
  filedQuarters?: string[] | null
  // [SCAN-WHOLE-BOOK] The scan over the owner's ENTIRE confirmed history, computed server-side.
  // null = that read failed, and the banner then counts only what is on this screen and says so.
  bookScan?: InvoiceScan | null
}) {
  // [MOTION] The app-wide snackbar (components/ui/Toast), bound to the name the
  // call sites already used. The local one it replaces could not stack, was
  // never announced to a screen reader, and vanished with the page.
  const showToast = useToast()
  const router   = useRouter()
  const supabase = createClient()
  // [BANK-RECON-BADGE] Per-invoice reconciliation vs the bank statement (fail-soft).
  // [MATCH-BUTTON] applyMap installs the post-run map the matcher returns (no second fetch).
  const { byInvoice: recon, confirmMatch, applyMap } = useInvoiceReconciliation()
  // [BRIDGE-NOTIF] Deep links land here with ?focus= / ?action= (see the effects
  // below). Read once, up here, because the filter tab below is INITIALISED from
  // the URL — setting it from an effect would be a cascading render.
  const searchParams = useSearchParams()
  // ── [INTAKE-AUTO-FEEDBACK] Deep-link a FILTER (?filter=auto) ────────────────
  // The upload results modal on /dashboard/incoming tells the owner that N invoices
  // were verified and booked automatically, and links here to see them. Landing on
  // "Alle" would drop them back into the full ledger; opening straight on the tab
  // that holds exactly those rows is the whole point of the link. Read-only intent:
  // an unknown value falls back to 'Alle', and the owner can switch freely after.
  const filterParam = searchParams.get('filter')
  const [invoices, setInvoices]         = useState<IncomingRow[]>(initialInvoices)
  const [filter, setFilter]             = useState<FilterTab>(
    FILTERS.some(f => f.id === filterParam) ? (filterParam as FilterTab) : 'all'
  )
  const [search, setSearch]             = useState('')  // [SEARCH] in-page live filter
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortBy, setSortBy]             = useState<SortKey>('added_desc')
  const [showSortMenu, setShowSortMenu] = useState(false)
  // [PERIODE] De lijst toonde ALLE tijd. Dat is goed voor "wat moet ik betalen" en verkeerd voor
  // elke andere vraag die iemand aan deze lijst stelt (wat kocht ik in maart, wat gaf ik dit jaar
  // uit) — zeker nu er een bedrag boven staat: dan is de periode de helft van het antwoord.
  // Default 'all', zodat het scherm zich precies zo gedraagt als voorheen tot je zelf kiest.
  const [period, setPeriod]             = useState<InvoicePeriod>('all')
  const [showPeriodMenu, setShowPeriodMenu] = useState(false)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [payCtx, setPayCtx]             = useState<PayCtx | null>(null)
  // [INVOICE-REMOVE] The confirm dialog for "Verwijderen": the invoice + what removing it means.
  const [removeCtx, setRemoveCtx]       = useState<{ id: string; decision: RemovalDecision } | null>(null)
  // [MOVE-PAYMENT] Which payment(s) sit on this invoice, and where they are allowed to go.
  const [moveCtx, setMoveCtx]           = useState<{ inv: IncomingRow; payments: MovePayment[] } | null>(null)
  const [moveLoadingId, setMoveLoadingId] = useState<string | null>(null)
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

  // [BUNDEL-SELECTIE] Only rows that are still OPEN belong in the set. A selected row can stop
  // being open while it sits selected — the bank-match run patches rows to 'paid' (runReconciliation),
  // so does a one-tap ReconBadge confirm — and it could not be deselected afterwards either (the
  // row's tap handler only toggles while status === 'received'). Dropping it here keeps the count
  // and the amount describing the SAME set; filtering only the euros would have fixed the sum and
  // left "3 geselecteerd" standing over two payable invoices.
  const selectedRows = invoices.filter(i => selectedIds[i.id] && i.status === 'received')
  // Live validation — pure and cheap, so the action bar can explain itself
  // (same-IBAN rule, missing IBAN, sum) on every tap.
  const bundleBuilt = selectedRows.length >= 2 ? buildBundelBetaling(selectedRows) : null
  // [PARTIAL-PAY] openAmount(), not a second hand-rolled copy of it. The local version omitted the
  // status check that openAmount exists for — partial-payment.ts:44-45 says in as many words that
  // screens must use it, because a row marked paid before amount_paid existed reports a phantom
  // balance without it. The import was already at the top of this file.
  const openSum = selectedRows.reduce((s, r) => s + openAmount(r), 0)

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
    // [BUNDEL-SELECTIE] Leave select mode entirely BEFORE the loop, not after it. `rows` is already
    // a snapshot, so the batch itself is unaffected. Two things made the timing matter: selectedRows
    // now drops each row the moment it is patched to 'paid', so the bar's total would visibly drain
    // toward € 0,00 while the owner watches money being paid — and merely clearing the ids would
    // have left the bar standing there reading "0 geselecteerd · € 0,00 · kies minimaal 2" over a
    // batch that is mid-flight. Neither is money evaporating; both look exactly like it. The bar
    // goes away and `bundleBusy` carries the progress.
    exitSelectMode()
    let okCount = 0
    const failed: { number: string; reason: string }[] = []
    // [BOEK-004] The accountant's lock is not a generic failure: it has an answer ("ask them to
    // undo it") and this file already has the dialog for it. A bundle used to swallow it as a bare
    // invoice number, so the one refusal with a way out was the one the owner could not act on.
    let verwerktRow: { id: string; number: string } | null = null
    for (const row of rows) {
      const label = row.invoice_number ?? '—'
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
          // [SERVER-REASON] Same source of truth the single-invoice executePay uses: pay-toggle's
          // own sentence when it has one, its code otherwise — never a bare invoice number.
          const json = await res.json().catch(() => ({} as { detail?: string; error?: string }))
          const reason = payToggleReason(res.status, json)
          if (!verwerktRow && json?.error === 'verwerkt') verwerktRow = { id: row.id, number: label }
          failed.push({ number: label, reason })
        }
      } catch {
        failed.push({ number: label, reason: 'geen verbinding' })
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
      // [CASH-SETTLE] The extra pass that used to sit here is gone: every pay-toggle call in the
      // loop above already reconciles the kasboek, and it now RETRIES a bailed pass itself
      // ([CASH-RETRY] in pay-toggle) instead of relying on this call to happen to repeat it.
      // "Once for the whole batch" was never true anyway — the batch had already done it N times.
    }
    // One line per distinct reason, so "niet gelukt" finally says WHY. Grouped rather than listed
    // per invoice: a batch that trips the same lock five times should read as one problem.
    if (failed.length === 0) {
      showToast(`${okCount} inkoopfacturen betaald ✓`)
    } else {
      const byReason = new Map<string, string[]>()
      for (const f of failed) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f.number])
      const parts = [...byReason.entries()].map(([reason, nums]) => `${nums.join(', ')}: ${reason}`)
      showToast(`${okCount} betaald ✓ — niet gelukt · ${parts.join(' · ')}`)
    }
    setBundleBusy(false)
    // The lock has a way out and this screen owns the dialog for it — open it once, for the first
    // invoice that hit it, after the batch has finished reporting.
    if (verwerktRow) { setRequestSent(false); setVerwerktCtx(verwerktRow) }
  }

  // ── [BRIDGE-NOTIF] Deep-link focus from a notification (?focus={invoiceId}) ──
  // Lands the user on the exact row: auto-expand, scroll into view, brief highlight.
  // (searchParams is read at the top of the component — see the filter note there.)
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
  //
  // [ACTION-PAY-ONCE] It must fire ONCE. `actionParam` lives in the URL and never leaves it, and
  // `invoices.length` is in the dependency list, so every archive or delete re-ran this effect:
  // the owner arrived from Vandaag, dismissed the dialog, removed some other invoice — and the
  // pay dialog reopened on the first one, unasked. A ref is the right guard here rather than
  // rewriting the URL: it survives the re-render without a navigation, and the intent ("this
  // link asked to pay ONE invoice") is per visit, not per render.
  const payActionDone = useRef<string | null>(null)
  useEffect(() => {
    if (actionParam !== 'pay' || !focusId) return
    if (payActionDone.current === focusId) return
    const target = invoices.find(i => i.id === focusId)
    if (!target) return
    if (target.status !== 'received') return
    payActionDone.current = focusId
    // Small delay so the row is expanded/scrolled first, then the dialog opens.
    const t = setTimeout(() => { requestPay(target) }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParam, focusId, invoices.length])

  // [OVER-DATUM] Today as a plain ISO day, computed ONCE per render and passed to every row, so
  // all rows are judged against the same boundary (and overdueDays stays pure — it never reads a
  // clock itself). Not toISOString(): near midnight UTC that is a different day, and "te laat"
  // must follow the owner's calendar, not UTC's.
  //
  // [TZ] amsterdamToday(), not the DEVICE's local date. The device clock is whatever the traveller
  // or a mis-set phone says it is, and this file already uses amsterdamToday() for the betaaldatum
  // it WRITES — so a hand-rolled local date here made the screen judge "te laat" against one
  // calendar while recording payments against another. One clock for the whole page.
  const todayIso = amsterdamToday()

  // [SEARCH] In-page live filter (leverancier / factuurnummer / bedrag), on top of the
  // status tabs — in place, no navigation.
  const rawS = search.trim()
  // [PERIODE] Het venster van de gekozen periode, tegen de AMSTERDAMSE dag (todayIso hieronder komt
  // van amsterdamToday) — nooit tegen de klok van het apparaat, want dan zou een telefoon in een
  // andere tijdzone rond middernacht een andere maand tonen dan de rest van de app.
  const periodWindow = resolveInvoicePeriod(period, todayIso)

  // ── [INVOICE-SCAN] What is standing wrong in the books, over the WHOLE list ──
  // Computed over `invoices`, never over the filtered view: the credit-note signal needs every
  // number a supplier used to see that they keep two kinds apart, and a count over a filtered list
  // answers a question nobody asked. Recomputed when the list changes, so correcting an invoice
  // makes it drop out of the banner immediately.
  //
  // [ORDER] This block sits ABOVE `displayed` because `displayed` reads it. That is not a style
  // choice and it must not be tidied down to where the other totals are computed: `displayed` is a
  // plain expression evaluated during render, so a `const` declared below it is in its temporal
  // dead zone and the screen throws "Cannot access 'scanIds' before initialization" on EVERY render.
  // It was written that way first, and none of the five gates caught it — tsc does not see through
  // the .filter() closure, the build compiles it fine, and the smoke test only covers the public
  // surface, so a logged-in screen that crashed on load passed everything.
  const listScan = useMemo(() => scanInvoices(invoices), [invoices])
  const scanIds = useMemo(() => scanFindingIds(listScan), [listScan])
  // Show only the flagged rows. A count the owner cannot act on is a statistic; this turns it into
  // a worklist.
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  // [SCAN-WHOLE-BOOK] TWO scans, and the difference between them is the honest part.
  //
  // `listScan` is over the rows on this screen — every open invoice plus the 200 most recent paid
  // ones. It drives the per-row badges and the worklist filter, both of which can only ever act on
  // a row that is here.
  //
  // `bookScan` comes from the server and covers the owner's ENTIRE confirmed history, so it is the
  // only one entitled to say "how many". Preferring it is what stops the banner from announcing a
  // total it never counted: an invoice booked with a broken breakdown and since paid is beyond the
  // 200-row window, and it went into the aangifte just as wrong as an unpaid one.
  //
  // When the server scan is missing (its read failed) the banner falls back to the list scan and
  // SAYS that the number covers only this list — a smaller claim, not a silent one.
  const scan = bookScan ?? listScan
  const scanIsWholeBook = bookScan != null
  // Findings the owner cannot reach from here: counted, because "3 of them are not in this list" is
  // the difference between a worklist and a dead end. Only meaningful once the whole book was read;
  // otherwise every unloaded row would look like a finding we are hiding.
  const findingsOutsideList = scanIsWholeBook
    ? scan.findings.filter(f => !invoices.some(i => i.id === f.id)).length
    : 0

  const displayed = sortRows(
    invoices.filter(inv => {
      const tabOk = filter === 'all' ? true : filter === 'auto' ? isAutoVerified(inv) : inv.status === filter
      if (!tabOk) return false
      // [INVOICE-SCAN] The worklist view: only the rows the scan flagged. Placed FIRST among the
      // filters so it composes with period and search rather than replacing them — "everything
      // wrong in Q1" is a question the owner actually has.
      if (onlyFlagged && !scanIds.has(inv.id)) return false
      // [PERIODE] Op de FACTUURDATUM — de datum die op de rij staat afgedrukt en waarop de lijst
      // standaard sorteert. Niet op de betaaldatum: dan zou een factuur van maart die je in april
      // betaalde uit maart verdwijnen, terwijl je hem daar zoekt.
      if (!isInPeriod(inv.invoice_date, periodWindow)) return false
      // [SMART-FILTER] shared matcher — leverancier / factuurnummer / bedrag
      // (decimaal- én duizendtal-bewust, zie src/lib/search.ts)
      return rowMatchesQuery(rawS, [inv.client_name, inv.invoice_number], [inv.total_inc_btw])
    }),
    sortBy,
  )
  // [PERIODE] Facturen die WEL aan filter en zoekopdracht voldoen maar geen datum hebben, vallen
  // buiten elke periode. Ze verdwijnen dus uit beeld zodra je een periode kiest — en dat is precies
  // het soort stille verdwijning waar de rest van dit scherm tegen beveiligd is, dus wordt het
  // geteld en gezegd (met de knop om ze te zien).
  const datelessHidden = period === 'all' ? 0 : invoices.filter(inv => {
    const tabOk = filter === 'all' ? true : filter === 'auto' ? isAutoVerified(inv) : inv.status === filter
    if (!tabOk) return false
    if (inv.invoice_date) return false
    return rowMatchesQuery(rawS, [inv.client_name, inv.invoice_number], [inv.total_inc_btw])
  }).length
  // [AUTO-ADVANCE] Count for the review nudge — how many invoices the app booked for you.
  const autoCount = invoices.filter(isAutoVerified).length

  // ── [INVOICE-COUNTER] "Hoeveel facturen heb ik eigenlijk?" ───────────────────
  // Derived from `invoices` on every render, NOT from a server number fetched once. That is the
  // whole point: the moment a factuur is betaald, undone, matched by the bank-run or removed as a
  // duplicate, this array changes and so do the counts. A server total could not move with those
  // actions and would sit there contradicting the list.
  //
  // The trade-off is honest and disclosed: `invoices` is the fetched window (EVERY open row — the
  // server pages them now, rather than trusting that a 1000-cap "is unreachable by design", which
  // was both a guess and exactly PostgREST's silent truncation point — plus the 200 most recent
  // paid ones), so on a long history these are the counts of THIS LIST. totalCount says what the
  // owner really has, and the note below the counter names the difference instead of passing 200
  // off as "everything".
  // The Amsterdam YEAR, derived from the day we already computed — so fmtDateSmart never has to
  // build its own formatter per row (see the note on that function).
  const thisYear = todayIso.slice(0, 4)

  // [NO-SILENT-EMPTY] One flag, read in three places: the banner at the top, the "je hebt er N in
  // totaal" disclosure (which asserts completeness and must go quiet), and the empty state (which
  // must say "we konden niet kijken", not "je hebt niets").
  const loadIncomplete = readFailed.length > 0
  // ── [OPEN-TOTAL] Wat staat er in totaal nog open? ────────────────────────────
  // De vraag die deze lijst oproept en tot nu toe niet beantwoordde: je ziet twaalf rijen met
  // twaalf bedragen en moet zelf optellen wat je vanmiddag kwijt bent.
  //
  // Berekend over `displayed` — dus over precies de rijen die op dit moment op het scherm staan,
  // door het filter én de zoekopdracht heen. Typ je "DHL", dan is het het totaal van DHL. Sta je
  // op "Betaald", dan gaat het over betaalde facturen. Een totaal dat iets anders optelt dan wat
  // eronder staat, is een tweede waarheid op één scherm.
  //
  // openAmountSigned, niet het factuurbedrag: een deelbetaling telt alleen voor de REST mee, een
  // betaalde factuur voor niets, en een creditnota van je leverancier gaat eraf — precies zoals
  // hij een regel lager met zijn minteken staat afgedrukt.
  const openSumDisplayed = Math.round(displayed.reduce((s, i) => s + openAmountSigned(i), 0) * 100) / 100
  // Wat er op de getoonde rijen AL is afgerekend — inclusief het deel van een deelbetaling. Niet
  // "de facturen die op betaald staan": dan zou de €200 die je al hebt overgemaakt op een halve
  // factuur in geen van beide kolommen staan, terwijl hij wel in het totaal zit. Zie
  // settledAmountSigned: open + betaald === totaal, per factuur en dus per lijst.
  const paidSumDisplayed = Math.round(displayed.reduce((s, i) => s + settledAmountSigned(i), 0) * 100) / 100
  const totalSumDisplayed = Math.round(displayed.reduce((s, i) => s + (i.total_inc_btw ?? 0), 0) * 100) / 100

  // ── [AMOUNT-CORRECTION] Correcting the amounts of a confirmed invoice ──
  // Local state only; nothing is written until the owner taps save, and the server re-checks every
  // precondition anyway (see the route header). The triplet keeps ex + btw = total exact while
  // typing, so a correction cannot itself produce the contradiction it is meant to remove.
  const [correctFor, setCorrectFor] = useState<IncomingRow | null>(null)
  const [correctAmounts, setCorrectAmounts] = useState({ ex: 0, btw: 0, incl: 0 })
  const [correctCredit, setCorrectCredit] = useState(false)
  const [correctSaving, setCorrectSaving] = useState(false)

  const openCorrection = (inv: IncomingRow) => {
    setCorrectFor(inv)
    setCorrectAmounts({ ex: inv.total_ex_btw ?? 0, btw: inv.btw_amount ?? 0, incl: inv.total_inc_btw ?? 0 })
    // Never pre-ticked: the app has an opinion (the ⚠ badge) but the declaration is the owner's.
    setCorrectCredit(false)
    setCorrectSaving(false)
  }

  const saveCorrection = async () => {
    if (!correctFor || correctSaving) return
    setCorrectSaving(true)
    try {
      const res = await fetch(`/api/invoice/${correctFor.id}/amounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_ex_btw: correctAmounts.ex,
          btw_amount: correctAmounts.btw,
          total_inc_btw: correctAmounts.incl,
          ...(correctCredit ? { is_credit_note: true } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        // [UI-HONESTY] Say what the server said. Its refusals are permanent states with a way out
        // named in them ("reverse the payment first", "ask your accountant") — a generic "try
        // again" would send the owner at a button that cannot work.
        showToast(typeof data.error === 'string' ? data.error : 'Corrigeren mislukt — er is niets gewijzigd')
        return
      }
      // Only now the list follows. Writing it optimistically would show a corrected amount that
      // the server may have refused — on the screen the owner pays from.
      setInvoices(prev => prev.map(i => i.id === correctFor.id
        ? { ...i, total_ex_btw: data.total_ex_btw, btw_amount: data.btw_amount, total_inc_btw: data.total_inc_btw, invoice_type: data.invoice_type }
        : i))
      setCorrectFor(null)
      showToast('Bedragen gecorrigeerd')
    } catch {
      showToast('Corrigeren mislukt — controleer je verbinding')
    } finally {
      setCorrectSaving(false)
    }
  }

  // [CREDITNOTA-SIGNAL] Every document number per supplier, from the FULL list and not from
  // `displayed`: the evidence that a supplier uses two kinds of number must not depend on whichever
  // filter happens to be on. Search for "CR" and you would otherwise see only credit notes, and the
  // counterpart — the very evidence the signal rests on — disappears.
  const vendorNumbersByName = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const inv of invoices) {
      const key = (inv.client_name ?? '').trim().toLowerCase()
      if (!key || !inv.invoice_number) continue
      const list = m.get(key)
      if (list) list.push(inv.invoice_number)
      else m.set(key, [inv.invoice_number])
    }
    return m
  }, [invoices])

  const showsOpen = displayed.some(i => i.status !== 'paid')
  const showsPaid = paidSumDisplayed !== 0 || displayed.some(i => i.status === 'paid')

  const receivedCount = invoices.filter(i => i.status === 'received').length
  const paidCount     = invoices.filter(i => i.status === 'paid').length
  const listedCount   = invoices.length
  const hiddenCount   = totalCount != null ? Math.max(0, totalCount - listedCount) : 0
  const nFacturen = (n: number) => `${n} ${n === 1 ? 'factuur' : 'facturen'}`
  // Per-tab counts, so choosing a filter already tells you how much is behind it.
  const tabCount = (id: FilterTab) =>
    id === 'all' ? listedCount : id === 'received' ? receivedCount : id === 'paid' ? paidCount : autoCount


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
      // [RECON-MAP-HONEST] applyMap REPLACES the whole badge map (by design — the run's map is
      // the complete post-engine truth). But /api/reconcile/run returns `byInvoice: {}` when the
      // map phase itself threw, and `{}` is truthy: applying it wiped every
      // "In bankafschrift" badge on the page. Worse, the summary sheet names a failed bank/kas/
      // categorize phase but never named `map`, so a run that lost its map read as a clean one
      // that simply found nothing — "Geen open banktransacties om tegen te matchen" while the
      // owner's statement was full of them. Only apply a map the run actually built.
      if (json.byInvoice && !(json.failed ?? []).includes('map')) applyMap(json.byInvoice)
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
    // [PAY-IDEMPOTENT] One key per dialog OPENING, minted here. It used to be produced inside the
    // confirm handler as `payCtx.clientKey ?? crypto.randomUUID()`, but nothing ever set
    // payCtx.clientKey — so every tap got a fresh UUID and apply_manual_payment could never
    // recognise a repeat. A full settlement is still protected by the invoice's own 'paid' status;
    // a DEELBETALING had no guard at all, so a double tap booked the instalment twice.
    //
    // A reopened dialog is a new attempt and gets a new key, on purpose: reusing it would silently
    // swallow a genuine second instalment of the same amount, which is the worse failure.
    const ctx: PayCtx = {
      id: inv.id,
      number: inv.invoice_number ?? '',
      newStatus: 'paid',
      openAmount: openAmount(inv),
      clientKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined,
    }
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
        // [SERVER-REASON] That route refuses with money_settled or bank_linked and a `detail` that
        // names the way out ("draai eerst de betaling terug", "ontkoppel die eerst op de
        // Bank-pagina"). Both are PERMANENT, so "probeer opnieuw" told the owner to repeat the one
        // thing that cannot work. executeRemoval and executeMovePayment in this same file already
        // show the server's sentence; this one did not.
        //
        // `detail` ONLY — deliberately not the `detail || error` fallback executePay uses. On this
        // route `error` is a CODE, and at its 500 it is a raw Postgres message; neither belongs on
        // an owner's phone. No detail → our own Dutch sentence.
        const json = await res.json().catch(() => ({} as { detail?: string }))
        showToast(json?.detail || 'Verwijderen mislukt — ververs de pagina')
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

  // ── [MOVE-PAYMENT] Move a booked payment to the invoice it belongs to ──────────────────────
  // The money is real and the booking is right — only the invoice under it is not. The answer used
  // to be three actions (undo, find the bank line again, re-book) with books in between where the
  // money sits nowhere. So: one move, and the write itself is one database transaction
  // (move_invoice_payment).
  //
  // The SERVER decides which invoices qualify — the same rules the RPC applies, so the list can
  // never offer something the database would refuse. Only what the owner sees lives here.
  async function openMovePayment(inv: IncomingRow) {
    if (moveLoadingId) return
    setMoveLoadingId(inv.id)
    try {
      const res = await fetch(`/api/invoice/payment/move?invoiceId=${encodeURIComponent(inv.id)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(json?.detail || 'Betalingen ophalen mislukt — probeer opnieuw')
        return
      }
      const payments = (json?.payments ?? []) as MovePayment[]
      if (payments.length === 0) {
        // amount_paid > 0 without a single link row: a payment recorded before the join table
        // existed. There is nothing to move, and saying so beats an empty sheet.
        showToast('Van deze betaling is geen boeking gevonden om te verplaatsen')
        return
      }
      setMoveCtx({ inv, payments })
    } catch {
      showToast('Geen verbinding — probeer opnieuw')
    } finally {
      setMoveLoadingId(null)
    }
  }

  async function executeMovePayment(linkId: string, target: MoveTarget, inv: IncomingRow) {
    setMoveCtx(null)
    setProcessingId(inv.id)
    try {
      const res = await fetch('/api/invoice/payment/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId, targetInvoiceId: target.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The move is atomic — a refusal means nothing changed, and the server's sentence says
        // which reason it was. Never our guess: it re-decided on fresher data than we hold.
        showToast(json?.detail || 'Verplaatsen mislukt — er is niets gewijzigd')
        return
      }
      // Both invoices changed. Patch what the server actually reported rather than assuming:
      // the source may still hold other instalments, and the target may or may not be settled.
      patchLocal(inv.id, {
        amount_paid: Number(json.source_amount_paid ?? 0),
        status: json.source_status ?? inv.status,
        ...(Number(json.source_amount_paid ?? 0) <= 0.005
          ? { payment_method: null, payment_date: null }
          : {}),
      })
      patchLocal(target.id, {
        amount_paid: Number(json.target_amount_paid ?? 0),
        status: json.target_status ?? 'received',
      })
      showToast(
        `${fmtEur(Number(json.applied ?? 0))} verplaatst naar ${target.invoice_number ? `factuur ${target.invoice_number}` : 'de gekozen factuur'}`,
      )
    } catch {
      showToast('Geen verbinding — er is niets gewijzigd')
    } finally {
      setProcessingId(null)
    }
  }

  // ── [REMOVAL-ALTERNATIVE] "Draai eerst de betaling terug, daarna kun je hem verwijderen" ──
  // decideRemoval has always named that exit; nothing here could walk through it. The advice it
  // prints ("Ontkoppelen op de Bank-pagina of de Betaald-knop") assumes a bank line or a fully
  // paid invoice, and a PARTLY paid purchase invoice has neither: the Betaald-knop renders only
  // for isPaid, and a MANUAL deelbetaling lives in bank_tx_invoices with transaction_id NULL, so
  // the Bank page never shows it. That is the real-world dead end — the supplier who invoices the
  // wrong amount, corrects it, and leaves the owner with a duplicate they cannot pay off, cannot
  // remove, and cannot find the money on.
  //
  // So the dialog offers the undo on the invoice it is already talking about — but it does NOT
  // perform it on that tap. Undoing is destructive in a way the wording must not gloss over: a
  // BANK instalment returns to "Te bevestigen" (nothing lost, it is re-linkable), while a MANUAL
  // deelbetaling is a row the owner typed by hand — amount, date, method — and clearing it erases
  // that record. So this hands over to the pay sheet's existing "Betaling ongedaan maken?"
  // confirmation, the same one a fully-paid invoice already goes through, rather than inventing a
  // second, quieter path to the same write. `thenRemove` is what makes it a flow instead of two
  // errands: once the undo lands, executePay re-opens the remove sheet.
  function undoPaymentThenRemove(inv: IncomingRow) {
    setRemoveCtx(null)
    setPayCtx({ id: inv.id, number: inv.invoice_number ?? '', newStatus: 'received', thenRemove: true })
  }

  // Re-open the removal sheet after a confirmed undo. The server just wrote exactly this state —
  // no instalments left, back to the open purchase status — so re-deciding from it (rather than
  // from the stale row) is what turns the wall into a real "Ja, verwijderen".
  function reopenRemovalAfterUndo(id: string) {
    const inv = invoices.find(i => i.id === id)
    if (!inv) return
    const settled: RemovalInvoice = { ...(inv as RemovalInvoice), amount_paid: 0, status: 'received' }
    setRemoveCtx({ id, decision: decideRemoval(settled) })
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
  // Returns whether the write actually landed — [REMOVAL-ALTERNATIVE] chains a removal onto a
  // successful undo, and must never re-open the remove sheet on a payment that is still booked.
  async function executePay(ctx: PayCtx): Promise<boolean> {
    setPayCtx(null); setProcessingId(ctx.id)
    // [MANUAL-PARTIAL-PAY] A deelbetaling leaves the invoice on 'Te betalen' — only a full
    // settlement flips the status, so don't claim otherwise before the server answers.
    const isPartialIntent = ctx.newStatus === 'paid' && ctx.amount != null
    if (!isPartialIntent) patchLocal(ctx.id, { status: ctx.newStatus })

    // [PAY-TOGGLE] Route through the server so the mutation is AUDITED and — crucially on undo —
    // any bank transaction matched to this invoice is DETACHED (never a paid-undone invoice beside
    // a still-'matched' tx that the owner could pay a second time). The old direct client write did
    // neither.
    //
    // [PAY-NETWORK-SAFE] fetch REJECTS on a dropped connection — the normal case for a shop
    // owner on a phone, not an exotic one. Unguarded, that rejection left this function before
    // the optimistic flip was rolled back and before processingId was cleared: the row kept
    // claiming "Betaald" while nothing was written, and every later tap died on the
    // `processingId === inv.id` guard, so the button stayed a spinner until a reload. Every
    // sibling action on this page (executeBundlePay, executeRemoval, archiveDuplicate,
    // runReconciliation, openPdf) already guarded this; the most important write did not.
    let res: Response
    try {
      res = await fetch('/api/invoice/pay-toggle', {
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
    } catch {
      // The request never completed. It may or may not have reached the server, and we cannot
      // know which — so say exactly that instead of guessing, and put the row back as it was.
      if (!isPartialIntent) patchLocal(ctx.id, { status: ctx.newStatus === 'paid' ? 'received' : 'paid' })
      showToast('Geen verbinding — controleer of de betaling is opgeslagen')
      setProcessingId(null)
      return false
    }
    const json = await res.json().catch(() => ({} as { error?: string }))
    // [DEPLOY-SAFE] Prefer the server's own sentence when it has one (e.g. a partial cash
    // payment refused because the kasboek cannot date it per instalment yet) — the bare
    // error CODE would reach the owner as gibberish.
    // [PAY-REASON] One rule, shared with the bundle above — see payToggleReason.
    const error = res.ok ? null : { message: payToggleReason(res.status, json as { detail?: string; error?: string }) }

    if (error) {
      // rollback optimistic
      const prev = ctx.newStatus === 'paid' ? 'received' : 'paid'
      if (!isPartialIntent) patchLocal(ctx.id, { status: prev })
      // [BOEK-004] verwerkt conflict (trigger) → actionable dialog; else toast.
      // Keyed on the CODE, not on the sentence: the sentence is now translated, so matching on
      // the word "verwerkt" in it would be matching our own wording back to ourselves.
      if ((json as { error?: string })?.error === 'verwerkt') {
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
      // [PARTIAL-PAY] amount_paid must go with it. The server clears every recorded instalment
      // on an undo (pay-toggle → recompute_invoice_amount_paid); leaving the local value behind
      // turns a fully-undone invoice into a phantom part-payment — the row reads
      // "Deels betaald · € X open" for money nobody paid, and the pay dialog then caps the
      // owner at that invented remainder instead of the full total.
      patchLocal(ctx.id, { payment_method: null, payment_date: null, payment_prepared_at: null, amount_paid: 0 })
      showToast(`Betaling ongedaan gemaakt`)
      // [REMOVAL-ALTERNATIVE] Opened from the remove dialog → hand back to it, now that the money
      // is off and decideRemoval will actually allow the removal. Only on a SUCCEEDED undo: this
      // sits inside the `!error` branch, so a refusal leaves both the payment and the invoice
      // exactly where they were, with the server's reason on screen.
      if (ctx.thenRemove) reopenRemovalAfterUndo(ctx.id)
    }
    // [CASH-SETTLE] The call that used to be here — `fetch('/api/cash/settle')` — is gone, and so
    // is the reason it gave for existing: "This UI updates the invoice directly (not via the
    // confirm endpoint), so it must trigger the reconcile itself." That stopped being true when
    // this function moved to /api/invoice/pay-toggle ([PAY-TOGGLE] above), which reconciles the
    // kasboek on both the pay and the undo branch. So the drawer was being recomputed twice for
    // every payment, and N+1 times for a bundle, on the strength of a comment describing an
    // architecture that no longer existed.
    //
    // The one thing the second call really did provide was an accidental retry: reconcile reports
    // a bailed pass as `ok:false` and pay-toggle used to drop that on the floor. It no longer
    // does ([CASH-RETRY]), so the retry is deliberate, server-side, and reaches every caller —
    // not just the one screen that happened to ask twice.
    setProcessingId(null)
    return !error
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
        {/* [BAR-ALIGN] The shell spans the viewport — the blur and the hairline
            should — but its CONTENT lines up with the list underneath. Without
            this column the filter and sort dropdowns stretched the full width of
            the screen above a 680px list, and "Matchen met bank & kas" ended up
            a long way from the invoices it matches. Same width as <main> below,
            and as the selection bar at the bottom of the file. */}
        <div style={{ maxWidth: columnInner(COLUMN.work), margin: '0 auto' }}>
          {/* [BUNDEL-BETALING] The multi-select toggle — the entry point for paying
              several facturen van één leverancier with one QR. Given a clear
              affordance (blue tint + border in rest, solid blue when active) and put
              FIRST so it reads first, not tucked in a corner.
              [TOOLBAR-ROW] The two actions and the Verificatie shortcut share ONE
              wrapping row. They used to be two separate blocks stacked on top of
              each other, which is right on a phone but wasted a whole line of a
              sticky toolbar on a desktop — and that toolbar sits above the list, so
              the line it wasted pushed every invoice down.
              Layout lives in globals.css (.inko-actions), not inline: the media
              query has to be able to win, and an inline style outranks a class. */}
          <div className="inko-actions">
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
            <Link href="/dashboard/incoming" title="Verificatie" className="inko-inbox tap-44" style={{ background: M3.surfaceVariant, border: 'none', borderRadius: R.full, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5f6368' }}>inbox</span>
            </Link>

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
            className="inko-match"
            title="Koppelt je inkoopfacturen aan het bankafschrift en aan de kas, en werkt alles bij wat zeker is"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px',
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
              style={{ fontSize: 18, animation: matchBusy ? 'spin 1s linear infinite' : undefined }}
            >
              {matchBusy ? 'refresh' : 'link'}
            </span>
            {matchBusy ? 'Bezig met matchen…' : 'Matchen met bank & kas'}
          </button>
        </div>

          {/* [PERIODE] De periodekiezer staat BOVEN filter en sorteren, op zijn eigen regel: hij
              bepaalt WELKE facturen er zijn, terwijl die twee bepalen hoe je ze bekijkt — en het
              bedrag boven de lijst hangt aan deze keuze. Volle breedte, want de gekozen periode is
              het antwoord op "waar gaat dit bedrag over" en moet leesbaar blijven ("Vorig kwartaal
              · Q2 2026"). */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <button
              onClick={() => { setShowPeriodMenu(p => !p); setShowFilterMenu(false); setShowSortMenu(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', padding: '10px 14px', background: period === 'all' ? '#F1F3F4' : M3.primaryContainer, borderRadius: R.md, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: period === 'all' ? '#49454F' : M3.onPrimaryContainer, flexShrink: 0 }}>date_range</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: period === 'all' ? '#49454F' : M3.onPrimaryContainer, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {INVOICE_PERIODS.find(p => p.id === period)?.label ?? 'Alle periodes'}
                  {periodWindow.label ? ` · ${periodWindow.label}` : ''}
                </span>
              </span>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: period === 'all' ? '#49454F' : M3.onPrimaryContainer, flexShrink: 0 }}>
                {showPeriodMenu ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {showPeriodMenu && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', borderRadius: R.md, marginTop: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                {INVOICE_PERIODS.map(p => {
                  // De concrete periode naast de keuze ("Vorige maand · juni 2026"), zodat niemand
                  // hoeft te raden welke maanden hij te zien krijgt.
                  const win = resolveInvoicePeriod(p.id, todayIso)
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setPeriod(p.id); setShowPeriodMenu(false) }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '12px 16px', textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 14, fontWeight: period === p.id ? 600 : 400, background: period === p.id ? M3.primaryContainer : '#fff', color: period === p.id ? M3.onPrimaryContainer : M3.onSurface, borderBottom: '0.5px solid #F1F3F4' }}
                    >
                      <span>{p.label}</span>
                      {win.label && (
                        <span style={{ fontSize: 12, color: period === p.id ? M3.onPrimaryContainer : '#80868B', fontFamily: FONT_NUM, flexShrink: 0 }}>{win.label}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

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
      </div>

      {/* ── List ── */}
      <main style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '12px 16px 100px' }}>
        {/* ── [NO-SILENT-EMPTY] "We konden niet alles lezen" ───────────────────────────────────
            First thing on the page, because it qualifies everything under it: every count, every
            tab, and the absence of any row. The server's reads used to fail into an empty array,
            and this screen then said "Geen inkoopfacturen" — on the list the owner pays their
            suppliers from, that sentence means "je bent niemand iets schuldig". The list still
            renders whatever DID load (a stale list beats a blank screen); it just no longer
            claims to be the whole of it. */}
        {loadIncomplete && (
          <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, padding: '12px 14px', borderRadius: R.md, border: '1px solid #F5C6C0', background: '#FCE8E6', fontFamily: FONT }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.error, flexShrink: 0, marginTop: 1 }}>error</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#B3261E', margin: 0, lineHeight: 1.4 }}>
                We konden je {readFailed.join(' en ')} niet ophalen
              </p>
              <p style={{ fontSize: 12.5, color: '#8C1D18', margin: '3px 0 0', lineHeight: 1.45 }}>
                Deze lijst is daardoor niet compleet — ga er niet van uit dat wat je hier ziet alles is.
              </p>
              <button
                onClick={() => router.refresh()}
                style={{ marginTop: 8, padding: '7px 14px', borderRadius: R.full, border: 'none', background: M3.error, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
              >
                Opnieuw proberen
              </button>
            </div>
          </div>
        )}
        {/* [INVOICE-SCAN] How much is standing wrong, and where.
            Before this, every warning lived on a single card: useful once you were already looking
            at that card, useless for the question the owner has after seeing two of them — how many
            more are there? A list of hundreds cannot be checked by eye, and the ones that WERE
            noticed were noticed by accident.
            The quarter matters as much as the count: in an open quarter a correction is just a
            correction; in a filed one it is a correction to the return itself. */}
        {scan.total > 0 && (
          <div role="status" style={{ marginBottom: 10, padding: '12px 14px', borderRadius: R.md, border: '1px solid #F5D9A8', background: M3.warningContainer, fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#B26A00', flexShrink: 0, marginTop: 1 }}>fact_check</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#7C5800', margin: 0, lineHeight: 1.4 }}>
                  {scan.total === 1 ? '1 geboekte factuur klopt niet' : `${scan.total} geboekte facturen kloppen niet`}
                </p>
                <p style={{ fontSize: 12.5, color: '#7C5800', margin: '3px 0 0', lineHeight: 1.5 }}>
                  {/* [SCAN-WHOLE-BOOK] Which set was counted, in the sentence itself. Without this
                      the same number means two different things depending on a read the owner
                      cannot see the outcome of. */}
                  {scanIsWholeBook
                    ? `Gecontroleerd: al je ${scan.scanned} bevestigde inkoopfacturen.`
                    : `Gecontroleerd: de ${scan.scanned} ${scan.scanned === 1 ? 'factuur' : 'facturen'} op dit scherm — je oudere betaalde facturen konden we nu niet nakijken.`}
                  {' '}Deze tellen nu mee in je openstaande saldo en in de btw die je terugvraagt.
                </p>
                {/* Findings that are not on this screen (already paid, past the 200 most recent).
                    Named rather than quietly dropped: the worklist button below can only show rows
                    that are here, so without this line the two numbers would silently disagree. */}
                {findingsOutsideList > 0 && (
                  <p style={{ fontSize: 12.5, color: '#7C5800', margin: '3px 0 0', lineHeight: 1.5 }}>
                    {findingsOutsideList === 1
                      ? 'Eén ervan staat niet in deze lijst (al betaald en ouder dan de laatste 200) — zoek hem op factuurnummer of leverancier.'
                      : `${findingsOutsideList} ervan staan niet in deze lijst (al betaald en ouder dan de laatste 200) — zoek ze op factuurnummer of leverancier.`}
                  </p>
                )}
                {/* Per quarter, newest first. The filed marker is the part that changes what the
                    owner has to DO, so it stands in the same line as the count. */}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {scan.quarters.map(q => {
                    const filed = filedQuarters == null ? null : q.quarter != null && filedQuarters.includes(q.quarter)
                    const n = q.signConflict + q.creditSuspect + q.arithmetic
                    return (
                      <p key={q.quarter ?? 'geen'} style={{ fontSize: 12.5, color: '#7C5800', margin: 0, lineHeight: 1.5 }}>
                        <strong>{q.quarter ? quarterLabelOf(q.quarter) : 'Zonder factuurdatum'}</strong>
                        {' · '}{n} {n === 1 ? 'factuur' : 'facturen'}
                        {' · '}{fmtEur(q.amount)}
                        {filed === true && <span style={{ fontWeight: 700 }}> · aangifte al ingediend — dit wordt een correctie</span>}
                        {filed === null && <span> · we konden niet nagaan of dit kwartaal al is ingediend</span>}
                      </p>
                    )
                  })}
                </div>
                <button
                  onClick={() => setOnlyFlagged(v => !v)}
                  style={{ marginTop: 10, padding: '7px 14px', borderRadius: R.full, border: 'none', background: onlyFlagged ? '#7C5800' : '#fff', color: onlyFlagged ? '#fff' : '#7C5800', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}
                >
                  {onlyFlagged ? 'Toon alle facturen' : 'Toon alleen deze'}
                </button>
              </div>
            </div>
          </div>
        )}
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
              <button onClick={() => setSearch('')} aria-label="Wissen" className="tap-44"
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
                // [PERIODE] Met een periode aan gaat ALLES op deze regel over die periode. De
                // "12 facturen · 5 te betalen · 7 betaald"-samenvatting hieronder telt de hele
                // lijst, en die naast een bedrag zetten dat over juni gaat, is twee waarheden.
                : period !== 'all'
                  ? `${nFacturen(displayed.length)} in ${periodWindow.label}`
                  : filter === 'all'
                    ? `${nFacturen(listedCount)} · ${receivedCount} te betalen · ${paidCount} betaald`
                    : `${displayed.length} van ${nFacturen(listedCount)}`}
            </p>
            {/* [OPEN-TOTAL] Het bedrag onder de aantallen: wat er van deze rijen nog te betalen is,
                wat er al betaald is, en — zodra die twee allebei bestaan — het totaal. Groter en
                donkerder dan de regel erboven, want dit is de vraag waarmee iemand deze pagina
                opent; het aantal facturen is context.
                De kleuren zijn die van de statuschips ("Te betalen" amber, "Betaald" groen), zodat
                elk bedrag zichtbaar bij de rijen hoort waar het uit komt, en het totaal neutraal
                blijft omdat het over allebei gaat. */}
            {(showsOpen || showsPaid) && (
              <p style={{ fontSize: 14, fontFamily: FONT, margin: '4px 0 0', fontWeight: 700, color: M3.onSurface, display: 'flex', flexWrap: 'wrap', gap: '0 10px' }}>
                {showsOpen && (
                  <span style={{ color: '#7C5800' }}>
                    {fmtEur(openSumDisplayed)} <span style={{ fontWeight: 600, fontSize: 12.5 }}>nog te betalen</span>
                  </span>
                )}
                {showsPaid && (
                  <span style={{ color: '#137333' }}>
                    {fmtEur(paidSumDisplayed)} <span style={{ fontWeight: 600, fontSize: 12.5 }}>betaald</span>
                  </span>
                )}
                {/* Het totaal staat erbij zodra het IETS toevoegt: als er alleen openstaande rijen
                    in beeld zijn is het totaal exact het openstaande bedrag, en dan is hetzelfde
                    getal twee keer afdrukken geen extra informatie maar ruis. Staat het er wél,
                    dan klopt de optelling: nog te betalen + betaald = totaal, tot op de cent
                    (settledAmountSigned in partial-payment.ts bewaakt precies die identiteit). */}
                {showsOpen && showsPaid && (
                  <span style={{ color: M3.onSurface }}>
                    {fmtEur(totalSumDisplayed)} <span style={{ fontWeight: 600, fontSize: 12.5 }}>totaal</span>
                  </span>
                )}
              </p>
            )}
            {/* [PERIODE] Facturen zonder factuurdatum vallen buiten elke periode. Ze staan er dus
                niet meer bij — en dat mag niet stil gebeuren op een scherm waar een bedrag boven de
                lijst staat: de knop zet je terug op "Alle periodes", waar ze wél staan. */}
            {datelessHidden > 0 && (
              <p style={{ fontSize: 11.5, color: '#80868B', fontFamily: FONT, margin: '3px 0 0', lineHeight: 1.4 }}>
                {datelessHidden === 1 ? '1 factuur heeft' : `${datelessHidden} facturen hebben`} geen factuurdatum en
                {datelessHidden === 1 ? ' valt' : ' vallen'} buiten deze periode.{' '}
                <button
                  onClick={() => setPeriod('all')}
                  style={{ background: 'none', border: 'none', padding: 0, color: M3.primary, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline' }}
                >
                  Toon alle periodes
                </button>
              </p>
            )}
            {/* [NO-SILENT-EMPTY] Een bedrag leest als een feit, dus zegt het er zelf bij wanneer
                het over een onvolledige lijst gaat. De rode balk bovenaan zegt WAT er misging; deze
                regel zorgt dat het TOTAAL niet los daarvan als compleet wordt gelezen. */}
            {loadIncomplete && (showsOpen || showsPaid) && (
              <p style={{ fontSize: 11.5, color: M3.error, fontFamily: FONT, margin: '2px 0 0', lineHeight: 1.4 }}>
                Dit telt alleen op wat we konden ophalen — er ontbreken facturen.
              </p>
            )}
            {/* The list is a window, not the archive: the paid query stops at 200. Say so rather
                than let the counter imply the owner owns fewer facturen than he does.
                [NO-SILENT-EMPTY] Not while a source read failed: this sentence asserts that the
                {receivedCount} openstaande facturen shown ARE all of them, which is exactly what
                we do not know then. The banner at the top of the page has already said so. */}
            {hiddenCount > 0 && !loadIncomplete && period === 'all' && (
              <p style={{ fontSize: 11.5, color: '#80868B', fontFamily: FONT, margin: '3px 0 0', lineHeight: 1.4 }}>
                Je hebt er {totalCount} in totaal. Deze lijst toont de {receivedCount} openstaande en de {paidCount} meest recente betaalde.
              </p>
            )}
          </div>
        )}

        {displayed.length === 0 ? (
          rawS ? (
            <p style={{ textAlign: 'center', color: '#8e8e93', fontSize: 14, padding: '40px 16px' }}>Geen facturen gevonden voor &ldquo;{rawS}&rdquo;.</p>
          ) : loadIncomplete ? (
            // [NO-SILENT-EMPTY] "Geen inkoopfacturen" is a claim about the owner's books. With a
            // failed read we have no basis for it, and on this screen the claim is the dangerous
            // direction: it tells someone with unpaid suppliers that they owe nobody anything.
            <LoadFailedState onRetry={() => router.refresh()} />
          ) : period !== 'all' ? (
            // [PERIODE] Ook dit is een claim: "Geen inkoopfacturen" terwijl je er twaalf hebt en er
            // alleen geen in juni vallen. Zeg wat er aan de hand is, en bied de weg terug.
            <div style={{ textAlign: 'center', padding: '48px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, marginTop: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 44, color: '#C4C7C5', display: 'block', marginBottom: 10 }}>date_range</span>
              <p style={{ fontSize: 15.5, fontWeight: 600, color: '#202124', marginBottom: 4, fontFamily: FONT }}>
                Geen inkoopfacturen in {periodWindow.label}
              </p>
              <p style={{ fontSize: 13.5, color: '#5F6368', fontFamily: FONT, marginBottom: 14 }}>
                Je hebt er {nFacturen(listedCount)} in andere periodes.
              </p>
              <button
                onClick={() => setPeriod('all')}
                style={{ padding: '9px 18px', borderRadius: R.full, border: 'none', background: M3.primary, color: M3.onPrimary, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
              >
                Toon alle periodes
              </button>
            </div>
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
              // [CREDITNOTA-SIGNAL] A credit note cannot be late: you do not have to pay it, it
              // comes off your balance. A dunning badge on it is therefore always nonsense — and
              // exactly what was there ("135 days late" on a € 51.80 credit). Both the correctly
              // booked kind and an already-negative amount count here: both behave as a credit,
              // whichever of the two the supplier put on paper.
              const isCreditnota = inv.invoice_type === 'creditnota' || (inv.total_inc_btw ?? 0) < 0
              const daysLate = isPaid || isCreditnota ? null : overdueDays(inv.due_date, todayIso)
              // What THIS supplier's numbering gives away. See creditnota-signal.ts: only when the
              // same supplier demonstrably uses two kinds of prefix does "CR" mean anything.
              // [ARITHMETIC-VISIBLE] The same verdict the verify queue shows, computed here for the
              // first time. Until now this screen displayed a broken breakdown as if nothing were
              // wrong: an invoice whose excl + BTW does not equal its total still counted for its
              // full amount in "nog te betalen" and pushed its btw into the return — and the only
              // place that said so was the queue, which the owner had already left behind.
              const health = classifyImportHealth({
                total_ex_btw: inv.total_ex_btw,
                btw_amount: inv.btw_amount,
                total_inc_btw: inv.total_inc_btw,
                invoice_date: inv.invoice_date,
                invoice_number: inv.invoice_number,
                invoice_type: inv.invoice_type,
                field_confidence: inv.field_confidence as never,
              })
              // Only the arithmetic axis. The other axes (unsure vendor, possible duplicate) belong
              // to intake and were already answered when the owner confirmed this invoice; repeating
              // them here would turn a payment list into a second inbox.
              const mathProblem = health.flags.arithmetic
              const signConflict = creditnotaSignConflict({ invoiceType: inv.invoice_type, totalIncBtw: inv.total_inc_btw })
              const creditSignal = looksLikeCreditnota({
                invoiceNumber: inv.invoice_number,
                totalIncBtw: inv.total_inc_btw,
                invoiceType: inv.invoice_type,
                vendorNumbers: vendorNumbersByName.get((inv.client_name ?? '').trim().toLowerCase()) ?? [],
              })
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
                    // [BUNDEL-SELECTIE] `isSelected`, not raw selectedIds: selectedRows now drops a
                    // row that stopped being 'received' while selected (the bank-match run patches
                    // rows to 'paid' mid-selection). Keying the highlight off the raw id would let
                    // a row keep the selected background while the bar no longer counts it — and it
                    // cannot be tapped off either, since the toggle only fires on 'received'.
                    style={{ background: (selectedIds[inv.id] && inv.status === 'received') ? M3.primaryContainer : highlightId === inv.id ? M3.primaryContainer : '#fff', padding: '14px 16px', cursor: selectMode && inv.status !== 'received' ? 'default' : 'pointer', transition: 'background 0.4s ease', opacity: selectMode && inv.status !== 'received' ? 0.4 : 1 }}
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
                            // Patch the SAME fields runReconciliation patches for the same outcome
                            // (a booked bank match). Setting only the status left the row reading
                            // "Betaald" with no payment date — so the cross-quarter marker (xq)
                            // could not be computed and the "voorbereid" nudge stayed up, until a
                            // reload. The date is the bank line's, which we do not have here, so
                            // the invoice's own date is the honest stand-in the server also falls
                            // back to; a reload replaces it with the exact one.
                            if (r === 'ok') {
                              patchLocal(id, {
                                status: 'paid',
                                payment_method: 'bank',
                                // The row being confirmed is UNPAID, so its own payment_date is
                                // null — reading that would have written null straight back and
                                // made this whole patch inert. The invoice date is the stand-in
                                // the confirm route itself falls back to; a reload replaces it
                                // with the bank line's real date.
                                payment_date: invoices.find(i => i.id === id)?.invoice_date ?? null,
                                payment_prepared_at: null,
                              })
                              showToast('Betaling bevestigd ✓')
                            }
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
                        <span style={{ whiteSpace: 'nowrap' }}>{fmtDateSmart(inv.invoice_date, thisYear)}</span>
                        {/* [OVER-DATUM] The due date is only ever a FACT here — a printed
                            vervaldatum, or invoice date + a printed term (see lib/safecore.ts).
                            When the invoice stated neither we say so, rather than leaving a blank
                            that reads as "no rush" or inventing the customary 30 days. */}
                        {inv.due_date ? (
                          <span style={{ whiteSpace: 'nowrap' }}>· uiterlijk {fmtDateSmart(inv.due_date, thisYear)}</span>
                        ) : (
                          <span style={{ whiteSpace: 'nowrap', color: '#9AA0A6' }}>· geen vervaldatum</span>
                        )}
                        {/* [CREDITNOTA-SIGNAL] Booked correctly: just say so. Without this badge
                            the only difference from an invoice is a minus sign in the amount, and
                            that is too little for a document that works the other way. */}
                        {isCreditnota && (
                          <span
                            title="Creditnota — dit bedrag gaat van je openstaande saldo af en verlaagt de btw die je terugvraagt"
                            style={{ whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700, borderRadius: R.full, padding: '1px 8px', background: '#E6F4EA', color: '#0B8043' }}
                          >
                            Creditnota
                          </span>
                        )}
                        {/* [CREDITNOTA-SIGNAL] A suspicion, not a verdict. We do NOT flip the sign:
                            at another supplier "CR" can mean something entirely different, and a
                            wrong flip turns a real debt into a credit — then you underpay and find
                            out at the dunning letter. The screen shows what it saw; the owner
                            decides. */}
                        {/* [CREDITNOTA-SIGNAL] The contradiction: the app itself calls it a credit
                            note and booked it as a debt. Not a suspicion — an error. */}
                        {signConflict && (
                          <span
                            title="Deze creditnota staat met een POSITIEF bedrag in de boeken. Daardoor telt hij mee in 'nog te betalen' terwijl hij eraf hoort te gaan, en wordt zijn btw opgeteld in plaats van afgetrokken."
                            style={{ whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700, borderRadius: R.full, padding: '1px 8px', background: M3.errorContainer, color: M3.error }}
                          >
                            ⚠ Creditnota staat positief
                          </span>
                        )}
                        {creditSignal.suspected && (
                          <span
                            title={creditnotaSignalText(creditSignal) ?? ''}
                            style={{ whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700, borderRadius: R.full, padding: '1px 8px', background: M3.warningContainer, color: '#7C5800' }}
                          >
                            ⚠ Lijkt een creditnota
                          </span>
                        )}
                        {/* [ARITHMETIC-VISIBLE] The breakdown does not add up. The full reason —
                            which of the three amounts is the odd one out, and what the total
                            implies it should be — sits in the tooltip and in the correction
                            screen; the badge only has to make sure the row is not read as fine. */}
                        {mathProblem && (
                          <span
                            title={health.reasons.join(' · ')}
                            style={{ whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700, borderRadius: R.full, padding: '1px 8px', background: M3.warningContainer, color: '#7C5800' }}
                          >
                            ⚠ Bedragen kloppen niet
                          </span>
                        )}
                        {/* Past the date — the loud half. Unpaid bills only; a settled invoice
                            cannot be late. */}
                        {daysLate !== null && (
                          <span
                            title={`Vervaldatum ${fmtDateSmart(inv.due_date, thisYear)} — ${daysLate} ${daysLate === 1 ? 'dag' : 'dagen'} te laat`}
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
                            title={`Vervaldatum ${fmtDateSmart(inv.due_date, thisYear)}${daysLeft === 0 ? ' — vandaag te betalen' : ` — nog ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagen'}`}`}
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
                      {/* [CREDITNOTA-SIGNAL] A credit note carries its own sign. That is not
                          styling but the bookkeeping truth: the amount comes OFF your balance.
                          fmtEur (Intl, nl-NL) prints a negative value with a minus by itself — the
                          green says which way it goes, so a minus sign on a phone cannot be
                          overlooked. */}
                      <p style={{ fontSize: 15, fontWeight: 700, color: isCreditnota ? '#0B8043' : M3.onSurface, fontFamily: FONT_NUM }}>
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
                        <InfoLine label="Factuurdatum" value={fmtDateSmart(inv.invoice_date, thisYear)} />
                        {inv.due_date && <InfoLine label="Vervaldatum" value={fmtDateSmart(inv.due_date, thisYear)} />}
                        <InfoLine label="Excl. BTW" value={fmtEur(totalExBtw)} mono />
                        <InfoLine label={((r) => r == null ? 'BTW' : `BTW (${r}%)`)(calcBtw(btwAmount, totalExBtw))} value={fmtEur(btwAmount)} mono />
                        <InfoLine label="Incl. BTW" value={fmtEur(inv.total_inc_btw)} mono />
                        {inv.payment_date && <InfoLine label="Betaaldatum" value={fmtDate(inv.payment_date)} />}
                        {inv.payment_method && <InfoLine label="Methode" value={inv.payment_method === 'kas' ? 'Contant' : 'Bank'} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {/* [AMOUNT-CORRECTION] The way out that did not exist. Until now a confirmed
                            invoice whose amounts were misread could only be archived (which hides a
                            real purchase) or handed to the accountant. Offered only where a
                            correction is actually allowed: an unpaid invoice with no money booked
                            against it — the same two conditions the server re-checks. Shown for
                            every such row, not only the flagged ones: the reader can be wrong
                            without any gate noticing, and the owner has the paper. */}
                        {inv.status === 'received' && !(inv.amount_paid && inv.amount_paid > 0.005) && (
                          <button
                            onClick={() => openCorrection(inv)}
                            style={{
                              padding: '8px 14px', borderRadius: R.full, border: 'none', cursor: 'pointer',
                              fontSize: 13, fontWeight: 600,
                              background: mathProblem || signConflict ? M3.warningContainer : M3.surfaceVariant,
                              color: mathProblem || signConflict ? '#7C5800' : '#3c4043',
                            }}
                          >
                            Bedragen corrigeren
                          </button>
                        )}
                        {/* [MOVE-PAYMENT] "Betaling verplaatsen" — the answer when the money is
                            real but sits on the wrong invoice: a supplier's corrected re-issue, a
                            matcher picking the wrong one of two equal amounts, a tap on the row
                            above. It stands HERE, next to Betaaldatum and Methode, because that is
                            where the owner is looking when they realise it. The alternative was
                            three steps (undo, find the bank line, re-book) with the money existing
                            nowhere in between — this is one atomic move. Offered only when there
                            is money to move. */}
                        {Math.max(0, inv.amount_paid ?? 0) > 0.005 && (
                          <button
                            onClick={e => { e.stopPropagation(); openMovePayment(inv) }}
                            disabled={moveLoadingId === inv.id}
                            style={{ fontSize: 13, color: M3.primary, background: '#fff', border: `1px solid ${M3.surfaceVariant}`, borderRadius: R.full, padding: '8px 16px', cursor: moveLoadingId === inv.id ? 'default' : 'pointer', fontWeight: 500, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              {moveLoadingId === inv.id ? 'hourglass_empty' : 'swap_horiz'}
                            </span>
                            {moveLoadingId === inv.id ? 'Bezig…' : 'Betaling verplaatsen'}
                          </button>
                        )}
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
          position: 'fixed', left: 16, right: 16, bottom: `calc(20px + var(--bottom-nav-h) + env(safe-area-inset-bottom))`,
          // [BAR-ALIGN] Same 648 as before, now derived from the column — this bar
          // was already the one that lined up with the list.
          maxWidth: columnInner(COLUMN.work), margin: '0 auto', zIndex: 60,
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

      {/* ── [MOVE-PAYMENT] Which invoice does this payment belong to? ──
          No free-text search: the server returns only invoices that can genuinely receive the money
          (same direction, payable status, enough left open, not locked by the accountant), in the
          order they are most likely meant. Each row shows the amount AND what is still open, so
          picking is an informed choice rather than a guess followed by a confirmation. */}
      {moveCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setMoveCtx(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: `${R.lg}px ${R.lg}px 0 0`, padding: 24, width: '100%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', fontFamily: FONT }}
          >
            <h3 style={{ fontSize: 17, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>
              Betaling verplaatsen
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 18px' }}>
              Van inkoopfactuur {moveCtx.inv.invoice_number || '—'} naar de factuur waar deze betaling bij hoort.
              Het bedrag, de betaaldatum en de methode gaan ongewijzigd mee.
            </p>

            {moveCtx.payments.map(p => (
              <div key={p.id} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, marginBottom: 8 }}>
                  {fmtEur(p.amount_applied)}
                  {p.paid_on ? ` · ${fmtDate(p.paid_on)}` : ''}
                  {p.method === 'kas' ? ' · Contant' : p.transaction_id ? ' · Bank' : ''}
                </div>

                {/* A pre-[PARTIAL-PAY] link carries no amount. Moving it would mean guessing how
                    much travels, and guessing is the one thing this must never do. */}
                {!p.movable ? (
                  <p style={{ fontSize: 13, color: '#9a5b00', background: '#fff4e5', border: '1px solid #ffd9a8', borderRadius: R.md, padding: '10px 12px', margin: 0, lineHeight: 1.5 }}>
                    Van deze betaling is geen bedrag vastgelegd, dus verplaatsen kan niet. Draai hem terug
                    en boek hem opnieuw op de juiste factuur.
                  </p>
                ) : p.targets.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#5F6368', background: '#F8F9FA', borderRadius: R.md, padding: '10px 12px', margin: 0, lineHeight: 1.5 }}>
                    Geen factuur gevonden waar dit bedrag op past. Een factuur kan alleen een betaling
                    ontvangen als hij gecontroleerd is, van dezelfde soort is, en er minstens {fmtEur(p.amount_applied)} op
                    open staat.
                  </p>
                ) : (
                  p.targets.map(t => {
                    const open = Math.max(0, Math.abs(Number(t.total_inc_btw ?? 0)) - Math.max(0, Number(t.amount_paid ?? 0)))
                    return (
                      <button
                        key={t.id}
                        onClick={() => executeMovePayment(p.id, t, moveCtx.inv)}
                        style={{
                          width: '100%', textAlign: 'left', marginBottom: 8, padding: '12px 14px',
                          borderRadius: R.md, border: `1px solid ${M3.surfaceVariant}`, background: '#fff',
                          cursor: 'pointer', fontFamily: FONT, display: 'block',
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>
                          {t.invoice_number || '(geen nummer)'} · {t.client_name || '—'}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#5F6368', marginTop: 2 }}>
                          {t.invoice_date ? `${fmtDateSmart(t.invoice_date, thisYear)} · ` : ''}
                          {fmtEur(t.total_inc_btw ?? null)} · nog {fmtEur(open)} open
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            ))}

            <button
              onClick={() => setMoveCtx(null)}
              style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              Annuleren
            </button>
          </div>
        </div>
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
          /* [REMOVAL-ALTERNATIVE] decideRemoval names a way forward for every dead end it
             produces, and this call site discarded all of them — so the sheet in the screenshot
             offered "Sluiten" and "Annuleren" to an owner who had just been told what to do
             instead. Both kinds that can reach a PURCHASE invoice are wired: the payment comes
             off here (undoPaymentThenRemove), and a boekhouder's lock reuses the verwerkt dialog
             this file already has. */
          secondaryAction={(() => {
            const alt = removeCtx.decision.alternative
            if (!alt) return undefined
            const inv = invoices.find(i => i.id === removeCtx.id)
            if (alt.kind === 'undo-payment') {
              if (!inv) return undefined
              return { label: alt.label, onClick: () => undoPaymentThenRemove(inv) }
            }
            if (alt.kind === 'ask-accountant') {
              return {
                label: alt.label,
                onClick: () => {
                  const id = removeCtx.id
                  setRemoveCtx(null)
                  setRequestSent(false)
                  setVerwerktCtx({ id, number: inv?.invoice_number ?? '' })
                },
              }
            }
            // 'creditnota' — decideRemoval only produces it for OUTGOING invoices, which never
            // reach this purchase-only screen. Nothing honest to offer here, so nothing is shown.
            return undefined
          })()}
        />
      )}

      {/* ── Pay dialog (Bank/Contant + date on mark-paid; single confirm on undo) ── */}
      {payCtx && (
        <BottomSheet
          title={payCtx.newStatus === 'paid' ? 'Inkoopfactuur markeren als betaald?' : 'Betaling ongedaan maken?'}
          body={
            payCtx.newStatus === 'paid'
              ? `Inkoopfactuur ${payCtx.number} wordt als betaald gemarkeerd.`
              // [UNDO-HONEST] An undo is all-or-nothing and it ERASES what was recorded, so the
              // sheet has to say which of the two it is about to do. On a fully paid invoice the
              // old sentence was right. On a PARTLY paid one it was wrong twice over: the invoice
              // is already 'Te betalen' (nothing is "put back"), and what actually disappears —
              // the noted instalments — went unmentioned. That matters most for a MANUAL
              // deelbetaling: amount, date and method are what the owner typed, and nothing else
              // holds them. A bank instalment is different and says so: the line returns to "Te
              // bevestigen" on the Bank-pagina, still there, still re-linkable.
              : (() => {
                  const inv = invoices.find(i => i.id === payCtx.id)
                  const paid = Math.max(0, inv?.amount_paid ?? 0)
                  const partly = inv?.status !== 'paid' && paid > 0.005
                  const whereItGoes =
                    inv?.payment_method === 'kas'
                      ? ' De kasboekregel voor deze betaling vervalt daarmee ook.'
                      : ' Stond er een bankregel tegenover, dan komt die terug bij "Te bevestigen" op de Bank-pagina.'
                  return partly
                    ? `De genoteerde deelbetaling van ${fmtEur(paid)} op inkoopfactuur ${payCtx.number} wordt gewist. De factuur blijft openstaan, voor het volle bedrag.${whereItGoes}`
                    : `Inkoopfactuur ${payCtx.number} wordt teruggeplaatst naar 'Te betalen' en elke genoteerde betaling erop wordt gewist.${whereItGoes}`
                })()
          }
          confirmLabel={payCtx.newStatus === 'paid' ? 'Ja, markeer als betaald' : 'Ongedaan maken'}
          confirmBg={payCtx.newStatus === 'paid' ? M3.success : M3.warning}
          onConfirm={() => executePay(payCtx)}
          onCancel={() => setPayCtx(null)}
          paymentChoice={
            payCtx.newStatus === 'paid'
              ? (method, paymentDate, amount) => executePay({
                  // [PAY-IDEMPOTENT] The key rides along from payCtx, minted when this dialog was
                  // opened (see requestPay). Generating it here gave every tap its own key, which
                  // is the one thing an idempotency key must not do.
                  ...payCtx, paymentMethod: method, paymentDate, amount,
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

      {/* ── [AMOUNT-CORRECTION] Correct the amounts of a confirmed invoice ──
          Three fields, all editable, and ex + btw = total holds after every keystroke
          (amount-triplet.ts). The total leads: it is the clearest figure on any invoice and the one
          the bank statement has to match, so typing it over lets the ex amount — the figure the
          reader keeps getting wrong on wholesale invoices — follow by itself. */}
      {correctFor && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}
          onClick={() => !correctSaving && setCorrectFor(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: 'calc(22px + var(--bottom-nav-h) + env(safe-area-inset-bottom))', width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
          >
            <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>Bedragen corrigeren</p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: '4px 0 16px', lineHeight: 1.45 }}>
              {correctFor.client_name ?? 'Leverancier onbekend'}
              {correctFor.invoice_number ? ` · ${correctFor.invoice_number}` : ''}
              <br />
              Neem het totaal en de BTW over zoals ze onderaan de factuur staan — het bedrag
              exclusief rekent zichzelf uit.
            </p>

            {[
              { key: 'incl' as const, label: 'Totaal (incl. BTW)', apply: setIncl, strong: true },
              { key: 'btw' as const, label: 'BTW', apply: setBtw, strong: false },
              { key: 'ex' as const, label: 'Bedrag excl. BTW', apply: setExcl, strong: false },
            ].map(f => (
              <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: f.strong ? 700 : 500, color: '#202124' }}>{f.label}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={correctAmounts[f.key]}
                  onChange={e => setCorrectAmounts(f.apply(correctAmounts, parseFloat(e.target.value) || 0))}
                  aria-label={f.label}
                  style={{ width: 140, padding: '9px 11px', fontSize: f.strong ? 17 : 15, fontWeight: f.strong ? 700 : 600, borderRadius: 10, border: '1.5px solid #1a73e8', textAlign: 'right', outline: 'none', color: '#202124' }}
                />
              </div>
            ))}

            {/* [KIND-CORRECTION] The one-way declaration. Without it a net-negative invoice cannot be
                entered at all, and a credit note keeps counting as a debt. */}
            {correctFor.invoice_type !== 'creditnota' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '14px 0 4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={correctCredit} onChange={e => setCorrectCredit(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: '#0B8043' }} />
                <span style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.45 }}>
                  <strong>Dit is een creditnota</strong> — geld dat jou toekomt. Vink dit aan als er
                  “Creditnota” op staat of als het totaal onderaan negatief is. Dan gaat hij van je
                  openstaande saldo af en wordt zijn btw afgetrokken in plaats van opgeteld.
                </span>
              </label>
            )}

            <p style={{ fontSize: 12, color: '#5F6368', lineHeight: 1.45, margin: '12px 0 16px' }}>
              Staat er statiegeld, emballage of een retour op de factuur? Dat hoort in het bedrag
              exclusief mee te tellen, mét zijn teken.
            </p>

            <button
              onClick={saveCorrection}
              disabled={correctSaving}
              style={{ width: '100%', padding: '15px', borderRadius: 14, background: correctSaving ? '#9AA0A6' : M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: correctSaving ? 'default' : 'pointer', marginBottom: 8 }}
            >
              {correctSaving ? 'Opslaan…' : 'Bedragen opslaan'}
            </button>
            <button
              onClick={() => setCorrectFor(null)}
              disabled={correctSaving}
              style={{ width: '100%', padding: '13px', borderRadius: 14, background: M3.surfaceVariant, color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      <style>{`
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
  // [PAY-NO-TOTAL] An invoice whose total is 0 or missing (an OCR read that found no amount) has
  // nothing to settle: interpretAmountEntry returns valid:false with error:null, so BOTH pay
  // buttons went grey while the hint cheerfully read "Leeg laten = alles betaald (€ 0,00)" and
  // nothing said why. The database agrees with the refusal — apply_manual_payment raises
  // 'invoice has no total to settle' — but that English sentence was the owner's only clue, and
  // only if they found a way past the disabled buttons. Say it here instead, in Dutch, with the
  // way out: fix the amount on the invoice first.
  const noOpenBalance = openBalance != null && openBalance <= 0
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
            {/* [PAY-DATE-SANE] min AND max. `max` alone was doing less than it looked like: it
                marks the field :invalid and nothing here reads validity — the pay buttons read the
                state directly — and a typed-in year passes through untouched. There was no floor
                at all, so "1926" was as acceptable as today. These two bound the PICKER (the
                common case: a thumb on a phone); the refusal that actually protects the books is
                the server's, in /api/invoice/pay-toggle, because a client answer is not a
                permission. */}
            <input
              type="date"
              value={paymentDate}
              min={PAYMENT_DATE_FLOOR}
              max={amsterdamToday()}
              onChange={e => setPaymentDate(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #DADCE0', fontSize: 15, marginBottom: 16, fontFamily: FONT, color: '#202124', background: '#fff', boxSizing: 'border-box' }}
            />
            {/* [MANUAL-PARTIAL-PAY] Betaald bedrag — optional. Empty pays the whole open
                balance (unchanged behaviour); a number records an instalment and leaves the
                invoice on "Te betalen" for the rest, with the pay-QR asking only that rest. */}
            {noOpenBalance && (
              <div style={{ background: '#FCE8E6', borderRadius: 12, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.error, flexShrink: 0, marginTop: 1 }}>error</span>
                <p style={{ fontSize: 12.5, color: '#B3261E', lineHeight: 1.5, margin: 0 }}>
                  Op deze factuur staat geen bedrag, dus er valt niets af te boeken. Vul eerst het
                  factuurbedrag in — dan kun je hem als betaald markeren.
                </p>
              </div>
            )}
            {entry && openBalance != null && !noOpenBalance && (
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
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: (!entry || entry.valid) ? confirmBg : M3.surfaceVariant, color: (!entry || entry.valid) ? '#fff' : '#70757a', fontSize: 15, fontWeight: 600, border: 'none', cursor: (!entry || entry.valid) ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
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
                style={{ flex: 1, padding: '14px', borderRadius: R.full, background: canPayCash ? confirmBg : M3.surfaceVariant, color: canPayCash ? '#fff' : '#70757a', fontSize: 15, fontWeight: 600, border: 'none', cursor: canPayCash ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
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
            {/* [REMOVAL-ALTERNATIVE] The way FORWARD when the answer is no. This slot existed only
                in the paymentChoice branch above, so the REMOVE sheet — the one place that
                routinely says no — rendered "Sluiten" and "Annuleren" and nothing else. An owner
                told "draai eerst de betaling terug" had no button that does it, on a screen with
                no other route to a partly-paid invoice's payment. A dead end with the exit
                written on the wall. */}
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                style={{ width: '100%', padding: '13px', borderRadius: R.full, background: '#fff', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: '1px solid #DADCE0', cursor: 'pointer', fontFamily: FONT, marginBottom: 10 }}
              >
                {secondaryAction.label}
              </button>
            )}
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
  // [RECON-MAP-HONEST] The map pass builds the post-run state (which invoices are now in the
  // statement, how many transactions are still open). When it throws, the route still answers
  // 200 with byInvoice {} and pendingTransactions 0 — which reads here as "Geen open
  // banktransacties om tegen te matchen", a sentence that is simply false. Named like every
  // other pass, so a partial run can never read as a clean one.
  const mapFailed  = failed.includes('map')
  const changedNothing = bookedCount === 0 && cashTouched === 0 && categorized === 0
  const nFact = (n: number) => (n === 1 ? '1 factuur' : `${n} facturen`)

  const title = bookedCount > 0
    ? `${nFact(bookedCount)} gekoppeld`
    : changedNothing
      // [RECON-MAP-HONEST] "Niets om te matchen" is a claim about the data; with a failed map
      // pass we do not have the data to make it.
      ? (mapFailed ? 'Deels bijgewerkt' : pendingTransactions === 0 ? 'Niets om te matchen' : 'Niets nieuws gevonden')
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
            tone={bankFailed || mapFailed ? 'error' : bookedCount > 0 ? 'good' : 'neutral'}
            text={
              bankFailed
                ? 'Het bankafschrift kon niet worden gematcht — probeer het straks opnieuw.'
                : bookedCount > 0
                  ? `${nFact(bookedCount)} herkend in je bankafschrift en op betaald gezet.`
                  : mapFailed
                    ? 'De stand kon niet worden opgehaald — we weten niet of er nog open banktransacties zijn.'
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
          {/* [RECON-MAP-HONEST] Not when the map pass failed: pendingTransactions is 0 there
              because nothing could be counted, not because there is nothing to count — and
              "upload een bankafschrift" to someone who just uploaded one is worse than silence. */}
          {pendingTransactions === 0 && bookedCount === 0 && !bankFailed && !mapFailed && (
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

// ─── [NO-SILENT-EMPTY] The other empty screen — the honest one ────────────────
// "Leeg" and "we konden niet kijken" look identical and mean opposite things. EmptyState above is
// a fact about the owner's books; this is a fact about our read. Kept deliberately close to it in
// shape so nothing feels broken, and deliberately different in wording so nothing feels settled.
function LoadFailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: R.lg, boxShadow: EL1, marginTop: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: M3.error, display: 'block', marginBottom: 12 }}>error</span>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 4, fontFamily: FONT }}>We konden je inkoopfacturen niet ophalen</p>
      <p style={{ fontSize: 14, color: '#5F6368', fontFamily: FONT, lineHeight: 1.5, maxWidth: 380, margin: '0 auto' }}>
        Dit betekent niet dat je niets openstaan hebt — we konden het alleen niet lezen.
        Probeer het zo meteen opnieuw.
      </p>
      <button
        onClick={onRetry}
        style={{ marginTop: 16, padding: '10px 20px', borderRadius: R.full, border: 'none', background: M3.primary, color: M3.onPrimary, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
      >
        Opnieuw proberen
      </button>
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