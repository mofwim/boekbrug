'use client'

// src/app/dashboard/bank/BankClient.tsx
// [BOEK-016] Bank reconciliation UI — Material You (BoekBrug Design System v1.0), mobile-first.
// Flow: upload bankafschrift → /api/bank/upload → /api/bank/match → review suggestions → confirm.
// Philosophy: AI suggests, the human confirms. 'auto' = pre-filled (still one tap to confirm).

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ─── Design tokens — mirrors BoekBrug Design System v1.0 (FacturenClient) ────
const M3 = {
  primary: '#1A73E8',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3E3FD',
  onPrimaryContainer: '#041E49',
  surface: '#FFFBFE',
  onSurface: '#1C1B1F',
  surfaceVariant: '#E7E0EC',
  outline: '#79747E',
  error: '#B3261E',
  errorContainer: '#F9DEDC',
  success: '#137333',
  successContainer: '#CEEAD6',
  warning: '#E37400',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const R = { sm: 8, md: 12, lg: 16, full: 9999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

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

const SIGNAL_LABEL: Record<string, string> = {
  reference: 'Kenmerk',
  amount: 'Bedrag',
  date: 'Datum',
  counterpart: 'Tegenpartij',
  ai: 'AI',
}

// ─── Types (mirror the /api/bank/match DTO) ──────────────────────────────────
type Outcome = 'auto' | 'choice' | 'none'
interface Candidate {
  invoiceId: string
  invoiceNumber: string | null
  confidence: number
  signals: string[]
  reason: string
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
}
interface MatchResponse {
  ok: boolean
  summary: { pending: number; auto: number; choice: number; none: number }
  suggestions: Suggestion[]
}

export default function BankClient() {
  const [busy, setBusy] = useState(false)
  const [uploadInfo, setUploadInfo] = useState<{ format: string; parsed: number; inserted: number; skipped: number } | null>(null)
  // [BANK-STATEMENTS] Uploaded statements (filename + upload time) and the
  // "refresh names" action that upgrades older rows' names from their description.
  const [statements, setStatements] = useState<{ id: string; name: string; uploadedAt: string; size: number }[] | null>(null)
  const [refreshingNames, setRefreshingNames] = useState(false)
  const [data, setData] = useState<MatchResponse | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({}) // txId → invoiceId
  // [BANK-MULTI-CONFIRM] One transaction can cover several invoices, so we track
  // ALL invoice numbers confirmed this session per transaction, plus whether the
  // backend reported every reference number as covered (allCovered). The tx only
  // counts as "done" (→ Gekoppeld, leaves Te bevestigen) once allCovered is true.
  const [confirmed, setConfirmed] = useState<Record<string, { numbers: string[]; allCovered: boolean }>>({}) // txId → confirmation state
  const [processingId, setProcessingId] = useState<string | null>(null)
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
      } catch {
        /* silent — empty state shows the upload card */
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Upload → match ──────────────────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return

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
      setUploadInfo({ format: upJson.format, parsed: upJson.parsed, inserted: upJson.inserted, skipped: upJson.skipped })

      // Run matching (shared with initial load)
      await runMatch()
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setBusy(false)
    }
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
        showToast(
          json?.warning === 'transaction_link_failed'
            ? 'Factuur betaald (koppeling volgt later).'
            : allCovered
              ? 'Gekoppeld en gemarkeerd als betaald ✓'
              : 'Factuur betaald ✓ · nog een factuur open'
        )
        // [BANK-MULTI-CONFIRM] Re-run matching so the just-paid invoice drops out of
        // the candidate list and any remaining open number is re-evaluated. Without
        // this the paid invoice would linger as a still-selectable candidate.
        if (!allCovered) await runMatch()
      } else if (json?.error === 'verwerkt') {
        setVerwerktCtx({ number: json.invoiceNumber ?? invoiceNumber ?? '' })
      } else if (json?.error === 'invoice_already_paid') {
        showToast('Deze factuur is al betaald.')
      } else {
        showToast('Bevestigen mislukt.')
      }
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-ATTACH] Owner uploads the file that belongs to an unmatched expense
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
        const form = new FormData()
        form.append('file', file)
        form.append('transactionId', txId)
        form.append('direction', isCredit ? 'outgoing' : 'incoming')
        const res = await fetch('/api/bank/attach-invoice', { method: 'POST', body: form })
        const json = await res.json()
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
  const isDone = (txId: string) => confirmed[txId]?.allCovered === true
  const pending = data?.suggestions.filter((s) => !isDone(s.transactionId)) ?? []

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
  //   Te bevestigen : auto + choice (a real candidate exists → owner confirms)
  //   Geen factuur  : none, EXCLUDING POS receipts (real suppliers without invoice)
  //   Pin           : POS card settlements (bulk, no invoice — normal)
  //   Genegeerd     : owner-ignored (not_found)
  //   Gekoppeld     : confirmed this session
  const toConfirm = pending.filter((s) => s.outcome === 'auto' || s.outcome === 'choice').sort(byDateDesc)
  const noneAll = pending.filter((s) => s.outcome === 'none')
  const noMatch = noneAll.filter((s) => !isPosReceipt(s)).sort(byDateDesc)
  const posList = noneAll.filter(isPosReceipt).sort(byDateDesc)
  const confirmedList = (data?.suggestions ?? []).filter((s) => isDone(s.transactionId)).sort(byDateDesc)

  const tabs = [
    { key: 'confirm' as const, label: 'Te bevestigen', icon: 'fact_check', count: toConfirm.length },
    { key: 'none' as const, label: 'Geen factuur', icon: 'help', count: noMatch.length },
    { key: 'pin' as const, label: 'Pinontvangsten', icon: 'point_of_sale', count: posList.length },
    { key: 'ignored' as const, label: 'Genegeerd', icon: 'visibility_off', count: ignoredList?.length ?? 0 },
    { key: 'done' as const, label: 'Gekoppeld', icon: 'link', count: confirmedList.length },
  ]
  const activeListRaw =
    bankTab === 'confirm' ? toConfirm
    : bankTab === 'none' ? noMatch
    : bankTab === 'pin' ? posList
    : bankTab === 'ignored' ? (ignoredList ?? [])
    : confirmedList

  // [BANK-FILTER] Only the "Geen factuur" tab is filtered (the long one). The
  // filter is a simple case-insensitive substring over name + reference + date.
  const activeList =
    bankTab === 'none' && filterText.trim()
      ? activeListRaw.filter((s) => {
          const q = filterText.trim().toLowerCase()
          return (
            (s.counterpart ?? '').toLowerCase().includes(q) ||
            (s.reference ?? '').toLowerCase().includes(q) ||
            (s.date ?? '').toLowerCase().includes(q)
          )
        })
      : activeListRaw

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px', fontFamily: FONT, color: M3.onSurface }}>
      {/* Back to parent (/dashboard) — navigation strategy: <Link>, never router.back() */}
      <Link
        href="/dashboard"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: M3.primary, fontSize: 14, fontWeight: 600, textDecoration: 'none', marginBottom: 10 }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
        Terug
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 26, color: M3.primary }}>account_balance</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bank</h1>
      </div>
      <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 18px', lineHeight: 1.5 }}>
        Upload je bankafschrift. We koppelen transacties aan je facturen — jij bevestigt.
      </p>

      {/* Upload card */}
      <label
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '28px 16px', borderRadius: R.lg, cursor: busy ? 'default' : 'pointer',
          border: `1.5px dashed ${M3.primary}`, background: M3.primaryContainer, textAlign: 'center',
          opacity: busy ? 0.7 : 1, transition: 'all 0.15s',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 32, color: M3.primary }}>
          {busy ? 'hourglass_empty' : 'upload_file'}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: M3.onPrimaryContainer }}>
          {busy ? 'Bezig…' : 'Kies bankafschrift'}
        </span>
        <span style={{ fontSize: 12, color: '#41618a' }}>CAMT.053 (.xml) of MT940 (.sta / .txt)</span>
        <input type="file" accept=".xml,.sta,.mt940,.txt" onChange={handleFile} disabled={busy} style={{ display: 'none' }} />
      </label>

      {/* Upload summary */}
      {uploadInfo && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: R.md, background: M3.surface, boxShadow: EL1, fontSize: 13, color: '#3c4043' }}>
          <strong>{uploadInfo.format}</strong> · {uploadInfo.parsed} transacties gelezen ·{' '}
          {uploadInfo.inserted} nieuw{uploadInfo.skipped > 0 ? ` · ${uploadInfo.skipped} dubbel overgeslagen` : ''}
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
            <div key={st.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F7F7F7' }}>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#9aa0a6', flexShrink: 0 }}>description</span>
                <span style={{ fontSize: 13, color: '#3c4043', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {st.name}
                </span>
              </div>
              <span style={{ fontSize: 11.5, color: '#9aa0a6', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {fmtUploadDate(st.uploadedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* [BANK-TABS] Tabs — only once we have data with at least one transaction */}
      {data && (toConfirm.length + noMatch.length + posList.length + confirmedList.length + (ignoredList?.length ?? 0)) > 0 && (
        <>
          {/* [BANK-CHIPS] Chips grid instead of a horizontal scroll bar: every tab
              is visible at once and wraps to the next line on narrow screens — no
              hidden horizontal scroll the owner can miss. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
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

          {/* "Geen factuur" context — POS receipts naturally have no invoice */}
          {bankTab === 'none' && noMatch.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#5F6368', margin: '12px 2px 0', lineHeight: 1.5 }}>
              Leveranciers zonder gevonden factuur. Koppel het bestand, of negeer de transactie als er geen factuur bij hoort (zoals huur of een lening).
            </p>
          )}

          {/* [BANK-FILTER] Search field for the long "Geen factuur" list. */}
          {bankTab === 'none' && noMatch.length > 0 && (
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
          {/* Empty-filter hint */}
          {bankTab === 'none' && filterText.trim() && activeList.length === 0 && (
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
            {activeList.map((s) => (
              <TxCard
                key={s.transactionId}
                s={s}
                selectedInvoiceId={selected[s.transactionId]}
                processing={processingId === s.transactionId}
                isIgnoredTab={bankTab === 'ignored'}
                confirmedNumbers={confirmed[s.transactionId]?.numbers ?? []}
                onSelect={(invId) => setSelected((sel) => ({ ...sel, [s.transactionId]: invId }))}
                onConfirm={(num, invId) => confirm(s.transactionId, num, invId)}
                onAttach={(files) => attachFile(s.transactionId, files, s.amount >= 0)}
                onIgnore={() => ignoreTx(s.transactionId)}
                onRestore={() => restoreTx(s.transactionId)}
                onOpenFile={openInvoiceFile}
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

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: '#1C1B1F', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.sm, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '90vw', textAlign: 'center', fontFamily: FONT }}>
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
  s, selectedInvoiceId, processing, isIgnoredTab, confirmedNumbers, onSelect, onConfirm, onAttach, onIgnore, onRestore, onOpenFile,
}: {
  s: Suggestion
  selectedInvoiceId: string | undefined
  processing: boolean
  isIgnoredTab: boolean
  confirmedNumbers: string[]
  onSelect: (invoiceId: string) => void
  onConfirm: (invoiceNumber: string | null, invoiceId?: string) => void
  onAttach: (files: File[]) => void
  onIgnore: () => void
  onRestore: () => void
  onOpenFile: (invoiceId: string) => void
}) {
  const isCredit = s.amount >= 0
  const amountColor = isCredit ? M3.success : M3.error
  // [BANK-DETAILS] Like the ING app, the card shows a clean name and lets the
  // owner expand the FULL original description (Pasvolgnr, Transactienr, Google
  // Pay, etc.) on demand — useful to verify a payment, and it reveals the real
  // counterpart even on older rows whose stored name is still "Onbekende".
  const [showDetails, setShowDetails] = useState(false)
  const hasDetails = !!(s.description && s.description.trim())
  // [BANK-REF-DISPLAY] Build a compact label from the extracted reference. One
  // number → show it; several (comma-separated, a multi-invoice payment) → show
  // "N facturen" so the card stays clean and signals the multi-invoice case.
  const refParts = (s.reference ?? '').split(',').map((r) => r.trim()).filter(Boolean)
  const refLabel =
    refParts.length === 0 ? null
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
  const isMulti = refParts.length > 1 && !isIgnoredTab
  // Match a reference number to a candidate by normalized-equal invoice number
  // (same normalization as the matcher: lowercase, keep [a-z0-9]). Equality — not
  // substring — so "263" can't claim "26302050".
  const normRef = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
  const confirmedSet = new Set(confirmedNumbers.map(normRef))
  const slots = isMulti
    ? refParts.map((refNum) => {
        const key = normRef(refNum)
        const cand = s.candidates.find((c) => normRef(c.invoiceNumber ?? '') === key) ?? null
        const isConfirmed = confirmedSet.has(key)
        return { refNum, cand, isConfirmed }
      })
    : []
  const openCount = slots.filter((sl) => !sl.isConfirmed).length

  return (
    <div style={{ borderRadius: R.lg, background: M3.surface, boxShadow: EL1, padding: 14, border: `1px solid #EEE` }}>
      {/* Transaction row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
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
          bestand). The transaction stays here until every row is confirmed. */}
      {isMulti && (
        <div style={{ marginTop: 12 }}>
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
            ))}
          </div>

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
      {!isMulti && s.outcome === 'none' && (
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

      {!isMulti && s.outcome === 'auto' && s.best && (
        <CandidateRow cand={s.best} selected emphasis onOpenFile={onOpenFile} />
      )}

      {!isMulti && s.outcome === 'choice' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#5F6368', marginBottom: 2 }}>Kies de juiste factuur:</div>
          {s.candidates.map((c) => (
            <button
              key={c.invoiceId}
              onClick={() => onSelect(c.invoiceId)}
              style={{
                textAlign: 'left', border: `1.5px solid ${selectedInvoiceId === c.invoiceId ? M3.primary : '#E0E0E0'}`,
                background: selectedInvoiceId === c.invoiceId ? M3.primaryContainer : '#fff',
                borderRadius: R.md, padding: '8px 10px', cursor: 'pointer', fontFamily: FONT,
              }}
            >
              <CandidateRow cand={c} selected={selectedInvoiceId === c.invoiceId} inline />
            </button>
          ))}
        </div>
      )}

      {/* Confirm */}
      {!isMulti && s.outcome !== 'none' && (
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

function CandidateRow({ cand, selected, emphasis, inline, onOpenFile }: { cand: Candidate; selected?: boolean; emphasis?: boolean; inline?: boolean; onOpenFile?: (invoiceId: string) => void }) {
  return (
    <div style={{ marginTop: emphasis ? 12 : 0, padding: emphasis ? '10px 12px' : 0, borderRadius: R.md, background: emphasis ? M3.successContainer : 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: emphasis ? M3.success : M3.onSurface }}>
          {emphasis && <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }}>task_alt</span>}
          Factuur {cand.invoiceNumber ?? '—'}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#5F6368' }}>{Math.round(cand.confidence * 100)}%</span>
      </div>
      {!inline && (
        <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {cand.signals.map((sig) => (
            <span key={sig} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: R.full, background: '#fff', color: '#5F6368', border: '1px solid #E0E0E0' }}>
              {SIGNAL_LABEL[sig] ?? sig}
            </span>
          ))}
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