'use client'

// src/app/dashboard/bank/BankClient.tsx
// [BOEK-016] Bank reconciliation UI — Material You (BoekBrug Design System v1.0), mobile-first.
// Flow: upload bankafschrift → /api/bank/upload → /api/bank/match → review suggestions → confirm.
// Philosophy: AI suggests, the human confirms. 'auto' = pre-filled (still one tap to confirm).

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { reconcileBatch, countResolvedReferences } from '@/lib/bank-batch-reconcile'
import { parsePaymentPeriod } from '@/lib/payment-period'
import { quartersPresent, quarterLabelOf, matchesQuarter, lastCompletedQuarter } from '@/lib/quarter'
import { isPartialPaymentHint } from '@/lib/bank-matching'

// ─── Design tokens — mirrors BoekBrug Design System v1.0 (FacturenClient) ────
const M3 = {
  primary: '#1A73E8',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3E3FD',
  onPrimaryContainer: '#041E49',
  surface: '#ffffff',
  onSurface: '#202124',
  surfaceVariant: '#f1f3f4',
  outline: '#80868b',
  error: '#B3261E',
  errorContainer: '#F9DEDC',
  success: '#137333',
  successContainer: '#CEEAD6',
  warning: '#E37400',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const R = { sm: 8, md: 12, lg: 16, full: 9999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// [BANK-FORMAT-GUARD] File extensions we can actually parse into transactions.
// MT940 (.940/.sta/.mt940/.txt) and CAMT.053 (.xml). A CSV or PDF is NOT readable
// into bank_transactions — it can still be kept for the accountant, but the owner
// must be told the transactions weren't imported (clear modal, not a quick toast).
const READABLE_BANK_EXTS = ['.xml', '.940', '.sta', '.mt940', '.txt']
function isReadableBankFile(name: string): boolean {
  const lower = name.toLowerCase()
  return READABLE_BANK_EXTS.some((ext) => lower.endsWith(ext))
}

// [BANK-STATEMENTS] Format an upload timestamp for the statements table.
function fmtUploadDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

// [BANK-DETAILS] Tidy the raw bank description for display: drop the "USTD//"
// remittance marker and the field-separator slashes ING leaves in, so the full
// text reads cleanly ("Lidl 213 Tilburg TILBURG NLD Pasvolgnr: 900 ...").
function cleanBankDescription(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/\/*USTD\/*/gi, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Types (mirror the /api/bank/match DTO) ──────────────────────────────────
type Outcome = 'auto' | 'choice' | 'none'
interface Candidate {
  invoiceId: string
  invoiceNumber: string | null
  amount: number | null // [BANK-BATCH-RECONCILE] invoice gross total, to sum-check a batch
  invoiceDate: string | null // [BANK-CHOICE-CLARITY] tells same-amount candidates apart
  confidence: number
  signals: string[]
  reason: string
  // [PARTIAL-PAY] Already settled by earlier instalments, and what is therefore still open.
  // The confirm warning compares the payment against `remaining`, not the full total.
  // Absent on candidates the batch-reconcile path builds → callers fall back to `amount`.
  amountPaid?: number
  remaining?: number
}
interface Suggestion {
  transactionId: string
  date: string
  amount: number
  description: string
  counterpart: string | null
  reference: string | null
  outcome: Outcome
  best: Candidate | null
  candidates: Candidate[]
  // [BANK-MULTI-LINK-PERSIST] Reload-safe link state from the match route.
  // partiallyLinked: this pending tx already has an invoice paid against it.
  // allCovered: every reference number is now paid (→ it's effectively done).
  partiallyLinked?: boolean
  allCovered?: boolean
  // [BANK-SLOT-PERSIST] Server-computed reference numbers already paid against this tx,
  // so a paid slot shows "Betaald" after a reload (session confirm state is gone).
  coveredNumbers?: string[]
  // [BANK-PAID-EXPLAINED] This debit matches an already-PAID invoice → not a missing inkoopfactuur.
  explainedByPaid?: boolean
  // [BANK-AMOUNT-ONLY] 'amount_only' when this line was auto-booked on amount+counterpart only
  // (no printed number/IBAN) → the Gekoppeld card shows a "controleer" flag. null otherwise.
  matchReason?: string | null
}
interface MatchResponse {
  ok: boolean
  summary: { pending: number; auto: number; choice: number; none: number }
  suggestions: Suggestion[]
}

export default function BankClient() {
  const [busy, setBusy] = useState(false)
  // [BANK-DND] true while a file is being dragged over the upload zone.
  const [dragActive, setDragActive] = useState(false)
  const [uploadInfo, setUploadInfo] = useState<{ format: string; parsed: number; inserted: number; skipped: number; unreadable: number; autoBooked?: number; balanceWarning?: string | null } | null>(null)
  // [BANK-STATEMENTS] Uploaded statements (filename + upload time) and the
  // "refresh names" action that upgrades older rows' names from their description.
  const [statements, setStatements] = useState<{ id: string; name: string; uploadedAt: string; size: number }[] | null>(null)
  const [refreshingNames, setRefreshingNames] = useState(false)
  // [BANK-STATEMENT-DELETE] The statement pending deletion (shown in a confirm
  // dialog) and the id currently being deleted (to disable its row button).
  const [statementToDelete, setStatementToDelete] = useState<{ id: string; name: string } | null>(null)
  const [deletingStatementId, setDeletingStatementId] = useState<string | null>(null)
  // [BANK-FORMAT-GUARD] When the owner picks a file we can't read into transactions
  // (CSV, PDF, or any non-MT940/CAMT file), we show a clear modal — not a quick
  // toast — explaining what happened and which formats to use. `kept` distinguishes
  // the two cases: rejected before upload (kept=false) vs stored for the accountant
  // but unreadable as transactions (kept=true).
  const [formatNotice, setFormatNotice] = useState<{ name: string; kept: boolean } | null>(null)
  const [data, setData] = useState<MatchResponse | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({}) // txId → invoiceId
  // [BANK-MULTI-CONFIRM] One transaction can cover several invoices, so we track
  // ALL invoice numbers confirmed this session per transaction, plus whether the
  // backend reported every reference number as covered (allCovered). The tx only
  // counts as "done" (→ Gekoppeld, leaves Te bevestigen) once allCovered is true.
  const [confirmed, setConfirmed] = useState<Record<string, { numbers: string[]; allCovered: boolean }>>({}) // txId → confirmation state
  // [P1-UNCATEGORIZED] Count of bank lines with NO category (not tied to an invoice). Money on
  // these lines is silently absent from the W&V/BTW until categorized — surface it, never hide it.
  const [uncatCount, setUncatCount] = useState(0)
  const [processingId, setProcessingId] = useState<string | null>(null)
  // [BANK-BATCH-CONFIRM] Bulk-confirm only for strong 'auto' single-invoice matches
  // (each already carries an unambiguous best candidate from the bank statement).
  // 'choice' needs a human pick, multi-invoice needs per-number action — both stay
  // single-confirm. selectedForBatch holds the txIds the owner ticked.
  const [selectedForBatch, setSelectedForBatch] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  // [BANK-AUTO-CONFIRM] "Quiet by default": the app books the near-certain matches itself.
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoDoneCount, setAutoDoneCount] = useState<number | null>(null)
  // [BANK-AUTO-RUN] Guard so the app auto-handles the near-certain payments ONCE per page
  // load, the moment they appear — the owner should never have to press a button for a
  // payment the app is already certain of. Set before the async call so a re-render mid-flight
  // (runMatch updates `data`) can't fire a second pass.
  const autoRanRef = useRef(false)
  // [BANK-FILTER] Free-text filter for the "Geen factuur" list. With 170+ rows,
  // typing part of a name ("Lidl", "ASM") is faster than scrolling or a long
  // dropdown of every counterpart. Matches counterpart name, reference, or date.
  const [filterText, setFilterText] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [verwerktCtx, setVerwerktCtx] = useState<{ number: string } | null>(null)
  // [BANK-PERSIST] On mount, load any already-stored pending transactions so a
  // page refresh doesn't show an empty page. The transactions live in the DB
  // (bank_transactions, status 'pending'); /api/bank/match reads them and
  // returns fresh suggestions. Without this, suggestions only ever existed in
  // component state and vanished on reload.
  const [initialLoading, setInitialLoading] = useState(true)
  // [BANK-TABS] Active tab — defaults to the one the owner acts on.
  const [bankTab, setBankTab] = useState<'confirm' | 'none' | 'pin' | 'ignored' | 'done'>('confirm')
  // [BANK-QUARTER] Which quarter's transactions to show. 'auto' resolves to the newest
  // quarter that has data, so an owner working on Q2 lands on Q2 instead of an all-quarters
  // pile (old Q1 uploads inflated "Geen factuur" to 335). 'all' shows every quarter.
  const [quarterSel, setQuarterSel] = useState<string>('auto')
  // [BANK-IGNORE] Ignored transactions (status 'not_found'), loaded lazily when
  // the owner opens the "Genegeerd" tab.
  const [ignoredList, setIgnoredList] = useState<Suggestion[] | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  // Shared matcher call — used by both the initial load and after an upload.
  const runMatch = useCallback(async () => {
    const mr = await fetch('/api/bank/match')
    const mrJson: MatchResponse = await mr.json()
    if (!mr.ok) {
      showToast('Matchen mislukt.')
      return
    }
    setData(mrJson)
    // Pre-fill 'auto' selections with their best candidate.
    const pre: Record<string, string> = {}
    for (const s of mrJson.suggestions) {
      if (s.outcome === 'auto' && s.best) pre[s.transactionId] = s.best.invoiceId
    }
    setSelected(pre)
  }, [])

  // [BANK-UNLINK] Undo a confirmed match — makes auto-confirm safe (every booking reversible).
  const unlink = useCallback(async (txId: string) => {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/unlink', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) { await runMatch(); showToast('Koppeling ongedaan gemaakt.') }
      else if (json.error === 'verwerkt') showToast('De boekhouder heeft deze factuur al verwerkt — vraag eerst om dat ongedaan te maken.')
      else if (json.error === 'multi_invoice_unlink_unsupported') showToast('Ontkoppelen van een groepsbetaling kan hier nog niet.')
      else showToast('Ontkoppelen mislukt.')
    } catch { showToast('Ontkoppelen mislukt.') }
    finally { setProcessingId(null) }
  }, [runMatch])

  // [BANK-AUTO-CONFIRM] Let the app handle the near-certain payments (reference number +
  // exact amount, single invoice) so the owner only deals with what's genuinely ambiguous.
  // The server decides the safe set (isSafeAutoConfirm); we just refresh afterwards.
  const autoConfirm = useCallback(async () => {
    setAutoRunning(true)
    try {
      const res = await fetch('/api/bank/auto-confirm', { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        setAutoDoneCount(json.count ?? 0)
        await runMatch() // the handled ones leave "Te bevestigen"
      } else {
        showToast('Automatisch afhandelen mislukt.')
      }
    } catch {
      showToast('Automatisch afhandelen mislukt.')
    } finally {
      setAutoRunning(false)
    }
  }, [runMatch])

  // [BANK-AUTO-RUN] The circle should run itself: when the matches load and the app finds
  // near-certain payments (invoice number printed in the statement + exact amount, single
  // invoice, no instalment hint), it books them WITHOUT waiting for a tap. This is the
  // difference between the owner chasing the app and the app working in the background.
  // The server (isSafeAutoConfirm) is authoritative and only ever touches that safe set;
  // this effect just decides "are there any, and have I not run yet this load". autoRanRef
  // makes it once-per-mount so the runMatch refresh inside autoConfirm can't loop it.
  useEffect(() => {
    if (autoRanRef.current) return
    if (autoRunning) return
    if (!data) return
    // [BANK-IBAN] Mirror the server's isSafeAutoConfirm EXACTLY: the safe set is
    // (reference + amount) OR (iban + amount). The old gate only checked reference+amount,
    // so an invoice matched purely by supplier IBAN + exact sum (e.g. the HVO invoices, which
    // carry no printed invoice number in the payment) never tripped the on-load auto-run —
    // it sat unlinked until the daily cron. The server stays authoritative; this only decides
    // "are there any safe matches worth calling autoConfirm for right now".
    const hasSafe = (data.suggestions ?? []).some((s) => {
      if (s.outcome !== 'auto' || !s.best) return false
      const sig = s.best.signals
      // Mirror the server's autoConfirmTier: 'certain' (reference/iban + amount) OR 'amount_only'
      // (amount + counterpart name, no reference/iban). Both are single-invoice, non-instalment and
      // auto-booked on load; the server stays authoritative on WHAT it books and the tier flag.
      const certain = (sig.includes('reference') || sig.includes('iban')) && sig.includes('amount')
      const amountOnly = sig.includes('amount') && sig.includes('counterpart') && !sig.includes('reference') && !sig.includes('iban')
      if (!certain && !amountOnly) return false
      // single reference only (a multi-invoice batch is the engine's separate path), not an instalment
      if (s.reference && s.reference.split(',').map((x) => x.trim()).filter(Boolean).length > 1) return false
      if (isPartialPaymentHint(`${s.reference ?? ''} ${s.description ?? ''}`)) return false
      return true
    })
    // [BANK-BATCH-ONLOAD] Also fire the pass when an unresolved MULTI-invoice batch exists (a
    // wholesaler debiting a week of deliveries into one payment, e.g. "sumer food … 2 facturen").
    // The single-match gate above deliberately skips these (>1 reference), so a statement whose
    // ONLY auto-bookable payments were exact batches never auto-confirmed on page-open — it waited
    // for the daily cron. runBankAutoConfirm already runs the batch pass; the server's
    // planBatchAutoConfirm stays authoritative (books ONLY provably-exact ties: every number →
    // exactly one unpaid invoice, one supplier, sum to the cent). This just decides "is it worth
    // calling now". A non-tie / incomplete batch simply books nothing — the call is idempotent.
    const hasBatch = (data.suggestions ?? []).some((s) => {
      const refCount = (s.reference ?? '').split(',').map((x) => x.trim()).filter(Boolean).length
      if (refCount < 2) return false
      if (s.allCovered === true || confirmed[s.transactionId]?.allCovered === true) return false
      return true
    })
    if (!hasSafe && !hasBatch) return
    autoRanRef.current = true
    void autoConfirm()
  }, [data, autoRunning, autoConfirm])

  // [BANK-PERSIST] Initial load — show stored pending transactions on refresh.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mr = await fetch('/api/bank/match')
        const mrJson: MatchResponse = await mr.json()
        if (cancelled) return
        if (mr.ok) {
          setData(mrJson)
          const pre: Record<string, string> = {}
          for (const s of mrJson.suggestions) {
            if (s.outcome === 'auto' && s.best) pre[s.transactionId] = s.best.invoiceId
          }
          setSelected(pre)
        }
        // [BANK-IGNORE] Also load ignored up front so the Genegeerd tab (and the
        // tab bar) appears even when every transaction has been ignored.
        const ig = await fetch('/api/bank/ignored')
        const igJson = await ig.json()
        if (!cancelled && ig.ok) setIgnoredList(igJson.suggestions ?? [])
        // [P1-UNCATEGORIZED] The exact head-count of still-uncategorized bank lines.
        const cat = await fetch('/api/bank/categorize')
        const catJson = await cat.json().catch(() => ({}))
        if (!cancelled && cat.ok) setUncatCount(Number(catJson.total_remaining ?? 0) || 0)
      } catch {
        /* silent — empty state shows the upload card */
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Upload → match ──────────────────────────────────────────────────────────
  // [BANK-DND] handleFile is the <input onChange> wrapper; the real work lives in
  // processFile(file) so the drag-and-drop path can reuse the exact same logic
  // (upload → match → refresh) without duplication.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    await processFile(file)
  }

  async function processFile(file: File) {
    if (busy) return // ignore a second file while one is uploading

    setBusy(true)
    setUploadInfo(null)
    setData(null)
    setConfirmed({})
    setSelected({})

    try {
      const form = new FormData()
      form.append('file', file)
      const up = await fetch('/api/bank/upload', { method: 'POST', body: form })
      const upJson = await up.json()
      if (!up.ok) {
        showToast(upJson?.error === 'no_transactions' ? 'Geen transacties gevonden in dit bestand.' : 'Uploaden mislukt.')
        setBusy(false)
        return
      }
      // [R2] parseWarnings = statement lines the parser could not read. Each one is a
      // transaction that is NOT in the overview (the raw file still reaches the accountant).
      // The UI dropped this field, so the owner was never told a line went missing.
      setUploadInfo({ format: upJson.format, parsed: upJson.parsed, inserted: upJson.inserted, skipped: upJson.skipped, unreadable: Array.isArray(upJson.parseWarnings) ? upJson.parseWarnings.length : 0, autoBooked: upJson.autoBooked ?? 0, balanceWarning: upJson.balanceWarning ?? null })
      // [BANK-BALANCE §2.6] A statement that doesn't tie out to its own begin/eindsaldo is INCOMPLETE
      // — a bank line is missing/dropped. This is a money-truth gap; make it loud (toast now, banner
      // below), never buried, so the owner re-uploads the full afschrift before trusting the figures.
      if (upJson.balanceWarning) showToast('⚠️ Bankafschrift sluit niet aan — mogelijk ontbreekt een transactie. Zie de melding.')
      // [BANK-AUTO-FEEDBACK] Tell the owner right away when the import already booked payments for
      // them — the money moved silently on the server; a toast makes the automatic work visible.
      if ((upJson.autoBooked ?? 0) > 0) {
        showToast(`${upJson.autoBooked} ${upJson.autoBooked === 1 ? 'factuur' : 'facturen'} automatisch gekoppeld ✓ — zie "Bevestigd"`)
      }

      // [BANK-FORMAT-GUARD] The file is always stored for the accountant (the
      // server keeps a passthrough copy regardless of format). But a CSV/PDF — or
      // any file that yielded no transactions — could NOT be read into the bank
      // overview. Tell the owner clearly with a modal so they don't assume their
      // transactions were imported, and point them to the readable formats. We
      // still refresh the statements table below so the stored file appears.
      const unreadable = !isReadableBankFile(file.name) || (upJson.parsed ?? 0) === 0
      if (unreadable) {
        setFormatNotice({ name: file.name, kept: true })
      }

      // [BANK-AUTO-RUN] Claim the once-per-load guard BEFORE the awaits below. runMatch()
      // populates `data`, and React can commit that render during the very next await — if the
      // guard were still false the load effect would fire its own autoConfirm() there, then we
      // would fire a second one, racing two passes. Setting it first makes the load effect
      // short-circuit so this upload owns exactly one pass.
      autoRanRef.current = true
      // Run matching (shared with initial load) — always, so `data` is populated even if
      // the auto-confirm pass below finds nothing or fails (the screen must never stay empty).
      await runMatch()
      // [BANK-STATEMENT-DELETE] Refresh the uploaded-statements table so the file
      // just uploaded appears immediately — without it the table only updated on a
      // full page reload (it's populated by loadStatements on mount).
      await loadStatements()
      // Book the near-certain payments from the statement we just uploaded, right now — the
      // owner shouldn't have to reload for the app to handle the sure ones. The server books
      // only the safe set (isSafeAutoConfirm); an empty or failed pass leaves the list as-is.
      await autoConfirm()
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setBusy(false)
    }
  }

  // [BANK-DND] Drag-and-drop onto the upload zone. preventDefault on dragOver is
  // required for the browser to fire a drop; without it the file just opens in a
  // new tab. We take the first dropped file and run the same processFile path.
  function onDropZone(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }
  function onDragOverZone(e: React.DragEvent) {
    e.preventDefault()
    if (!busy && !dragActive) setDragActive(true)
  }
  function onDragLeaveZone(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
  }

  // ── Confirm one match ─────────────────────────────────────────────────────────
  // [BANK-MULTI-CONFIRM] A transaction may list several invoice numbers. Confirming
  // one pays + links it, but the transaction only leaves "Te bevestigen" when the
  // backend reports allCovered (every reference number now has a paid invoice). We
  // append the confirmed number to this tx's list and carry allCovered through.
  // `explicitInvoiceId` lets the multi-invoice rows pass the invoice id directly,
  // avoiding the setSelected→confirm race (state updates are async; reading
  // selected[txId] right after onSelect would see the stale value).
  async function confirm(txId: string, invoiceNumber: string | null, explicitInvoiceId?: string) {
    const invoiceId = explicitInvoiceId ?? selected[txId]
    if (!invoiceId) return
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, invoiceId }),
      })
      const json = await res.json()
      if (res.ok) {
        const allCovered = json?.allCovered !== false // default true (single-invoice case)
        setConfirmed((c) => {
          const prev = c[txId]?.numbers ?? []
          const num = invoiceNumber ?? ''
          const numbers = num && !prev.includes(num) ? [...prev, num] : prev
          return { ...c, [txId]: { numbers, allCovered } }
        })
        // Clear the selection so a multi-invoice tx doesn't keep the just-paid
        // invoice pre-selected for the next open number.
        setSelected((sel) => {
          const next = { ...sel }
          delete next[txId]
          return next
        })
        // [PARTIAL-PAY] /api/bank/confirm returns {partial, applied, remaining} when the payment
        // only settled PART of the invoice. Reporting "gemarkeerd als betaald ✓" then is simply
        // untrue — the invoice is still open for the rest. Say what actually happened.
        const isPartial = json?.partial === true
        const remainingOpen = typeof json?.remaining === 'number' ? json.remaining : null
        showToast(
          json?.warning === 'transaction_link_failed'
            ? 'Factuur betaald (koppeling volgt later).'
            : isPartial
              ? (remainingOpen != null
                  ? `Deelbetaling geboekt · nog ${eur.format(remainingOpen)} open`
                  : 'Deelbetaling geboekt · factuur blijft openstaan')
              : allCovered
                ? 'Bevestigd en gemarkeerd als betaald ✓'
                : 'Factuur betaald ✓ · nog een factuur open'
        )
        // [BANK-MULTI-CONFIRM] Re-run matching so the just-paid invoice drops out of
        // the candidate list and any remaining open number is re-evaluated. Without
        // this the paid invoice would linger as a still-selectable candidate.
        // [PARTIAL-PAY] Also after a DEELBETALING: the invoice stays in the pool but its
        // remaining balance just shrank, and scorePair targets that remaining. Without a
        // re-match, another pending line for the same invoice would still be scored (and
        // warned about) against the old, larger balance.
        if (!allCovered || isPartial) await runMatch()
      } else if (json?.error === 'verwerkt') {
        setVerwerktCtx({ number: json.invoiceNumber ?? invoiceNumber ?? '' })
      } else if (res.status === 409 && (json?.error === 'invoice_already_paid' || json?.error === 'transaction_already_processed')) {
        // [BANK-409-BENIGN] Already booked — the auto-confirm on page-open (or another tab) got
        // there first. That IS the desired outcome, so mark it done + refresh so it leaves the
        // list, never a red "mislukt". The money is correct and reversible under Bevestigd.
        setConfirmed((c) => ({ ...c, [txId]: { numbers: invoiceNumber ? [invoiceNumber] : [], allCovered: true } }))
        showToast('Al bevestigd ✓')
        await runMatch()
      } else {
        showToast('Bevestigen mislukt.')
      }
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-BATCH-CONFIRM] A transaction is batch-eligible only when it is a strong,
  // single-invoice 'auto' match that already has a best candidate pre-selected and
  // is not partially linked / not multi-number. These are the ones the owner can
  // safely tick and confirm together; everything else keeps its single-confirm flow.
  function isBatchEligible(s: Suggestion): boolean {
    if (s.outcome !== 'auto' || !s.best) return false
    if (isPartiallyLinked(s)) return false
    // Multi-invoice (reference lists >1 number) → per-number action, never bulk.
    // Count the same way the card does (comma-separated, trimmed, non-empty).
    const refCount = (s.reference ?? '').split(',').map((r) => r.trim()).filter(Boolean).length
    if (refCount > 1) return false
    if (confirmed[s.transactionId]) return false // already acted on this session
    return true
  }

  // [BANK-BATCH-CONFIRM] Confirm every ticked transaction, sequentially, reusing the
  // SAME /api/bank/confirm endpoint (no batch endpoint, no backend change). Sequential
  // (not Promise.all) keeps each payment's session-client auth + B.4 guard intact and
  // makes partial failure easy to report. We do NOT call confirm() in the loop (it would
  // run runMatch after each one and mutate the list mid-iteration); instead we POST
  // directly, collect results, then refresh ONCE at the end.
  async function confirmBatch() {
    const targets = toConfirm.filter(
      (s) => selectedForBatch.has(s.transactionId) && isBatchEligible(s)
    )
    if (targets.length === 0) return
    setBatchRunning(true)
    let ok = 0
    let failed = 0
    try {
      for (const s of targets) {
        const invoiceId = selected[s.transactionId] ?? s.best?.invoiceId
        if (!invoiceId) {
          failed++
          continue
        }
        setProcessingId(s.transactionId)
        try {
          const res = await fetch('/api/bank/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId: s.transactionId, invoiceId }),
          })
          const json = await res.json()
          // [BANK-BATCH-409] A 409 "already processed / already paid" is NOT a failure — it means
          // this payment is ALREADY booked (the auto-confirm on page-open, or a concurrent tab, got
          // there first). That is exactly what the owner wanted, so treat it as done and let it drop
          // out of the list. Only a REAL block (accountant 'verwerkt', not_eligible) counts as failed.
          const alreadyDone = res.status === 409 && (json?.error === 'transaction_already_processed' || json?.error === 'invoice_already_paid')
          if (res.ok || alreadyDone) {
            ok++
            const num = s.best?.invoiceNumber ?? ''
            const allCovered = json?.allCovered !== false
            setConfirmed((c) => ({ ...c, [s.transactionId]: { numbers: num ? [num] : [], allCovered } }))
          } else {
            failed++
          }
        } catch {
          failed++
        }
      }
    } finally {
      setProcessingId(null)
      setSelectedForBatch(new Set())
      setBatchRunning(false)
      // Refresh once: just-paid invoices drop out of candidates, lists re-derive.
      await runMatch()
      showToast(
        failed === 0
          ? `${ok} factuur/facturen bevestigd ✓`
          : `${ok} bevestigd · ${failed} mislukt`
      )
    }
  }
  // transaction → backend creates a paid incoming invoice from it and links it.
  // [BANK-STATEMENTS] Load the uploaded statements list.
  const loadStatements = useCallback(async () => {
    try {
      const res = await fetch('/api/bank/statements')
      const json = await res.json()
      if (res.ok && json?.ok) setStatements(json.statements)
    } catch {
      /* silent — the table just stays hidden */
    }
  }, [])

  useEffect(() => { loadStatements() }, [loadStatements])

  // [BANK-REDERIVE] Upgrade older rows whose name is still "Onbekende" by
  // re-deriving from their stored description. Refreshes the list afterwards.
  async function refreshNames() {
    setRefreshingNames(true)
    try {
      const res = await fetch('/api/bank/refresh-names', { method: 'POST' })
      const json = await res.json()
      if (res.ok && json?.ok) {
        showToast(
          json.updated > 0
            ? `${json.updated} ${json.updated === 1 ? 'naam' : 'namen'} bijgewerkt ✓`
            : 'Alle namen waren al up-to-date.'
        )
        await runMatch()
      } else {
        showToast('Bijwerken mislukt.')
      }
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setRefreshingNames(false)
    }
  }

  // [BANK-STATEMENT-DELETE] Delete a bank statement file the owner uploaded by
  // mistake (wrong file, or a period that overlaps an existing statement). This
  // removes the documents row + the Storage file (server-side); bank_transactions
  // are NEVER touched, so every linked invoice / confirmed payment / ignore is
  // preserved. The statement disappears from the next closing-package ZIP because
  // the package is built fresh from the documents query. Confirmation is required
  // (the delete is permanent) — this runs only after the dialog is confirmed.
  async function deleteStatement(documentId: string) {
    setDeletingStatementId(documentId)
    try {
      const res = await fetch('/api/bank/delete-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        // Drop the row from the list immediately.
        setStatements((prev) => (prev ? prev.filter((st) => st.id !== documentId) : prev))
        showToast('Bankafschrift verwijderd ✓')
      } else {
        showToast(json?.error || 'Verwijderen mislukt.')
      }
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setDeletingStatementId(null)
      setStatementToDelete(null)
    }
  }


  // [BANK-INVOICE-FILE] Open the actual PDF of a matched invoice in a new tab so
  // the owner can check it before confirming the payment. Fetches a short-lived
  // signed URL; opens the tab synchronously first (so the browser doesn't block
  // the popup) and points it at the URL once it arrives.
  async function openInvoiceFile(invoiceId: string) {
    const tab = window.open('', '_blank')
    try {
      const res = await fetch(`/api/bank/invoice-file?invoiceId=${encodeURIComponent(invoiceId)}`)
      const json = await res.json()
      if (res.ok && json?.url) {
        if (tab) tab.location.href = json.url
        else window.open(json.url, '_blank')
      } else {
        if (tab) tab.close()
        showToast(json?.detail || json?.error === 'no_file' ? 'Deze factuur heeft geen bestand.' : 'Kon de factuur niet openen.')
      }
    } catch {
      if (tab) tab.close()
      showToast('Kon de factuur niet openen.')
    }
  }

  async function attachFile(txId: string, files: File[], isCredit: boolean) {
    setProcessingId(txId)
    try {
      let ok = 0
      let lastMsg = ''
      // Upload each file → each becomes one paid invoice linked to this tx. The
      // backend only marks the transaction 'matched' once the linked invoices'
      // total covers the transaction amount (fixes the multi-invoice disappear
      // bug: confirming one of three must not hide the rest).
      for (const file of files) {
        const postAttach = async (force: boolean) => {
          const form = new FormData()
          form.append('file', file)
          form.append('transactionId', txId)
          form.append('direction', isCredit ? 'outgoing' : 'incoming')
          if (force) form.append('force', 'true')
          const r = await fetch('/api/bank/attach-invoice', { method: 'POST', body: form })
          return { r, j: await r.json() }
        }
        let { r: res, j: json } = await postAttach(false)
        // [DEDUP-SOFT] A possible-duplicate is UNCERTAIN — surface it as a decision, never a silent
        // block or a silent double-book. The owner confirms it is a different bill → re-send with force.
        if (res.status === 409 && json?.duplicate && json?.canForce) {
          const proceed = window.confirm(`${json?.detail || json?.error || 'Mogelijk dubbel.'}\n\nToch koppelen?`)
          if (!proceed) { lastMsg = 'Overgeslagen (mogelijk dubbel).'; continue }
          ;({ r: res, j: json } = await postAttach(true))
        }
        if (res.ok) {
          ok++
          if (json?.amountWarning) lastMsg = 'Let op: controleer het bedrag.'
        } else {
          lastMsg = json?.error || 'Koppelen mislukt.'
        }
      }
      if (ok > 0) {
        showToast(
          ok === files.length
            ? `${ok === 1 ? 'Factuur' : `${ok} facturen`} gekoppeld ✓${lastMsg ? ` ${lastMsg}` : ''}`
            : `${ok}/${files.length} gekoppeld. ${lastMsg}`
        )
      } else {
        showToast(lastMsg || 'Koppelen mislukt.')
      }
      await runMatch() // refresh: tx leaves "Geen factuur" only if fully accounted
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-IGNORE] Fetch the ignored (not_found) transactions for the Genegeerd tab.
  const loadIgnored = useCallback(async () => {
    try {
      const res = await fetch('/api/bank/ignored')
      const json = await res.json()
      if (res.ok) setIgnoredList(json.suggestions ?? [])
      else setIgnoredList([])
    } catch {
      setIgnoredList([])
    }
  }, [])

  // [BANK-IGNORE] Ignore a transaction: pending → not_found. It leaves the active
  // list (match only reads pending) and appears under Genegeerd.
  async function ignoreTx(txId: string) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, action: 'ignore' }),
      })
      if (res.ok) {
        showToast('Transactie genegeerd')
        await runMatch()             // drops it from the active list
        await loadIgnored()          // refresh Genegeerd immediately (counter stays correct)
      } else {
        showToast('Negeren mislukt.')
      }
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-IGNORE] Restore: not_found → pending. It returns to the active list.
  async function restoreTx(txId: string) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, action: 'restore' }),
      })
      if (res.ok) {
        showToast('Teruggezet')
        setIgnoredList((prev) => (prev ? prev.filter((s) => s.transactionId !== txId) : prev))
        await runMatch()             // reappears in the active list
      } else {
        showToast('Terugzetten mislukt.')
      }
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-IGNORE] Load ignored list the first time the Genegeerd tab is opened.
  useEffect(() => {
    if (bankTab === 'ignored' && ignoredList === null) {
      loadIgnored()
    }
  }, [bankTab, ignoredList, loadIgnored])

  // [BANK-MULTI-CONFIRM] A transaction stays "pending" in the UI until it is fully
  // covered. Confirming one of several invoices keeps it visible (allCovered=false)
  // with the open numbers still actionable; it only leaves once allCovered=true.
  // [BANK-MULTI-LINK-PERSIST] "Done" is now reload-safe: the match route reports
  // server-side allCovered (survives a reload), and the session `confirmed` state
  // still covers the moment right after a confirm. Either source marking it covered
  // means done.
  const isDone = (s: Suggestion) =>
    s.allCovered === true || confirmed[s.transactionId]?.allCovered === true
  // A partially-linked tx (one invoice paid, others still open) is NOT done — it
  // must stay actionable even when the matcher left it with zero fresh candidates
  // (its only matching invoice is now paid and excluded from candidates).
  const isPartiallyLinked = (s: Suggestion) =>
    !isDone(s) &&
    (s.partiallyLinked === true ||
      (confirmed[s.transactionId] && confirmed[s.transactionId].allCovered === false))
  // [BANK-QUARTER] Quarters present across ALL loaded transactions (pending + done +
  // ignored), newest first, with a per-quarter count for the chip. Filtering is by the BANK
  // date (payment date), so a Q1 invoice paid in Q2 shows under Q2 and the matcher still
  // offers the Q1 invoice — cross-quarter payments land in the quarter the money moved.
  const quarters = quartersPresent([
    ...((data?.suggestions ?? []).map((s) => s.date)),
    ...((ignoredList ?? []).map((s) => s.date)),
  ])
  // [BANK-QUARTER] Default (via 'auto') to the app's shared quarter: the LAST COMPLETED
  // quarter (the one whose BTW is due — what klaar/aangifte/resultaat also default to), so
  // "I'm working on Q2" lands on Q2, not the newest half-open quarter. Fall back to the
  // newest quarter present (or 'all') when the last-completed quarter has no bank data.
  const lc = lastCompletedQuarter()
  const defaultQuarterKey = `${lc.year}-Q${lc.quarter}`
  const autoQuarter = quarters.some((q) => q.key === defaultQuarterKey)
    ? defaultQuarterKey
    : (quarters[0]?.key ?? 'all')
  const effectiveQuarter = quarterSel === 'auto' ? autoQuarter : quarterSel
  const inQ = (s: Suggestion) => matchesQuarter(s.date, effectiveQuarter)

  const pending = (data?.suggestions.filter((s) => !isDone(s)) ?? []).filter(inQ)

  // [BANK-SORT] Stable order by date (newest first) so a restored transaction
  // returns to its logical position instead of jumping to the bottom.
  const byDateDesc = (a: Suggestion, b: Suggestion) =>
    (b.date ?? '').localeCompare(a.date ?? '')

  // [BANK-POS] Card-terminal settlements (ING DD&C / BETAALAUTOMAAT) arrive in
  // bulk every day and never have a supplier invoice. Keeping them in "Geen
  // factuur" buries the real work (actual supplier payments). Detect them and
  // give them their own tab so the owner focuses on invoices that matter.
  const isPosReceipt = (s: Suggestion) => {
    const name = (s.counterpart ?? '').toLowerCase()
    const desc = (s.description ?? '').toLowerCase()
    return (
      name.includes('ing dd&c') ||
      desc.includes('betaalautomaat') ||
      desc.includes('afrek. betaalautomaat')
    )
  }

  // [BANK-TABS] Split the (often long) list into purpose-driven groups so the
  // owner isn't drowned in one endless list. Order: the action tab first.
  //   Te bevestigen : auto + choice (a real candidate exists → owner confirms),
  //                   PLUS partially-linked multi-invoice tx (one paid, others open)
  //                   even if the matcher left them with no fresh candidate — they
  //                   still need the owner to link the remaining numbers.
  //   Geen factuur  : none, EXCLUDING POS receipts AND partially-linked tx
  //   Pin           : POS card settlements (bulk, no invoice — normal)
  //   Genegeerd     : owner-ignored (not_found)
  //   Gekoppeld     : confirmed / fully covered
  const toConfirm = pending
    .filter((s) => s.outcome === 'auto' || s.outcome === 'choice' || isPartiallyLinked(s))
    .sort(byDateDesc)
  const noneAll = pending.filter((s) => s.outcome === 'none' && !isPartiallyLinked(s))
  const noMatch = noneAll.filter((s) => !isPosReceipt(s)).sort(byDateDesc)
  const posList = noneAll.filter(isPosReceipt).sort(byDateDesc)
  // [BANK-SAFETY-NET] A DEBIT (money out, amount < 0) with no matching invoice is a payment for
  // which we hold no purchase invoice — a MISSING INKOOPFACTUUR. It matters for the money: no
  // invoice means the voorbelasting (deductible BTW) on that cost is not claimed, so the owner
  // pays more BTW than they should. The bank line is the one signal that survives a silent
  // import miss, so we turn it from a dead-end into a prompt to recover the document.
  // [BANK-PAID-EXPLAINED] Exclude a debit that matches an already-PAID invoice (marked paid by hand
  // in Crediteuren): the invoice exists and its voorbelasting is already claimed, so flagging it as a
  // "missende inkoopfactuur" is a false alarm the owner can never clear.
  const missingPurchaseDebits = noMatch.filter((s) => s.amount < 0 && !s.explainedByPaid)
  const confirmedList = (data?.suggestions ?? []).filter((s) => isDone(s)).filter(inQ).sort(byDateDesc)
  // [BANK-QUARTER] Ignored tab, filtered to the selected quarter too.
  const ignoredInQ = (ignoredList ?? []).filter(inQ)
  // [BANK-BATCH-CONFIRM] The subset of "Te bevestigen" that can be bulk-confirmed
  // (strong single-invoice auto matches), and how many of those are currently ticked.
  const batchEligibleList = toConfirm.filter((s) => isBatchEligible(s))
  const batchSelectedCount = batchEligibleList.filter((s) => selectedForBatch.has(s.transactionId)).length

  // [BANK-AUTO-CONFIRM] How many of the shown (quarter-filtered) matches are near-certain
  // enough for the app to book without a tap — mirrors the server's isSafeAutoConfirm:
  // reference number + exact amount, single invoice, not an instalment. The server is
  // authoritative; this only drives the "handle X automatically" offer.
  const safeAutoCount = toConfirm.filter((s) =>
    s.outcome === 'auto' &&
    !!s.best &&
    s.best.signals.includes('reference') &&
    s.best.signals.includes('amount') &&
    (s.reference ? s.reference.split(',').map((x) => x.trim()).filter(Boolean).length <= 1 : true) &&
    !isPartialPaymentHint(`${s.reference ?? ''} ${s.description ?? ''}`),
  ).length

  const tabs = [
    { key: 'confirm' as const, label: 'Te bevestigen', icon: 'fact_check', count: toConfirm.length },
    { key: 'none' as const, label: 'Geen factuur', icon: 'help', count: noMatch.length },
    { key: 'pin' as const, label: 'Pinontvangsten', icon: 'point_of_sale', count: posList.length },
    { key: 'ignored' as const, label: 'Genegeerd', icon: 'visibility_off', count: ignoredInQ.length },
    { key: 'done' as const, label: 'Bevestigd', icon: 'link', count: confirmedList.length },
  ]
  const activeListRaw =
    bankTab === 'confirm' ? toConfirm
    : bankTab === 'none' ? noMatch
    : bankTab === 'pin' ? posList
    : bankTab === 'ignored' ? ignoredInQ
    : confirmedList

  // [SEARCH] In-page live filter — works on EVERY bank tab now (not only "Geen factuur"):
  // searches counterpart / reference / date / amount, accent-folded.
  const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const activeList =
    filterText.trim()
      ? activeListRaw.filter((s) => {
          const raw = filterText.trim()
          const q = fold(raw)
          // Amount: only when the query is AMOUNT-LIKE (digits/separators/€ only) — a
          // text query that merely contains a digit ("factuur 2") must NOT trigger it.
          // Exact value ("1.500,00" / "45,50"), plus a whole-euro match ("15" → €15,xx)
          // ONLY when no decimal was typed (so "1,5" means €1,50, not also €15,xx).
          const amountLike = raw.length > 0 && !/[^\d.,\s€-]/.test(raw)
          const qDigits = raw.replace(/[^\d]/g, '')
          const qNum = Number(raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
          // "whole euro" = the parsed value is an integer ("15","1.500","1.500,00"),
          // NOT that the raw string lacks separators — a NL thousands-dot ("1.500")
          // is still a whole number and must keep the whole-euro match.
          const isWhole = Number.isInteger(qNum)
          const an = Math.abs(s.amount)
          const amountMatch =
            amountLike && qDigits.length > 0 &&
            ((Number.isFinite(qNum) && qNum > 0 && Math.abs(an - qNum) < 0.005) ||
              (isWhole && String(Math.trunc(an)) === qDigits))
          return (
            fold(s.counterpart ?? '').includes(q) ||
            fold(s.reference ?? '').includes(q) ||
            (s.date ?? '').toLowerCase().includes(raw.toLowerCase()) ||
            amountMatch
          )
        })
      : activeListRaw

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px', fontFamily: FONT, color: M3.onSurface }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 26, color: M3.primary }}>account_balance</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bank</h1>
      </div>
      <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 18px', lineHeight: 1.5 }}>
        Upload je bankafschrift. We koppelen transacties aan je facturen — jij bevestigt.
      </p>

      {/* [P1-UNCATEGORIZED] Money that is NOT yet in your books. A bank line without a category
          is silently excluded from the W&V/BTW — so make it loud, not invisible. Links straight
          to the categorisation screen where these get an identity (kost, huur, fee, transfer…). */}
      {uncatCount > 0 && (
        <Link
          href="/dashboard/bank/categoriseren"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
            background: '#FEF7E0', border: '1px solid #FBBC04', borderRadius: R.md,
            padding: '12px 14px', marginBottom: 16,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#B06000' }}>label_important</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#7A4F00' }}>
              {uncatCount === 1 ? '1 banktransactie nog niet gecategoriseerd' : `${uncatCount} banktransacties nog niet gecategoriseerd`}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: '#7A4F00', marginTop: 1 }}>
              Dit geld telt nog niet mee in je winst &amp; verlies en BTW. Geef het een categorie →
            </span>
          </span>
        </Link>
      )}

      {/* Upload card */}
      <label
        onDrop={onDropZone}
        onDragOver={onDragOverZone}
        onDragLeave={onDragLeaveZone}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '28px 16px', borderRadius: R.lg, cursor: busy ? 'default' : 'pointer',
          // [BANK-DND] Thicken + fill the border while a file is dragged over.
          border: `${dragActive ? 2.5 : 1.5}px dashed ${M3.primary}`,
          background: dragActive ? '#BBD4FB' : M3.primaryContainer,
          textAlign: 'center',
          opacity: busy ? 0.7 : 1, transition: 'all 0.15s',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 32, color: M3.primary }}>
          {busy ? 'hourglass_empty' : 'upload_file'}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: M3.onPrimaryContainer }}>
          {busy ? 'Bezig…' : dragActive ? 'Laat los om te uploaden' : 'Kies bankafschrift'}
        </span>
        <span style={{ fontSize: 12, color: '#41618a' }}>CAMT.053 (.xml) of MT940 (.940 / .sta / .txt)</span>
        {/* [BANK-DND] Tell the owner drag-and-drop is available. */}
        {!busy && !dragActive && (
          <span style={{ fontSize: 11.5, color: '#5b7aa8' }}>Sleep je bestand hierheen of klik om te kiezen</span>
        )}
        <input type="file" accept=".xml,.940,.sta,.mt940,.txt" onChange={handleFile} disabled={busy} style={{ display: 'none' }} />
      </label>

      {/* Upload summary */}
      {uploadInfo && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: R.md, background: M3.surface, boxShadow: EL1, fontSize: 13, color: '#3c4043' }}>
          <strong>{uploadInfo.format}</strong> · {uploadInfo.parsed} transacties gelezen ·{' '}
          {uploadInfo.inserted} nieuw{uploadInfo.skipped > 0 ? ` · ${uploadInfo.skipped} dubbel overgeslagen` : ''}
          {/* [R2] Never silently short a transaction: if lines couldn't be read, say so —
              they're in the stored file for the accountant, but not in this overview. */}
          {uploadInfo.unreadable > 0 && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: R.sm, background: '#FEE8C4', color: '#7C5800', fontSize: 12.5, fontWeight: 600 }}>
              ⚠ {uploadInfo.unreadable} regel{uploadInfo.unreadable === 1 ? '' : 's'} kon{uploadInfo.unreadable === 1 ? '' : 'den'} niet gelezen worden en {uploadInfo.unreadable === 1 ? 'staat' : 'staan'} niet in je overzicht. Het originele bestand is wél bewaard voor je boekhouder — controleer die regel{uploadInfo.unreadable === 1 ? '' : 's'}.
            </div>
          )}
          {/* [BANK-BALANCE §2.6] The statement doesn't tie out to its own begin/eindsaldo → a bank
              line is missing. A stronger (red) banner than the unreadable-line notice: this means
              the figures are incomplete until the full afschrift is re-uploaded. */}
          {uploadInfo.balanceWarning && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: R.sm, background: '#FCE8E6', color: '#B3261E', fontSize: 12.5, fontWeight: 600 }}>
              ⚠ {uploadInfo.balanceWarning}
            </div>
          )}
        </div>
      )}

      {/* [BANK-STATEMENTS] Uploaded statements table — shows what the owner has
          uploaded and when. Plus a "refresh names" action that upgrades older
          rows whose name is still "Onbekende" (read from their description). */}
      {statements && statements.length > 0 && (
        <div style={{ marginTop: 16, borderRadius: R.lg, background: M3.surface, boxShadow: EL1, border: '1px solid #EEE', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid #F0F0F0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#3c4043', letterSpacing: 0.3 }}>
              Geüploade afschriften
            </span>
            <button
              onClick={refreshNames}
              disabled={refreshingNames}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${M3.surfaceVariant}`,
                background: '#fff', borderRadius: R.full, padding: '5px 11px', cursor: refreshingNames ? 'default' : 'pointer',
                fontFamily: FONT, fontSize: 12, fontWeight: 600, color: M3.primary, opacity: refreshingNames ? 0.6 : 1,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                {refreshingNames ? 'hourglass_empty' : 'refresh'}
              </span>
              {refreshingNames ? 'Bezig…' : 'Namen bijwerken'}
            </button>
          </div>
          {statements.map((st) => (
            <div key={st.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f8f9fa' }}>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#9aa0a6', flexShrink: 0 }}>description</span>
                <span style={{ fontSize: 13, color: '#3c4043', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {st.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, color: '#9aa0a6', whiteSpace: 'nowrap' }}>
                  {fmtUploadDate(st.uploadedAt)}
                </span>
                {/* [BANK-STATEMENT-DELETE] Delete this statement (replace a wrong
                    upload). Opens a confirm dialog — never deletes on first click. */}
                <button
                  onClick={() => setStatementToDelete({ id: st.id, name: st.name })}
                  disabled={deletingStatementId === st.id}
                  aria-label="Bankafschrift verwijderen"
                  title="Verwijderen"
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: R.full, border: 'none', background: 'transparent',
                    cursor: deletingStatementId === st.id ? 'default' : 'pointer', color: M3.error,
                    opacity: deletingStatementId === st.id ? 0.5 : 1,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {deletingStatementId === st.id ? 'hourglass_empty' : 'delete'}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* [BANK-AUTO-CONFIRM] "Quiet by default": the app offers to book the near-certain
          payments itself, so the owner isn't tapping through hundreds of sure matches. The
          server only books reference+exact-amount single-invoice matches, and every
          booking is reversible — the ambiguous ones stay in the list for the human. */}
      {safeAutoCount > 0 && (
        <div style={{ marginTop: 18, borderRadius: R.lg, background: M3.primaryContainer, padding: '16px 18px', boxShadow: EL1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.primary }}>bolt</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: M3.onPrimaryContainer }}>
              {autoRunning
                ? `Ik handel ${safeAutoCount} zekere ${safeAutoCount === 1 ? 'betaling' : 'betalingen'} voor je af…`
                : `${safeAutoCount} zekere ${safeAutoCount === 1 ? 'betaling' : 'betalingen'} klaar om af te handelen`}
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: '#3c4043', margin: '6px 0 12px', lineHeight: 1.5 }}>
            Facturen waarvan het nummer én het bedrag exact in je bankafschrift staan handel ik zelf af — koppelen en als betaald markeren. De rest laat ik aan jou, en je kunt elke koppeling later ongedaan maken.
          </div>
          {/* [BANK-AUTO-RUN] The app already books these on load; this button is only a manual
              re-trigger if the automatic pass was interrupted (e.g. a network hiccup). */}
          <button
            onClick={autoConfirm}
            disabled={autoRunning}
            style={{
              padding: '11px 16px', borderRadius: R.full, border: 'none',
              background: autoRunning ? '#dadce0' : M3.primary, color: '#fff',
              fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: autoRunning ? 'default' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{autoRunning ? 'hourglass_empty' : 'auto_awesome'}</span>
            {autoRunning ? 'Bezig…' : 'Nu afhandelen'}
          </button>
        </div>
      )}
      {autoDoneCount != null && autoDoneCount > 0 && safeAutoCount === 0 && (
        <div style={{ marginTop: 18, borderRadius: R.lg, background: M3.successContainer, padding: '14px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: M3.success, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>task_alt</span>
            Ik heb {autoDoneCount} {autoDoneCount === 1 ? 'betaling' : 'betalingen'} automatisch afgehandeld
          </div>
          <div style={{ fontSize: 12.5, color: '#0B5345', marginTop: 2 }}>Alleen wat jouw aandacht nodig heeft is overgebleven.</div>
        </div>
      )}

      {/* [BANK-TABS] Tabs — only once we have data with at least one transaction */}
      {data && (toConfirm.length + noMatch.length + posList.length + confirmedList.length + (ignoredList?.length ?? 0)) > 0 && (
        <>
          {/* [BANK-QUARTER] Quarter filter — only when more than one quarter is loaded.
              Defaults (via 'auto') to the newest quarter so the owner sees just the
              quarter they're working on; "Alle" brings every quarter back. Counts are
              per quarter so it's obvious no data was deleted — only filtered. */}
          {quarters.length >= 2 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: '#5F6368', fontWeight: 700 }}>Kwartaal:</span>
              {([{ key: 'all', label: 'Alle', count: null as number | null }, ...quarters.map((q) => ({ key: q.key, label: quarterLabelOf(q.key), count: q.count }))]).map((q) => {
                const active = q.key === 'all' ? quarterSel === 'all' : effectiveQuarter === q.key
                return (
                  <button
                    key={q.key}
                    onClick={() => setQuarterSel(q.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px',
                      borderRadius: R.full, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                      border: `1px solid ${active ? M3.primary : '#E0E0E0'}`,
                      background: active ? M3.primaryContainer : '#fff',
                      color: active ? M3.onPrimaryContainer : '#5F6368',
                    }}
                  >
                    {q.label}
                    {q.count != null && <span style={{ opacity: 0.6, fontFamily: FONT_NUM }}>{q.count}</span>}
                  </button>
                )
              })}
            </div>
          )}
          {/* [BANK-CHIPS] Chips grid instead of a horizontal scroll bar: every tab
              is visible at once and wraps to the next line on narrow screens — no
              hidden horizontal scroll the owner can miss. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {tabs.map((t) => {
              const active = bankTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setBankTab(t.key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                    borderRadius: R.full, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600,
                    border: `1px solid ${active ? M3.primary : '#E0E0E0'}`,
                    background: active ? M3.primaryContainer : '#fff',
                    color: active ? M3.onPrimaryContainer : '#5F6368',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
                  {t.label}
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '0px 6px', borderRadius: R.full, fontFamily: FONT_NUM,
                    background: active ? '#fff' : M3.surfaceVariant, color: active ? M3.primary : '#5F6368',
                  }}>
                    {t.count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* [BANK-SAFETY-NET] Missing purchase invoices — a debit we can't match to any
              invoice means the deductible BTW on that cost isn't claimed. The bank line is the
              backstop that catches whatever import missed; turn it into a recovery prompt. */}
          {bankTab === 'none' && missingPurchaseDebits.length > 0 && (
            <div style={{ marginTop: 12, borderRadius: R.lg, background: '#FFF3E0', padding: '14px 16px', boxShadow: EL1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#B26A00' }}>receipt_long</span>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#7A4B00' }}>
                  {missingPurchaseDebits.length} {missingPurchaseDebits.length === 1 ? 'betaling' : 'betalingen'} zonder inkoopfactuur
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: '#7A4B00', margin: '6px 0 12px', lineHeight: 1.5 }}>
                Je hebt betaald, maar we hebben de factuur nog niet. Zonder factuur mis je de BTW-aftrek (voorbelasting) op deze kosten. Voeg de factuur toe, of haal je e-mail opnieuw op — dan koppelen we hem automatisch.
              </div>
              <Link
                href="/dashboard/incoming"
                style={{
                  padding: '10px 16px', borderRadius: R.full, border: 'none',
                  background: '#B26A00', color: '#fff', fontSize: 13.5, fontWeight: 600,
                  fontFamily: FONT, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  textDecoration: 'none',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>add</span>
                Factuur toevoegen of e-mail opnieuw ophalen
              </Link>
            </div>
          )}

          {/* "Geen factuur" context — POS receipts naturally have no invoice */}
          {bankTab === 'none' && noMatch.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#5F6368', margin: '12px 2px 0', lineHeight: 1.5 }}>
              Leveranciers zonder gevonden factuur. Koppel het bestand, of negeer de transactie als er geen factuur bij hoort (zoals huur of een lening).
            </p>
          )}

          {/* [COHERENCE-ORPHAN] Entry point to the bank-line categorisation screen. It
              was a real, P&L-feeding feature (give every uncategorised debit/credit an
              identity: kost, huur, fee, transfer…) with NO link anywhere — reachable only
              by typing the URL. Surface it here, where uncategorised "geen factuur" lines
              live, so those costs can actually reach the W&V/BTW. */}
          {bankTab === 'none' && noMatch.length > 0 && (
            <Link
              href="/dashboard/bank/categoriseren"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
                fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>label</span>
              Geef deze regels een categorie →
            </Link>
          )}

          {/* [SEARCH] In-page live filter — on every tab that has a list. */}
          {activeListRaw.length > 0 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <span
                className="material-symbols-outlined"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 19, color: '#9aa0a6', pointerEvents: 'none' }}
              >
                search
              </span>
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Zoek op naam, bedrag of datum"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 38px',
                  borderRadius: R.full, border: `1px solid ${M3.surfaceVariant}`, background: '#fff',
                  fontFamily: FONT, fontSize: 13.5, color: M3.onSurface, outline: 'none',
                }}
              />
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  aria-label="Wis zoekopdracht"
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', cursor: 'pointer', color: '#9aa0a6',
                    display: 'flex', alignItems: 'center', padding: 4,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                </button>
              )}
            </div>
          )}
          {/* Empty-filter hint — any tab */}
          {filterText.trim() && activeListRaw.length > 0 && activeList.length === 0 && (
            <p style={{ fontSize: 13, color: '#9aa0a6', margin: '14px 2px 0' }}>
              Geen transacties gevonden voor “{filterText.trim()}”.
            </p>
          )}

          {bankTab === 'pin' && posList.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#5F6368', margin: '12px 2px 0', lineHeight: 1.5 }}>
              Pinontvangsten via de betaalautomaat (ING DD&C). Deze hebben geen factuur — ze staan hier zodat ze je openstaande werk niet in de weg zitten.
            </p>
          )}

          {/* Active group */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {/* [BANK-BATCH-CONFIRM] Bulk-confirm bar — only in "Te bevestigen", only
                when there are strong 'auto' matches that can be safely ticked. */}
            {bankTab === 'confirm' && batchEligibleList.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderRadius: R.lg, background: M3.surfaceVariant, border: `1px solid ${M3.outline}` }}>
                <button
                  onClick={() => {
                    const allTicked = batchEligibleList.every((s) => selectedForBatch.has(s.transactionId))
                    setSelectedForBatch(
                      allTicked ? new Set() : new Set(batchEligibleList.map((s) => s.transactionId))
                    )
                  }}
                  disabled={batchRunning}
                  style={{ border: 'none', background: 'none', cursor: batchRunning ? 'default' : 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600, color: M3.primary, padding: 0 }}
                >
                  {batchEligibleList.every((s) => selectedForBatch.has(s.transactionId)) && batchSelectedCount > 0
                    ? 'Selectie wissen'
                    : `Selecteer alle (${batchEligibleList.length})`}
                </button>
                <span style={{ fontSize: 12.5, color: '#5F6368', marginLeft: 'auto' }}>
                  {batchSelectedCount > 0 ? `${batchSelectedCount} geselecteerd` : 'Vink sterke matches aan'}
                </span>
                <button
                  onClick={confirmBatch}
                  disabled={batchSelectedCount === 0 || batchRunning}
                  style={{
                    border: 'none', borderRadius: R.full, cursor: batchSelectedCount === 0 || batchRunning ? 'default' : 'pointer',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600, padding: '8px 16px',
                    background: batchSelectedCount === 0 || batchRunning ? '#dadce0' : M3.primary, color: '#fff',
                  }}
                >
                  {batchRunning ? 'Bezig…' : `Bevestig betaling (${batchSelectedCount})`}
                </button>
              </div>
            )}
            {activeList.map((s) => (
              <TxCard
                key={s.transactionId}
                s={s}
                selectedInvoiceId={selected[s.transactionId]}
                processing={processingId === s.transactionId}
                isIgnoredTab={bankTab === 'ignored'}
                confirmedNumbers={confirmed[s.transactionId]?.numbers ?? []}
                batchEligible={bankTab === 'confirm' && isBatchEligible(s)}
                batchChecked={selectedForBatch.has(s.transactionId)}
                onBatchToggle={() =>
                  setSelectedForBatch((set) => {
                    const next = new Set(set)
                    if (next.has(s.transactionId)) next.delete(s.transactionId)
                    else next.add(s.transactionId)
                    return next
                  })
                }
                onSelect={(invId) => setSelected((sel) => ({ ...sel, [s.transactionId]: invId }))}
                onConfirm={(num, invId) => confirm(s.transactionId, num, invId)}
                onAttach={(files) => attachFile(s.transactionId, files, s.amount >= 0)}
                onIgnore={() => ignoreTx(s.transactionId)}
                onRestore={() => restoreTx(s.transactionId)}
                onOpenFile={openInvoiceFile}
                isDoneTab={bankTab === 'done'}
                onUnlink={() => unlink(s.transactionId)}
              />
            ))}
            {activeList.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 20px', color: '#9aa0a6', fontSize: 13.5 }}>
                {bankTab === 'confirm' ? 'Niets te bevestigen.'
                  : bankTab === 'none' ? 'Geen openstaande transacties zonder factuur.'
                  : bankTab === 'pin' ? 'Geen pinontvangsten.'
                  : bankTab === 'ignored' ? 'Niets genegeerd.'
                  : 'Nog niets gekoppeld.'}
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty (no transactions at all) */}
      {!initialLoading && data && (toConfirm.length + noMatch.length + posList.length + confirmedList.length + (ignoredList?.length ?? 0)) === 0 && (
        <Empty done={confirmedList.length > 0} />
      )}

      {/* B.4 verwerkt dialog */}
      {verwerktCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setVerwerktCtx(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>Factuur is verwerkt</h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              De boekhouder heeft factuur {verwerktCtx.number} verwerkt. Vraag eerst om de verwerking ongedaan te maken voordat je deze koppelt.
            </p>
            <button
              onClick={() => setVerwerktCtx(null)}
              style={{ width: '100%', padding: 12, borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              Sluiten
            </button>
          </div>
        </div>
      )}

      {/* [BANK-STATEMENT-DELETE] Confirm dialog — the delete is permanent, so we
          require an explicit confirmation and remind the owner to make sure they
          have the correct version uploaded. */}
      {statementToDelete && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!deletingStatementId) setStatementToDelete(null) }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.error }}>warning</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Bankafschrift verwijderen?</h3>
            </div>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 6px' }}>
              Weet je zeker dat je dit bankafschrift wilt verwijderen?
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.5, margin: '0 0 4px', wordBreak: 'break-word' }}>
              <strong style={{ color: '#3c4043' }}>{statementToDelete.name}</strong>
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              Zorg dat je de juiste versie hebt geüpload. Dit kan niet ongedaan worden gemaakt. Je transacties blijven behouden.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStatementToDelete(null)}
                disabled={!!deletingStatementId}
                style={{
                  flex: 1, padding: 12, borderRadius: R.full, background: '#fff', color: M3.primary,
                  fontSize: 14, fontWeight: 600, border: `1.5px solid #E0E0E0`, cursor: deletingStatementId ? 'default' : 'pointer',
                  fontFamily: FONT, opacity: deletingStatementId ? 0.6 : 1,
                }}
              >
                Annuleren
              </button>
              <button
                onClick={() => deleteStatement(statementToDelete.id)}
                disabled={!!deletingStatementId}
                style={{
                  flex: 1, padding: 12, borderRadius: R.full, background: M3.error, color: '#fff',
                  fontSize: 14, fontWeight: 600, border: 'none', cursor: deletingStatementId ? 'default' : 'pointer',
                  fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: deletingStatementId ? 0.7 : 1,
                }}
              >
                {deletingStatementId
                  ? <span className="material-symbols-outlined" style={{ fontSize: 18 }}>hourglass_empty</span>
                  : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span> Verwijderen</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [BANK-FORMAT-GUARD] Unreadable-format notice — a clear modal (not a toast)
          telling the owner the file was kept for the accountant but its transactions
          could not be read, and which formats to use for the bank overview. */}
      {formatNotice && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setFormatNotice(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.primary }}>info</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Transacties niet uitgelezen</h3>
            </div>
            <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.5, margin: '0 0 4px', wordBreak: 'break-word' }}>
              <strong style={{ color: '#3c4043' }}>{formatNotice.name}</strong>
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 10px' }}>
              Dit bestand is bewaard voor je boekhouder, maar de transacties konden niet worden uitgelezen voor het overzicht.
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              Upload je afschrift als <strong style={{ color: '#3c4043' }}>CAMT.053 (.xml)</strong> of <strong style={{ color: '#3c4043' }}>MT940 (.940 / .sta / .txt)</strong> om de transacties te koppelen. CSV en PDF kunnen niet worden uitgelezen.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setFormatNotice(null)}
                style={{
                  padding: '12px 24px', borderRadius: R.full, background: M3.primary, color: '#fff',
                  fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT,
                }}
              >
                Begrepen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: '#202124', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.sm, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '90vw', textAlign: 'center', fontFamily: FONT }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Empty({ done }: { done: boolean }) {
  return (
    <div style={{ marginTop: 28, textAlign: 'center', color: '#9aa0a6' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 40 }}>{done ? 'done_all' : 'inbox'}</span>
      <p style={{ fontSize: 13.5, marginTop: 6 }}>{done ? 'Alles afgehandeld.' : 'Nog geen transacties om te koppelen.'}</p>
    </div>
  )
}

