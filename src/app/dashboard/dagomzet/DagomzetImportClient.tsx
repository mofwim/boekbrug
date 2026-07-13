'use client'

// src/app/dashboard/dagomzet/DagomzetImportClient.tsx
// [TURNOVER-IMPORT] The minimal review-and-confirm screen for a till Z-report. Goal is
// TRUST, not decoration: upload → see exactly what was read (days, turnover, BTW split,
// payment split) + every warning → approve or reject. Nothing is stored until the owner
// approves. Parse/normalize live server-side (/api/turnover/import); this only shows the
// preview it returns and posts the confirmed rows back.

import { useState, type ChangeEvent, type CSSProperties } from 'react'
import Link from 'next/link'

const M3 = {
  primary: '#1A73E8', onPrimary: '#fff', onSurface: '#1C1B1F', neutral: '#5F6368',
  surface: '#FFFFFF', outlineVariant: '#E0E0E0', success: '#137333', error: '#B3261E',
  warning: '#7C5800', warningContainer: '#FEE8C4', primaryContainer: '#D3E3FD',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface TurnoverRow {
  turnover_date: string
  base_0: number; base_9: number; base_21: number
  btw_9: number; btw_21: number
  total_incl: number | null
  pin_amount: number | null; cash_amount: number | null; other_amount: number | null
}
interface Warning { row: number; code: string; message: string }
interface Preview { rows: TurnoverRow[]; warnings: Warning[]; count: number }

const sum = (rows: TurnoverRow[], pick: (r: TurnoverRow) => number | null) =>
  rows.reduce((s, r) => s + (pick(r) ?? 0), 0)

export default function DagomzetImportClient() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ committed: number } | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setError(''); setDone(null); setPreview(null); setFileName(file.name); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/turnover/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Kon het bestand niet lezen'); return }
      setPreview({ rows: json.rows ?? [], warnings: json.warnings ?? [], count: json.count ?? 0 })
    } catch {
      setError('Er ging iets mis bij het lezen van het bestand')
    } finally { setBusy(false) }
  }

  async function approve() {
    if (!preview || preview.rows.length === 0) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/turnover/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: preview.rows }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Opslaan mislukt'); return }
      setDone({ committed: json.committed ?? preview.rows.length })
      setPreview(null); setFileName(null)
    } catch {
      setError('Opslaan mislukt')
    } finally { setBusy(false) }
  }

  function reject() { setPreview(null); setFileName(null); setError('') }

  const rows = preview?.rows ?? []
  const totalTurnover = sum(rows, (r) => r.total_incl)
  const netOmzet = sum(rows, (r) => r.base_0 + r.base_9 + r.base_21)
  const btw9 = sum(rows, (r) => r.btw_9)
  const btw21 = sum(rows, (r) => r.btw_21)
  const pin = sum(rows, (r) => r.pin_amount)
  const cash = sum(rows, (r) => r.cash_amount)
  const dateFrom = rows.length ? rows.map((r) => r.turnover_date).sort()[0] : null
  const dateTo = rows.length ? rows.map((r) => r.turnover_date).sort().slice(-1)[0] : null

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <Link href="/dashboard" style={{ fontSize: 14, color: M3.primary, textDecoration: 'none' }}>← Terug</Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, margin: '12px 0 4px' }}>Dagomzet importeren</h1>
        <p style={{ fontSize: 14, color: M3.neutral, margin: '0 0 20px', lineHeight: 1.5 }}>
          Upload het Z-rapport van de kassa (.xls, .xlsx of .csv). Je ziet eerst precies wat er is gelezen —
          er wordt niets opgeslagen tot je op <b>Goedkeuren</b> klikt.
        </p>

        {/* Upload */}
        <label style={{
          display: 'block', border: `2px dashed ${M3.outlineVariant}`, borderRadius: 14, padding: '22px 16px',
          textAlign: 'center', cursor: busy ? 'default' : 'pointer', background: M3.surface, marginBottom: 16,
        }}>
          <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => void handleFile(e)} disabled={busy} style={{ display: 'none' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: M3.primary }}>
            {busy && !preview ? 'Bezig met lezen…' : fileName ? `Ander bestand kiezen (${fileName})` : 'Kies een Z-rapport'}
          </div>
          <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 4 }}>xls · xlsx · csv</div>
        </label>

        {error && (
          <div style={{ background: '#FCE8E6', color: M3.error, borderRadius: 10, padding: '12px 14px', fontSize: 14, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {done && (
          <div style={{ background: '#E6F4EA', color: M3.success, borderRadius: 10, padding: '14px 16px', fontSize: 14.5, fontWeight: 600 }}>
            ✓ {done.committed} {done.committed === 1 ? 'dag' : 'dagen'} dagomzet opgeslagen.
          </div>
        )}

        {/* Review */}
        {preview && (
          <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
              <div style={{ fontSize: 13, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
                Gelezen uit {fileName}
              </div>
              {preview.count === 0 ? (
                <div style={{ fontSize: 14, color: M3.warning }}>Geen dagen met omzet gevonden in dit bestand.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Stat label="Dagen" value={String(preview.count)} sub={dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : undefined} />
                  <Stat label="Totale omzet (incl.)" value={eur.format(totalTurnover)} sub={`netto ${eur.format(netOmzet)}`} />
                  <Stat label="BTW gedetecteerd" value={eur.format(btw9 + btw21)} sub={`9%: ${eur.format(btw9)} · 21%: ${eur.format(btw21)}`} />
                  <Stat label="Betaalwijzen" value={`PIN ${eur.format(pin)}`} sub={`contant ${eur.format(cash)}`} />
                </div>
              )}
            </div>

            {/* Warnings — the trust signal */}
            {preview.warnings.length > 0 && (
              <div style={{ padding: '14px 18px', background: M3.warningContainer, borderBottom: `1px solid ${M3.outlineVariant}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: M3.warning, marginBottom: 6 }}>
                  ⚠ {preview.warnings.length} {preview.warnings.length === 1 ? 'aandachtspunt' : 'aandachtspunten'}
                </div>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {preview.warnings.map((w, i) => (
                    <li key={i} style={{ fontSize: 13, color: M3.onSurface, lineHeight: 1.5 }}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Per-day table (scrollable) */}
            {preview.count > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: FONT_NUM }}>
                  <thead>
                    <tr style={{ color: M3.neutral, textAlign: 'right' }}>
                      <th style={thL}>Datum</th><th style={thR}>Omzet incl.</th>
                      <th style={thR}>BTW 9%</th><th style={thR}>BTW 21%</th>
                      <th style={thR}>PIN</th><th style={thR}>Contant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.turnover_date} style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
                        <td style={{ ...tdL, fontFamily: FONT }}>{r.turnover_date}</td>
                        <td style={tdR}>{eur.format(r.total_incl ?? 0)}</td>
                        <td style={tdR}>{eur.format(r.btw_9)}</td>
                        <td style={tdR}>{eur.format(r.btw_21)}</td>
                        <td style={tdR}>{r.pin_amount == null ? '—' : eur.format(r.pin_amount)}</td>
                        <td style={tdR}>{r.cash_amount == null ? '—' : eur.format(r.cash_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, padding: '16px 18px' }}>
              <button onClick={() => void approve()} disabled={busy || preview.count === 0}
                style={{ flex: 1, background: preview.count === 0 ? M3.outlineVariant : M3.primary, color: M3.onPrimary,
                  border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 15, fontWeight: 600,
                  cursor: busy || preview.count === 0 ? 'default' : 'pointer', fontFamily: FONT }}>
                {busy ? 'Bezig…' : 'Goedkeuren en opslaan'}
              </button>
              <button onClick={reject} disabled={busy}
                style={{ background: 'transparent', color: M3.neutral, border: `1px solid ${M3.outlineVariant}`,
                  borderRadius: 10, padding: '12px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                Afwijzen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#5F6368', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1C1B1F', fontFamily: "'Google Sans','Roboto Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#5F6368', marginTop: 2, fontFamily: "'Google Sans','Roboto Mono',monospace" }}>{sub}</div>}
    </div>
  )
}

const thL: CSSProperties = { textAlign: 'left', padding: '10px 14px', fontWeight: 600, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }
const thR: CSSProperties = { textAlign: 'right', padding: '10px 14px', fontWeight: 600, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }
const tdL: CSSProperties = { textAlign: 'left', padding: '9px 14px', color: '#1C1B1F' }
const tdR: CSSProperties = { textAlign: 'right', padding: '9px 14px', color: '#1C1B1F' }
