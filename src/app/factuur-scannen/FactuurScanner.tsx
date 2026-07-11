'use client'

// src/app/factuur-scannen/FactuurScanner.tsx
// [SCAN-TOOL] AI invoice scanner (client). Uploads a PDF/photo to
// /api/tools/scan-invoice, shows the extracted fields, and funnels to the
// invoice generator / register. A 3-scans-per-day cap lives in localStorage as
// UX friction; the real cost/abuse guard is the per-IP rate limit on the API.

import React, { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL } from '@/lib/format-nl'

const DAILY_CAP = 3
const CAP_KEY = 'boekbrug.factuur-scannen.usage'
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const MAX_BYTES = 8 * 1024 * 1024

interface BtwLine {
  rate?: number | null
  base?: number | null
  amount?: number | null
}
interface LineItem {
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  amount?: number | null
}
interface ScanResult {
  is_invoice?: boolean
  confidence?: number
  document_type?: string
  vendor_name?: string | null
  vendor_vat?: string | null
  vendor_kvk?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  due_date?: string | null
  currency?: string | null
  iban?: string | null
  line_items?: LineItem[]
  subtotal_excl_btw?: number | null
  btw_lines?: BtwLine[]
  btw_total?: number | null
  total_incl_btw?: number | null
}

// localStorage usage: { day: 'YYYY-MM-DD', count: number }
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function readUsage(): number {
  try {
    const raw = localStorage.getItem(CAP_KEY)
    if (!raw) return 0
    const u = JSON.parse(raw) as { day?: string; count?: number }
    if (u.day !== today()) return 0
    return typeof u.count === 'number' ? u.count : 0
  } catch {
    return 0
  }
}
function bumpUsage(): void {
  try {
    localStorage.setItem(CAP_KEY, JSON.stringify({ day: today(), count: readUsage() + 1 }))
  } catch {
    /* ignore */
  }
}

const euro = (v: number | null | undefined) => (typeof v === 'number' && !Number.isNaN(v) ? formatEuroNL(v) : '—')

const s = {
  card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', border: '1px solid #ececf1' } as React.CSSProperties,
  drop: { border: '2px dashed #c7c7cc', borderRadius: 16, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', backgroundColor: '#f9f9fb', transition: 'border-color 0.15s, background 0.15s' } as React.CSSProperties,
  dropActive: { borderColor: '#007aff', backgroundColor: '#eef5ff' } as React.CSSProperties,
  primary: { backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '12px 22px', borderRadius: 9999, border: 'none', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' } as React.CSSProperties,
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '9px 0', borderBottom: '1px solid #f0f0f4' } as React.CSSProperties,
  key: { color: '#6b6b6e', flexShrink: 0 } as React.CSSProperties,
  val: { color: '#1c1c1e', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' } as React.CSSProperties,
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.key}>{label}</span>
      <span style={s.val}>{value ?? '—'}</span>
    </div>
  )
}