function TxCard({
  s, selectedInvoiceId, processing, isIgnoredTab, confirmedNumbers, batchEligible, batchChecked, onBatchToggle, onSelect, onConfirm, onAttach, onIgnore, onRestore, onOpenFile, isDoneTab, onUnlink,
}: {
  s: Suggestion
  selectedInvoiceId: string | undefined
  processing: boolean
  isIgnoredTab: boolean
  confirmedNumbers: string[]
  batchEligible: boolean
  batchChecked: boolean
  onBatchToggle: () => void
  onSelect: (invoiceId: string) => void
  onConfirm: (invoiceNumber: string | null, invoiceId?: string) => void
  onAttach: (files: File[]) => void
  onIgnore: () => void
  onRestore: () => void
  onOpenFile: (invoiceId: string) => void
  isDoneTab?: boolean
  onUnlink?: () => void
}) {
  const isCredit = s.amount >= 0
  const amountColor = isCredit ? M3.success : M3.error
  // [BANK-DETAILS] Like the ING app, the card shows a clean name and lets the
  // owner expand the FULL original description (Pasvolgnr, Transactienr, Google
  // Pay, etc.) on demand — useful to verify a payment, and it reveals the real
  // counterpart even on older rows whose stored name is still "Onbekende".
  const [showDetails, setShowDetails] = useState(false)
  const hasDetails = !!(s.description && s.description.trim())
  // [BANK-SLOT-DISMISS] The reference extractor (a regex) can grab numbers that
  // are NOT invoices — a customer number after "Klant:", a postcode like "5049NM".
  // The owner knows their own suppliers, so we let them remove a wrong number from
  // this transaction's list with an ✗. This is a VIEW-only dismissal for the
  // session: it never touches the stored reference (kept intact for the accountant
  // and the matcher) or the DB. It doesn't need to persist — once the owner links
  // the real invoice (or hits Negeren), the whole transaction leaves the list, so
  // a dismissal is only ever needed once. The full raw description stays under
  // "Details", so nothing is hidden and a mistaken ✗ is recoverable with a reload.
  const [dismissedNumbers, setDismissedNumbers] = useState<Set<string>>(new Set())
  // [BANK-REF-DISPLAY] Build a compact label from the extracted reference. One
  // number → show it; several (comma-separated, a multi-invoice payment) → show
  // "N facturen" so the card stays clean and signals the multi-invoice case.
  // Normalize a reference number the same way the matcher does (lowercase, keep
  // [a-z0-9]) — used for candidate matching AND for the dismiss set.
  const normRef = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
  const allRefParts = (s.reference ?? '').split(',').map((r) => r.trim()).filter(Boolean)
  // [BANK-SLOT-DISMISS] Hide any number the owner removed with ✗ (view-only). The
  // raw reference is untouched; this only changes what THIS card shows this session.
  const refParts = allRefParts.filter((r) => !dismissedNumbers.has(normRef(r)))
  // [BANK-R1] On the "Gekoppeld" tab a matched line may have a sparse bank reference (an auto 1:1
  // match keyed on amount) — fall back to the actually-linked invoice number(s) so the owner still
  // sees WHICH invoice was booked, not a bare payment with no clue what happened.
  const doneNumbers = s.coveredNumbers ?? []
  const refLabel =
    refParts.length === 0
      ? (isDoneTab && doneNumbers.length > 0
          ? (doneNumbers.length === 1 ? doneNumbers[0] : `${doneNumbers.length} facturen`)
          : null)
      : refParts.length === 1 ? refParts[0]
      : `${refParts.length} facturen`
  const selectedCand =
    s.candidates.find((c) => c.invoiceId === selectedInvoiceId) ?? (s.outcome === 'auto' ? s.best : null)

  // [BANK-MULTI-CONFIRM] A transaction whose reference lists more than one invoice
  // number covers several invoices. Instead of "pick ONE" (which silently drops the
  // others), show a row PER reference number with its own state. Mirrors the
  // backend's allCovered logic on the display side so the owner sees exactly what is
  // confirmed and what is still open. Only relevant in the confirm flow (not the
  // ignored tab, and not when there is no real candidate at all).
  //
  // [BANK-SLOT-DISMISS] `wasMulti` is based on the ORIGINAL reference: once a
  // transaction shows the multi-row UI, it keeps it even after the owner dismisses
  // numbers down to one (or zero) — so the Negeren escape hatch stays available and
  // a fully-dismissed transaction (e.g. Brabant Water, where every number was a
  // customer/postcode, not an invoice) can still be cleared. Slots are built from
  // the current refParts, so dismissed numbers simply disappear as rows.
  // [BANK-PSP-MATCH] A genuine multi-invoice batch = ≥2 of the bank's reference numbers
  // resolve to REAL invoices (a live candidate, or a number already confirmed against this
  // tx), OR the server flagged this tx as a partially-linked multi (one invoice already
  // paid, others still open). A PSP / order-gateway reference (Mollie transaction hash +
  // order number) resolves <2 real invoices, so it falls through to the normal match UI and
  // the amount-matched invoice is offered instead of hidden. Counting RESOLVED references —
  // not raw fragments (which forced the slot view on junk), and not any full-amount
  // candidate (which let an UNRELATED invoice equal to the whole debit collapse a real
  // batch and steer to the wrong pick — caught in adversarial review) — fixes both bugs.
  const resolvedRefCount = countResolvedReferences(
    allRefParts,
    [...s.candidates.map((c) => c.invoiceNumber), ...confirmedNumbers, ...(s.coveredNumbers ?? [])],
  )
  const wasMulti = !isIgnoredTab && (resolvedRefCount >= 2 || s.partiallyLinked === true)
  // Equality — not substring — so "263" can't claim "26302050".
  // [BANK-SLOT-PERSIST] Merge the SESSION's just-confirmed numbers with the server's
  // covered numbers (paid invoices, reload-safe) so an already-paid slot shows "Betaald"
  // after a refresh instead of a false "Koppelen" / "nog open" that would double-book it.
  const confirmedSet = new Set([...confirmedNumbers, ...(s.coveredNumbers ?? [])].map(normRef))
  // [BANK-SLOT-DISMISS] Build slots whenever the transaction STARTED multi, so a
  // single remaining number (after others were dismissed) still shows its own
  // linkable row — not just an empty banner. Driven by wasMulti, not isMulti.
  const slots = wasMulti
    ? refParts.map((refNum) => {
        const key = normRef(refNum)
        const cand = s.candidates.find((c) => normRef(c.invoiceNumber ?? '') === key) ?? null
        const isConfirmed = confirmedSet.has(key)
        return { refNum, cand, isConfirmed }
      })
    : []
  const openCount = slots.filter((sl) => !sl.isConfirmed).length
  // [BANK-BATCH-RECONCILE] Sum the matched invoices and check the total equals the bank
  // debit. This is the honest proof a batch payment covers exactly these invoices — no
  // single invoice amount appears in the statement, only the sum was debited. Only shown
  // BEFORE any slot is confirmed: once the owner starts confirming, a paid invoice drops
  // out of the candidate set (its amount is gone), so the sum can no longer be trusted —
  // the "X/Y bevestigd" progress banner tells the story from there.
  const batch = wasMulti
    ? reconcileBatch(
        slots.map((sl) => ({ refNum: sl.refNum, amount: sl.cand?.amount ?? null, isConfirmed: sl.isConfirmed })),
        s.amount,
      )
    : null
  const showReconcile = batch != null && !batch.anyConfirmed && slots.length > 0

  return (
    <div style={{ borderRadius: R.lg, background: M3.surface, boxShadow: EL1, padding: 14, border: `1px solid #EEE` }}>
      {/* [BANK-UNLINK] On the Gekoppeld tab, one tap undoes the match — makes the app's
          automatic booking safe: any auto-confirmed payment is reversible. */}
      {isDoneTab && onUnlink && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={onUnlink}
            disabled={processing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: processing ? 'default' : 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#9aa0a6', padding: '2px 4px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>link_off</span>
            {processing ? 'Bezig…' : 'Ontkoppelen'}
          </button>
        </div>
      )}
      {/* [BANK-AMOUNT-ONLY] This line was auto-linked on the exact amount + a matching supplier
          name (no invoice number/IBAN in the statement). Almost always right, but for a recurring
          same-amount supplier it could be the wrong month — so flag it for a quick check. One tap
          on Ontkoppelen above undoes it. Only on the Gekoppeld tab. */}
      {isDoneTab && s.matchReason === 'amount_only' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          background: '#FEF7E0', border: '1px solid #FBBC04', borderRadius: R.sm, padding: '8px 10px',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#B06000' }}>rule</span>
          <span style={{ fontSize: 12, color: '#7A4F00', lineHeight: 1.4 }}>
            Automatisch gekoppeld op <strong>bedrag + naam</strong> (geen factuurnummer in het afschrift). Even controleren of dit de juiste factuur is.
          </span>
        </div>
      )}
      {/* Transaction row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 0, alignItems: 'flex-start' }}>
          {/* [BANK-BATCH-CONFIRM] Tick to include this strong match in a bulk confirm.
              Only rendered for batch-eligible (auto, single-invoice) transactions. */}
          {batchEligible && (
            <input
              type="checkbox"
              checked={batchChecked}
              onChange={onBatchToggle}
              disabled={processing}
              aria-label="Selecteer voor bevestigen"
              style={{ marginTop: 2, width: 18, height: 18, accentColor: M3.primary, cursor: processing ? 'default' : 'pointer', flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.counterpart || 'Onbekende tegenpartij'}
            </div>
          <div style={{ fontSize: 12, color: '#5F6368', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{s.date}</span>
            {/* [BANK-REF-DISPLAY] Show the clean extracted invoice number(s) as a
                chip — not the raw "USTD//..." description. Multiple invoices in one
                payment render a count ("3 facturen") so the owner sees instantly
                that this transaction covers several invoices. */}
            {refLabel && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
                borderRadius: R.full, background: M3.surfaceVariant, color: '#3c4043',
                fontSize: 11.5, fontWeight: 600, fontFamily: FONT_NUM,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>receipt_long</span>
                {refLabel}
              </span>
            )}
            {/* [BANK-PERIOD] A recurring debit (rent/lease/subscription) states the month
                it covers. Surface it so the owner can match it to the right invoice among
                same-amount candidates — we never auto-match it (invoices have no period). */}
            {(() => {
              const period = parsePaymentPeriod(s.description)
              return period ? (
                <span title="De periode die deze betaling dekt" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
                  borderRadius: R.full, background: '#E8F0FE', color: '#1967D2',
                  fontSize: 11.5, fontWeight: 600, fontFamily: FONT,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>event</span>
                  {period.label}
                </span>
              ) : null
            })()}
            {/* [BANK-DETAILS] Toggle the full original bank description. */}
            {hasDetails && (
              <button
                onClick={() => setShowDetails((v) => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 2, border: 'none', background: 'none',
                  cursor: 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 600, color: M3.primary, padding: 0,
                }}
              >
                Details
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                  {showDetails ? 'expand_less' : 'expand_more'}
                </span>
              </button>
            )}
          </div>
          </div>
        </div>
        <div style={{ fontFamily: FONT_NUM, fontSize: 14.5, fontWeight: 700, color: amountColor, whiteSpace: 'nowrap' }}>
          {isCredit ? '+' : '−'}{eur.format(Math.abs(s.amount))}
        </div>
      </div>

      {/* [BANK-DETAILS] Full original description (as the bank recorded it). */}
      {showDetails && hasDetails && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: R.md, background: '#F8F9FA',
          fontSize: 12, color: '#5F6368', lineHeight: 1.5, wordBreak: 'break-word',
          fontFamily: FONT, border: '1px solid #EEE',
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa0a6', marginBottom: 3, letterSpacing: 0.4 }}>
            OMSCHRIJVING
          </div>
          {cleanBankDescription(s.description)}
        </div>
      )}

      {/* [BANK-MULTI-CONFIRM] Multi-invoice transaction — one row per reference
          number, each with its own state: confirmed (✓), confirmable (a candidate
          exists → Bevestig), or missing (no invoice in the system → koppel het
          bestand). The transaction stays here until every row is confirmed.
          [BANK-SLOT-DISMISS] Shown for any transaction that STARTED multi, so the
          UI (and Negeren) persists even after numbers are dismissed down to ≤1. */}
      {wasMulti && (
        <div style={{ marginTop: 12 }}>
          {refParts.length === 0 ? (
            /* Every number was dismissed as "not an invoice". Nothing left to link —
               offer the clean exit. The raw description stays under Details. */
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              padding: '8px 10px', borderRadius: R.md, background: '#F8F9FA',
              color: '#5F6368', fontSize: 12.5, fontWeight: 600, marginBottom: 10,
              border: '1px solid #EEE',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>info</span>
              Geen factuurnummers meer. Is dit geen factuur? Gebruik Negeren.
            </div>
          ) : (
          <>
          {/* Status banner: X/Y bevestigd + open numbers. Honest: we list the
              numbers the BANK wrote in the reference, not an invented total. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '8px 10px', borderRadius: R.md,
            background: openCount === 0 ? M3.successContainer : M3.primaryContainer,
            color: openCount === 0 ? M3.success : M3.onPrimaryContainer,
            fontSize: 12.5, fontWeight: 600, marginBottom: 10,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              {openCount === 0 ? 'task_alt' : 'receipt_long'}
            </span>
            {slots.length - openCount}/{slots.length} bevestigd
            {openCount > 0 && (
              <span style={{ fontWeight: 500, opacity: 0.9 }}>
                · Nog open: {slots.filter((sl) => !sl.isConfirmed).map((sl) => sl.refNum).join(', ')}
              </span>
            )}
          </div>

          {/* [BANK-BATCH-RECONCILE] Honest sum-check of the whole batch, shown before the
              owner starts confirming. Green ONLY when every referenced invoice is in the
              system AND their totals equal the debit to the cent; an amber warning when
              they don't add up; a neutral note when some invoices are still missing. */}
          {showReconcile && batch && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              padding: '8px 10px', borderRadius: R.md, marginBottom: 10,
              fontSize: 12.5, fontWeight: 500, lineHeight: 1.45,
              background: batch.status === 'ties' ? M3.successContainer : batch.status === 'mismatch' ? '#FEEFC3' : M3.surfaceVariant,
              color: batch.status === 'ties' ? M3.success : batch.status === 'mismatch' ? '#7A4F00' : '#3c4043',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                {batch.status === 'ties' ? 'verified' : batch.status === 'mismatch' ? 'error' : 'info'}
              </span>
              <span>
                {batch.status === 'ties'
                  ? (batch.matchedCount >= 2
                      ? <><strong>Samen {eur.format(batch.total)}</strong> — precies gelijk aan de afschrijving. Alle {batch.slotCount} factuurnummers staan in je bankafschrift.</>
                      : <><strong>{eur.format(batch.total)}</strong> en het factuurnummer staan in je bankafschrift.</>)
                  : batch.status === 'mismatch'
                    ? <>{batch.matchedCount >= 2 ? 'Samen ' : ''}<strong>{eur.format(batch.total)}</strong>, maar er is {eur.format(batch.bankAmount)} afgeschreven (verschil {eur.format(Math.abs(batch.diff))}). Controleer welke {batch.matchedCount >= 2 ? 'facturen' : 'factuur'} bij deze betaling {batch.matchedCount >= 2 ? 'horen' : 'hoort'}.</>
                    : <>{batch.matchedCount} van {batch.slotCount} facturen staan in je administratie. De factuurnummers staan in je bankafschrift — koppel de ontbrekende.</>}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slots.map((sl) => (
              <div
                key={sl.refNum}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '9px 10px', borderRadius: R.md,
                  border: `1px solid ${sl.isConfirmed ? M3.successContainer : '#E0E0E0'}`,
                  background: sl.isConfirmed ? M3.successContainer : '#fff',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600, fontFamily: FONT_NUM,
                    color: sl.isConfirmed ? M3.success : M3.onSurface,
                    display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0 }}>
                      {sl.isConfirmed ? 'check_circle' : sl.cand ? 'pending' : 'upload_file'}
                    </span>
                    {sl.refNum}
                  </span>
                  {/* [BANK-BATCH-RECONCILE] Per-invoice amount + open its PDF — so the
                      owner can check each factuur before confirming a batch payment. Only
                      when a real invoice is matched to this number (else "Koppelen"). */}
                  {sl.cand && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingLeft: 22, flexWrap: 'wrap' }}>
                      {sl.cand.amount != null && (
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: FONT_NUM, color: '#5F6368' }}>
                          {eur.format(Math.abs(sl.cand.amount))}
                        </span>
                      )}
                      <button
                        onClick={() => onOpenFile(sl.cand!.invoiceId)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none',
                          background: 'none', cursor: 'pointer', fontFamily: FONT,
                          fontSize: 12, fontWeight: 600, color: M3.primary, padding: 0,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>
                        Bekijk factuur
                      </button>
                    </span>
                  )}
                </div>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* [BANK-SLOT-DISMISS] Remove a number that isn't an invoice (a
                    customer number, a postcode the regex mis-picked). View-only:
                    hides this slot for the session; the stored reference and the
                    raw description (under Details) are untouched. Hidden once a
                    slot is confirmed — there's nothing to dismiss then. */}
                {!sl.isConfirmed && !processing && (
                  <button
                    title="Geen factuurnummer — verbergen"
                    aria-label="Dit nummer is geen factuur, verberg het"
                    onClick={() => setDismissedNumbers((prev) => new Set(prev).add(normRef(sl.refNum)))}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, borderRadius: R.full, border: '1px solid #E0E0E0',
                      background: '#fff', color: '#9AA0A6', cursor: 'pointer', padding: 0,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                  </button>
                )}

                {sl.isConfirmed ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: M3.success, flexShrink: 0 }}>
                    Betaald
                  </span>
                ) : sl.cand ? (
                  /* A matching invoice exists in the system → confirm this one. */
                  <button
                    disabled={processing}
                    onClick={() => onConfirm(sl.cand!.invoiceNumber ?? sl.refNum, sl.cand!.invoiceId)}
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: R.full, border: 'none', background: M3.primary,
                      color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                      cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.6 : 1,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {processing ? 'hourglass_empty' : 'check'}
                    </span>
                    Bevestig
                  </button>
                ) : (
                  /* No invoice with this number → upload its file (becomes a paid
                     invoice linked to this transaction via the attach path). */
                  <label
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: R.full, border: `1.5px dashed ${M3.primary}`,
                      background: M3.primaryContainer, color: M3.onPrimaryContainer,
                      fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                      cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      disabled={processing}
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const files: File[] = e.target.files ? Array.from(e.target.files) : []
                        e.target.value = ''
                        if (files.length) onAttach(files)
                      }}
                    />
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {processing ? 'hourglass_empty' : 'attach_file'}
                    </span>
                    Koppelen
                  </label>
                )}
                </div>
              </div>
            ))}
          </div>
          </>
          )}

          {/* Bekijk PDF for any candidate, plus the ignore escape hatch (the whole
              transaction is not an invoice after all). */}
          <button
            disabled={processing}
            onClick={onIgnore}
            style={{
              marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px', borderRadius: R.full, border: 'none', background: 'transparent',
              cursor: processing ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, color: '#9aa0a6',
              fontFamily: FONT,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility_off</span>
            Negeren
          </button>
        </div>
      )}

      {/* Match body — single-invoice transactions (and the ignored tab). */}
      {!wasMulti && s.outcome === 'none' && (
        <div style={{ marginTop: 12 }}>
          {isIgnoredTab ? (
            /* [BANK-IGNORE] Genegeerd tab — show a restore action, nothing else. */
            <>
              <div style={{ fontSize: 12.5, color: '#9aa0a6', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility_off</span>
                Genegeerd — staat niet in de actieve lijst.
              </div>
              <button
                disabled={processing}
                onClick={onRestore}
                style={{
                  marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px', borderRadius: R.full, border: `1.5px solid #E0E0E0`, background: '#fff',
                  cursor: processing ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 600, color: M3.primary,
                  fontFamily: FONT, opacity: processing ? 0.6 : 1,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {processing ? 'hourglass_empty' : 'undo'}
                </span>
                {processing ? 'Bezig…' : 'Terugzetten'}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12.5, color: '#9aa0a6', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>help</span>
                Geen factuur gevonden voor deze transactie.
              </div>
              {/* [BANK-ATTACH] Attach the document(s) for this payment. Shown on
                  BOTH debit (expense → inkoopfactuur) and credit (income/refund →
                  verkoopfactuur) — income also has documents worth linking (a
                  supplier refund, a B2B sale). One transaction can pay SEVERAL
                  invoices, so the file picker accepts MULTIPLE files at once. */}
              <label
                style={{
                  marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px', borderRadius: R.full, border: `1.5px dashed ${M3.primary}`,
                  background: M3.primaryContainer, cursor: processing ? 'default' : 'pointer',
                  fontSize: 13.5, fontWeight: 600, color: M3.onPrimaryContainer, opacity: processing ? 0.6 : 1,
                }}
              >
                <input
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  disabled={processing}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const files: File[] = e.target.files ? Array.from(e.target.files) : []
                    e.target.value = ''
                    if (files.length) onAttach(files)
                  }}
                />
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {processing ? 'hourglass_empty' : 'attach_file'}
                </span>
                {processing
                  ? 'Verwerken…'
                  : refParts.length > 1 ? `Facturen koppelen (${refParts.length})` : 'Factuur koppelen'}
              </label>
              {/* [BANK-IGNORE] Hide a transaction that needs no invoice (rent, a
                  loan instalment, a personal transfer). Goes to Genegeerd. */}
              <button
                disabled={processing}
                onClick={onIgnore}
                style={{
                  marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px', borderRadius: R.full, border: 'none', background: 'transparent',
                  cursor: processing ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, color: '#9aa0a6',
                  fontFamily: FONT,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility_off</span>
                Negeren
              </button>
            </>
          )}
        </div>
      )}

      {!wasMulti && s.outcome === 'auto' && s.best && (
        <CandidateRow cand={s.best} selected emphasis onOpenFile={onOpenFile} />
      )}

      {!wasMulti && s.outcome === 'choice' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* [BANK-CHOICE-CLARITY] Say WHY we're asking. The bank payment had no single
              invoice number to match on (e.g. a recurring incasso), so several invoices
              fit. Comparing bedrag + datum is how the owner picks the right one — the old
              bare "Factuur VHF…" list gave nothing to compare and read as a guess. */}
          <div style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, lineHeight: 1.45 }}>
            Meerdere facturen passen bij deze betaling. Vergelijk <strong>bedrag</strong> en <strong>datum</strong> en kies de juiste.
          </div>
          {s.candidates.map((c) => {
            const isSel = selectedInvoiceId === c.invoiceId
            return (
            <div
              key={c.invoiceId}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(c.invoiceId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.invoiceId) } }}
              style={{
                textAlign: 'left', border: `1.5px solid ${isSel ? M3.primary : '#E0E0E0'}`,
                background: isSel ? M3.primaryContainer : '#fff',
                borderRadius: R.md, padding: '8px 10px', cursor: 'pointer', fontFamily: FONT,
              }}
            >
              <CandidateRow cand={c} selected={isSel} inline onOpenFile={onOpenFile} />
            </div>
            )
          })}
        </div>
      )}

      {/* [BANK-PARTIAL] What this confirm will ACTUALLY do, stated before the tap.
          [PARTIAL-PAY] A partial-paid state now exists (invoices.amount_paid), and
          /api/bank/confirm books a single-invoice payment through apply_bank_payment, which
          applies LEAST(payment, remaining) and flips to 'paid' only when fully covered. So the
          comparison is against the REMAINING balance, never the full total — otherwise the very
          instalment that COMPLETES a half-paid invoice got warned about as a "deelbetaling".
          Three honest outcomes: pays part of what's left, pays exactly what's left (no warning,
          just context when something was already paid), or exceeds it (the excess is NOT booked). */}
      {!wasMulti && s.outcome !== 'none' && selectedCand && selectedCand.amount != null && (() => {
        const txAbs = Math.abs(s.amount)
        const invAbs = Math.abs(selectedCand.amount ?? 0)
        // Fall back to the full total for candidates built outside matchTransactions
        // (batch reconcile omits these fields) — same behaviour as before for those.
        const paidAlready = Math.max(0, selectedCand.amountPaid ?? 0)
        const remaining = selectedCand.remaining ?? invAbs
        const hasPartial = paidAlready > 0.005
        const under = remaining - txAbs > 0.01
        const over = txAbs - remaining > 0.01
        // Exactly settles a fully-open invoice → nothing to say.
        if (!under && !over && !hasPartial) return null
        // Neutral (blue) context when the payment fits what's left; amber only for a real surprise.
        const neutral = !over
        return (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: R.md,
            background: neutral ? M3.primaryContainer : '#FEEFC3',
            color: neutral ? M3.onPrimaryContainer : '#7A4F00',
            fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, display: 'flex', gap: 6, alignItems: 'flex-start',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
              {neutral ? 'info' : 'warning'}
            </span>
            <span>
              {over ? (
                <>Er wordt maximaal <strong>{eur.format(remaining)}</strong> op deze factuur geboekt.{' '}
                  <strong>{eur.format(txAbs - remaining)}</strong> blijft over en wordt niet geboekt — controleer of dit de juiste factuur is.</>
              ) : under ? (
                <>Deelbetaling: <strong>{eur.format(txAbs)}</strong> wordt geboekt.{' '}
                  {hasPartial && <>Er was al {eur.format(paidAlready)} betaald. </>}
                  Daarna staat nog <strong>{eur.format(remaining - txAbs)}</strong> open.</>
              ) : (
                <><strong>{eur.format(paidAlready)}</strong> al betaald · <strong>{eur.format(remaining)}</strong> restant — hiermee is de factuur volledig betaald.</>
              )}
            </span>
          </div>
        )
      })()}

      {/* Confirm */}
      {!wasMulti && s.outcome !== 'none' && (
        <button
          disabled={!selectedInvoiceId || processing}
          onClick={() => onConfirm(selectedCand?.invoiceNumber ?? null)}
          style={{
            marginTop: 12, width: '100%', padding: '11px', borderRadius: R.full, border: 'none',
            cursor: !selectedInvoiceId || processing ? 'default' : 'pointer',
            background: !selectedInvoiceId ? M3.surfaceVariant : M3.primary,
            color: !selectedInvoiceId ? '#9aa0a6' : '#fff', fontSize: 14, fontWeight: 600, fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {processing
            ? <span className="material-symbols-outlined" style={{ fontSize: 18 }}>hourglass_empty</span>
            : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>check</span> Bevestig betaling</>}
        </button>
      )}
    </div>
  )
}

