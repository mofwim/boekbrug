'use client'

// src/app/dashboard/kluis/KluisClient.tsx
// [KLUIS] The compliance-vault overview: one card per fiscal year with the 7-year
// retention clock, honest completeness counts, gap notes, and a one-click export
// bundle (ZIP of that year's documents + a manifest). The door stays open — the
// export always works — so retention is the pull, never a cage.

import { useState } from 'react'
import Link from 'next/link'
import type { YearSummary } from '@/lib/compliance-vault'

const M3 = {
  primary: '#1A73E8', onSurface: '#1C1B1F', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', success: '#137333', warning: '#7C5800', error: '#B3261E', vault: '#455A64',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export default function KluisClient({ summaries, currentYear }: { summaries: YearSummary[]; currentYear: number }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 80px' }}>
        <Link href="/dashboard/werkplek" style={{ fontSize: 14, color: M3.primary, textDecoration: 'none' }}>← Werkplek</Link>

        <header style={{ margin: '16px 0 8px' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: M3.onSurface, margin: '0 0 4px' }}>Compliance-kluis</h1>
          <p style={{ fontSize: 14.5, color: M3.neutral, margin: 0, lineHeight: 1.5 }}>
            Je administratie, per jaar bij elkaar. De Belastingdienst vraagt je stukken <strong>7 jaar</strong> te
            bewaren — hier staan ze klaar, met één knop te exporteren voor je boekhouder.
          </p>
        </header>

        {summaries.length === 0 ? (
          <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14.5, padding: '48px 16px', background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, marginTop: 16 }}>
            Nog geen stukken in de kluis. Zodra je facturen verstuurt of bankafschriften en bonnen uploadt,
            verschijnen ze hier — netjes per jaar en kwartaal.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            {summaries.map((s) => <YearCard key={s.year} s={s} currentYear={currentYear} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function YearCard({ s, currentYear }: { s: YearSummary; currentYear: number }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function exportYear() {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/kluis/export?year=${s.year}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErr(j.error || 'Export mislukt'); setBusy(false); return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `boekbrug-administratie-${s.year}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setErr('Export mislukt')
    }
    setBusy(false)
  }

  const yearsLeft = s.keepThroughYear - currentYear
  const retentionLabel = s.withinRetention
    ? `Bewaren t/m ${s.keepThroughYear}${yearsLeft > 0 ? ` · nog ${yearsLeft} jaar` : ' · dit jaar afloopt'}`
    : `Bewaarplicht verlopen (sinds ${s.keepThroughYear + 1}) — mag weg`

  return (
    <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: M3.onSurface }}>{s.year}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12.5, fontWeight: 600, color: s.withinRetention ? M3.vault : M3.neutral, background: s.withinRetention ? '#ECEFF1' : '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
            🛡️ {retentionLabel}
          </div>
        </div>
        <button onClick={exportYear} disabled={busy} style={{ background: M3.vault, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>
          {busy ? 'Bezig…' : '⬇︎ Exporteer jaar'}
        </button>
      </div>

      {err && <div style={{ marginTop: 8, fontSize: 12.5, color: M3.error }}>{err}</div>}

      {/* Counts */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Stat label="Facturen uit" value={String(s.outgoingCount)} sub={eur.format(s.outgoingTotal)} />
        <Stat label="Facturen in" value={String(s.incomingCount)} />
        <Stat label="Bankafschriften" value={String(s.bankStatements)} />
        <Stat label="Documenten" value={String(s.documentCount)} />
      </div>

      {/* Quarter strip */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {s.quarters.map((q) => (
          <div key={q.quarter} style={{ flex: 1, textAlign: 'center', background: '#F8F9FA', border: `1px solid ${q.missingBankStatement ? '#FCE8B2' : M3.outlineVariant}`, borderRadius: 10, padding: '8px 4px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: M3.neutral }}>Q{q.quarter}</div>
            <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 2 }}>{q.outgoingCount + q.incomingCount} fact.</div>
            <div style={{ fontSize: 11.5, color: q.missingBankStatement ? M3.warning : M3.neutral }}>
              {q.missingBankStatement ? '⚠ geen afschr.' : `${q.bankStatements} afschr.`}
            </div>
          </div>
        ))}
      </div>

      {/* Honest gap notes */}
      {s.gaps.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: M3.warning, background: '#FFF8E6', border: '1px solid #FFE9A8', borderRadius: 10, padding: '10px 12px', lineHeight: 1.5 }}>
          {s.gaps.map((g, i) => <div key={i}>{g}</div>)}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: '#F8F9FA', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: M3.neutral, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: M3.onSurface }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
