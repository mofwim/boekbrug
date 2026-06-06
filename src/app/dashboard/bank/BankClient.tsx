'use client'

// src/app/dashboard/bank/BankClient.tsx
// [BOEK-016] Bank reconciliation UI — Material You (BoekBrug Design System v1.0), mobile-first.
// Flow: upload bankafschrift → /api/bank/upload → /api/bank/match → review suggestions → confirm.
// Philosophy: AI suggests, the human confirms. 'auto' = pre-filled (still one tap to confirm).

import { useState } from 'react'
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
  const [data, setData] = useState<MatchResponse | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({}) // txId → invoiceId
  const [confirmed, setConfirmed] = useState<Record<string, string>>({}) // txId → invoiceNumber
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [verwerktCtx, setVerwerktCtx] = useState<{ number: string } | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

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

      // Run matching
      const mr = await fetch('/api/bank/match')
      const mrJson: MatchResponse = await mr.json()
      if (!mr.ok) {
        showToast('Matchen mislukt.')
        setBusy(false)
        return
      }
      setData(mrJson)
      // Pre-fill 'auto' selections with their best candidate.
      const pre: Record<string, string> = {}
      for (const s of mrJson.suggestions) {
        if (s.outcome === 'auto' && s.best) pre[s.transactionId] = s.best.invoiceId
      }
      setSelected(pre)
    } catch {
      showToast('Er ging iets mis.')
    } finally {
      setBusy(false)
    }
  }

  // ── Confirm one match ─────────────────────────────────────────────────────────
  async function confirm(txId: string, invoiceNumber: string | null) {
    const invoiceId = selected[txId]
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
        setConfirmed((c) => ({ ...c, [txId]: invoiceNumber ?? '' }))
        showToast(json?.warning === 'transaction_link_failed'
          ? 'Factuur betaald (koppeling volgt later).'
          : 'Gekoppeld en gemarkeerd als betaald ✓')
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

  const summary = data?.summary
  const pending = data?.suggestions.filter((s) => !confirmed[s.transactionId]) ?? []

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

      {/* Summary chips */}
      {summary && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Chip icon="task_alt" label={`${summary.auto} automatisch`} bg={M3.successContainer} color={M3.success} />
          <Chip icon="rule" label={`${summary.choice} keuze`} bg="#FEF7E0" color={M3.warning} />
          <Chip icon="help" label={`${summary.none} geen match`} bg={M3.surfaceVariant} color="#49454F" />
        </div>
      )}

      {/* Suggestions */}
      {data && pending.length === 0 && (
        <Empty done={Object.keys(confirmed).length > 0} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {pending.map((s) => (
          <TxCard
            key={s.transactionId}
            s={s}
            selectedInvoiceId={selected[s.transactionId]}
            processing={processingId === s.transactionId}
            onSelect={(invId) => setSelected((sel) => ({ ...sel, [s.transactionId]: invId }))}
            onConfirm={(num) => confirm(s.transactionId, num)}
          />
        ))}
      </div>

      {/* Confirmed list (collapsed feedback) */}
      {Object.keys(confirmed).length > 0 && (
        <div style={{ marginTop: 22, fontSize: 12.5, color: '#5F6368' }}>
          {Object.keys(confirmed).length} gekoppeld in deze sessie ✓
        </div>
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

function Chip({ icon, label, bg, color }: { icon: string; label: string; bg: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: R.full, background: bg, color, fontSize: 12.5, fontWeight: 600 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{icon}</span>
      {label}
    </span>
  )
}

function Empty({ done }: { done: boolean }) {
  return (
    <div style={{ marginTop: 28, textAlign: 'center', color: '#9aa0a6' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 40 }}>{done ? 'done_all' : 'inbox'}</span>
      <p style={{ fontSize: 13.5, marginTop: 6 }}>{done ? 'Alles afgehandeld.' : 'Nog geen transacties om te koppelen.'}</p>
    </div>
  )
}

function TxCard({
  s, selectedInvoiceId, processing, onSelect, onConfirm,
}: {
  s: Suggestion
  selectedInvoiceId: string | undefined
  processing: boolean
  onSelect: (invoiceId: string) => void
  onConfirm: (invoiceNumber: string | null) => void
}) {
  const isCredit = s.amount >= 0
  const amountColor = isCredit ? M3.success : M3.error
  const selectedCand =
    s.candidates.find((c) => c.invoiceId === selectedInvoiceId) ?? (s.outcome === 'auto' ? s.best : null)

  return (
    <div style={{ borderRadius: R.lg, background: M3.surface, boxShadow: EL1, padding: 14, border: `1px solid #EEE` }}>
      {/* Transaction row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.counterpart || 'Onbekende tegenpartij'}
          </div>
          <div style={{ fontSize: 12, color: '#5F6368', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.date} · {s.description || '—'}
          </div>
        </div>
        <div style={{ fontFamily: FONT_NUM, fontSize: 14.5, fontWeight: 700, color: amountColor, whiteSpace: 'nowrap' }}>
          {isCredit ? '+' : '−'}{eur.format(Math.abs(s.amount))}
        </div>
      </div>

      {/* Match body */}
      {s.outcome === 'none' && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#9aa0a6', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>help</span>
          Geen factuur gevonden voor deze transactie.
        </div>
      )}

      {s.outcome === 'auto' && s.best && (
        <CandidateRow cand={s.best} selected emphasis />
      )}

      {s.outcome === 'choice' && (
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
      {s.outcome !== 'none' && (
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

function CandidateRow({ cand, selected, emphasis, inline }: { cand: Candidate; selected?: boolean; emphasis?: boolean; inline?: boolean }) {
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
        <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {cand.signals.map((sig) => (
            <span key={sig} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: R.full, background: '#fff', color: '#5F6368', border: '1px solid #E0E0E0' }}>
              {SIGNAL_LABEL[sig] ?? sig}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}