// [BANK-CHOICE-CLARITY] Short, human date for a candidate invoice ("12 jun. 2026").
// The differentiator when several candidates share one amount (monthly rent, etc.).
const NL_MONTHS = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
function fmtInvoiceDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  return `${Number(m[3])} ${NL_MONTHS[Number(m[2]) - 1]} ${m[1]}`
}
// [BANK-CHOICE-CLARITY] Plain-Dutch reason a candidate is offered, from the engine's own
// match signals — so "why is this here?" is answered instead of a bare invoice number.
const WHY_LABEL: Record<string, string> = {
  amount: 'bedrag komt overeen',
  counterpart: 'zelfde tegenpartij',
  date: 'datum dichtbij',
  reference: 'nummer in omschrijving',
}

function CandidateRow({ cand, selected, emphasis, inline, onOpenFile }: { cand: Candidate; selected?: boolean; emphasis?: boolean; inline?: boolean; onOpenFile?: (invoiceId: string) => void }) {
  // [BANK-CHOICE-CLARITY] In the choice list, the engine's amount signal means this
  // invoice's total equals the bank amount — the strongest hint, so highlight it.
  const amountMatches = Array.isArray(cand.signals) && cand.signals.includes('amount')
  const why = Array.isArray(cand.signals)
    ? cand.signals.map((s) => WHY_LABEL[s]).filter(Boolean)
    : []
  return (
    <div style={{ marginTop: emphasis ? 12 : 0, padding: emphasis ? '10px 12px' : 0, borderRadius: R.md, background: emphasis ? M3.successContainer : 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: emphasis ? M3.success : M3.onSurface, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {emphasis && <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }}>task_alt</span>}
          Factuur {cand.invoiceNumber ?? '—'}
        </span>
        {/* [BANK-CHOICE-CLARITY] The amount, on the right — the first thing to compare
            when picking between candidates. Green + check when it equals the debit. */}
        {inline && cand.amount != null && (
          <span style={{
            fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
            color: amountMatches ? M3.success : M3.onSurface,
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            {amountMatches && <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>}
            {eur.format(Math.abs(cand.amount))}
          </span>
        )}
      </div>
      {/* [BANK-CHOICE-CLARITY] Second line for the choice list: the invoice date (the
          differentiator for same-amount candidates), why it matched, and its PDF. */}
      {inline && (
        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: '#5F6368' }}>
          {fmtInvoiceDate(cand.invoiceDate) && <span>{fmtInvoiceDate(cand.invoiceDate)}</span>}
          {why.length > 0 && <span style={{ color: amountMatches ? M3.success : '#5F6368', fontWeight: amountMatches ? 600 : 400 }}>· {why.join(' · ')}</span>}
          {onOpenFile && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenFile(cand.invoiceId) }}
              // [A11Y] The row wrapper is a role=button that selects on Enter/Space; stop
              // the key event here so opening the PDF doesn't ALSO select the candidate.
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto',
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>
              Bekijk factuur
            </button>
          )}
        </div>
      )}
      {!inline && (
        <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* [BANK-PROOF-LINE] Instead of an algorithmic "97%" + cryptic Kenmerk/Bedrag
              chips, state in plain Dutch WHY this is a safe confirm: the amount and the
              invoice number shown at the top of the card both come straight from the
              owner's own bank statement. The owner verifies against a trusted source
              (their bank), not the app's confidence score. Only on a strong (emphasis)
              match; the choice list shows nothing extra. */}
          {emphasis && (
            <span style={{ fontSize: 11.5, color: M3.success, fontWeight: 500 }}>
              {/* [BANK-PSP-MATCH] Honest proof line: only claim the factuurnummer is in the
                  statement when the reference signal actually fired. An amount+counterpart
                  match (a PSP/order payment) has NO invoice number in the statement, so we
                  say only that the amount matches — never invent a reference that isn't there. */}
              {Array.isArray(cand.signals) && cand.signals.includes('reference')
                ? 'Dit bedrag en factuurnummer staan in je bankafschrift'
                : 'Dit bedrag komt overeen met je bankafschrift'}
            </span>
          )}
          {/* [BANK-INVOICE-FILE] Open the actual invoice PDF before confirming. */}
          {onOpenFile && (
            <button
              onClick={() => onOpenFile(cand.invoiceId)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>description</span>
              Bekijk factuur
            </button>
          )}
        </div>
      )}
    </div>
  )
}