export default function FactuurScanner() {
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [used, setUsed] = useState<number | null>(null) // null until first client read
  const inputRef = useRef<HTMLInputElement>(null)

  const remaining = useMemo(() => (used === null ? DAILY_CAP : Math.max(0, DAILY_CAP - used)), [used])

  async function handleFile(file: File) {
    setError(null)
    setResult(null)

    const current = readUsage()
    setUsed(current)
    if (current >= DAILY_CAP) {
      setError(`Je hebt vandaag ${DAILY_CAP} facturen gescand. Kom morgen terug of maak een gratis account voor onbeperkt scannen.`)
      return
    }
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Alleen PDF, JPG, PNG of WebP wordt ondersteund.')
      return
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      setError('Het bestand is te groot (max 8 MB) of leeg.')
      return
    }

    setBusy(true)
    setFileName(file.name)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/tools/scan-invoice', { method: 'POST', body: form })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError((json && json.error) || 'Het scannen is mislukt. Probeer het opnieuw.')
        return
      }
      // Only count a scan that actually reached the model and returned.
      bumpUsage()
      setUsed(readUsage())
      setResult((json?.data as ScanResult) ?? null)
    } catch {
      setError('Kon geen verbinding maken. Controleer je internet en probeer opnieuw.')
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }

  const lowConfidence = result && typeof result.confidence === 'number' && result.confidence < 0.5
  const notInvoice = result && result.is_invoice === false

  return (
    <div style={s.card}>
      {!result && (
        <>
          <div
            style={{ ...s.drop, ...(dragging ? s.dropActive : {}) }}
            onClick={() => !busy && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click() }}
            aria-label="Factuur uploaden"
          >
            {busy ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e' }}>Bezig met scannen…</div>
                <div style={{ fontSize: 13, color: '#aeaeb2', marginTop: 6 }}>{fileName}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1c1c1e' }}>Sleep je factuur hierheen of klik om te uploaden</div>
                <div style={{ fontSize: 13, color: '#aeaeb2', marginTop: 6 }}>PDF, JPG, PNG of WebP · max 8 MB</div>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
          />
          <div style={{ fontSize: 12, color: '#aeaeb2', marginTop: 12, textAlign: 'center' }}>
            {remaining > 0
              ? `Nog ${remaining} gratis ${remaining === 1 ? 'scan' : 'scans'} vandaag`
              : 'Je gratis scans voor vandaag zijn op'}
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 16, background: '#fff4f4', border: '1px solid #ffd4d4', color: '#c0392b', borderRadius: 12, padding: '12px 16px', fontSize: 14 }}>
          {error}
        </div>
      )}

      {result && (
        <div>
          {(notInvoice || lowConfidence) && (
            <div style={{ background: '#fff8e6', border: '1px solid #ffe1a3', color: '#8a6d1f', borderRadius: 12, padding: '12px 16px', fontSize: 14, marginBottom: 16 }}>
              {notInvoice
                ? 'Dit lijkt geen factuur te zijn. Controleer het bestand of probeer een andere.'
                : 'De herkenning is onzeker. Controleer de velden extra goed.'}
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b6b6e', marginBottom: 8 }}>Uitgelezen gegevens</div>

          <Field label="Leverancier" value={result.vendor_name} />
          <Field label="BTW-nummer" value={result.vendor_vat} />
          <Field label="KvK" value={result.vendor_kvk} />
          <Field label="Factuurnummer" value={result.invoice_number} />
          <Field label="Factuurdatum" value={result.invoice_date} />
          <Field label="Vervaldatum" value={result.due_date} />
          <Field label="IBAN" value={result.iban} />
          <Field label="Subtotaal (excl. BTW)" value={euro(result.subtotal_excl_btw)} />
          {(result.btw_lines ?? []).map((b, i) => (
            <Field
              key={i}
              label={`BTW ${typeof b.rate === 'number' ? String(b.rate).replace('.', ',') + '%' : ''}`}
              value={euro(b.amount)}
            />
          ))}
          <Field label="BTW totaal" value={euro(result.btw_total)} />
          <div style={{ ...s.row, borderBottom: 'none' }}>
            <span style={{ ...s.key, color: '#1c1c1e', fontWeight: 700 }}>Totaal (incl. BTW)</span>
            <span style={{ ...s.val, fontWeight: 800 }}>{euro(result.total_incl_btw)}</span>
          </div>

          {(result.line_items?.length ?? 0) > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#6b6b6e', marginBottom: 8 }}>Regels</div>
              {result.line_items!.map((li, i) => (
                <div key={i} style={{ ...s.row }}>
                  <span style={s.key}>{li.description || `Regel ${i + 1}`}</span>
                  <span style={s.val}>{euro(li.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button style={s.primary} onClick={() => { setResult(null); setError(null); setFileName(null) }}>
              Nog een factuur scannen
            </button>
            <Link href="/factuur-maken" style={{ ...s.primary, backgroundColor: '#fff', color: '#007aff', border: '1.5px solid #007aff' }}>
              Zelf een factuur maken →
            </Link>
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, background: '#f9f9fb', border: '1px solid #ececf1', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#3c3c43' }}>
          Onbeperkt scannen én automatisch boeken?{' '}
          <strong style={{ color: '#1c1c1e' }}>BoekBrug doet het voor je.</strong>
        </div>
        <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 9999, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Gratis proberen →
        </Link>
      </div>
    </div>
  )
}
