'use client'

// src/app/uurtarief-berekenen/UurtariefCalculator.tsx
// [UURTARIEF-TOOL] ZZP hourly-rate calculator (client half).
// rate = (gewenst jaarinkomen + zakelijke kosten) / declarabele uren, with an
// optional buffer % for tax/pension/downtime. Pure client math, Dutch-formatted.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL } from '@/lib/format-nl'
import { parseAmountNL as parseNum } from '@/lib/parse-nl'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const s = {
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    border: '1px solid #ececf1',
  } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#6b6b6e', marginBottom: 6 } as React.CSSProperties,
  hint: { fontSize: 12, color: '#aeaeb2', marginBottom: 8 } as React.CSSProperties,
  field: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #e5e5ea',
    borderRadius: 12,
    backgroundColor: '#f9f9fb',
    padding: '0 14px',
    marginBottom: 18,
  } as React.CSSProperties,
  prefix: { fontSize: 18, color: '#aeaeb2', marginRight: 8 } as React.CSSProperties,
  input: {
    flex: 1,
    fontSize: 20,
    fontWeight: 600,
    padding: '13px 0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#1c1c1e',
    width: '100%',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 2px 14px',
  } as React.CSSProperties,
  resultPanel: {
    marginTop: 8,
    background: 'linear-gradient(135deg, #af52de, #7d3ac1)',
    borderRadius: 16,
    padding: '22px 24px',
    color: '#fff',
  } as React.CSSProperties,
  breakdownRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    padding: '10px 0',
    borderBottom: '1px solid #f0f0f4',
  } as React.CSSProperties,
}

export default function UurtariefCalculator() {
  const [income, setIncome] = useState('40.000')
  const [costs, setCosts] = useState('5.000')
  const [hours, setHours] = useState('1200')
  const [useBuffer, setUseBuffer] = useState(true)
  const [buffer, setBuffer] = useState('30')

  const { base, recommended, bufferPct, yearRevenue } = useMemo(() => {
    const inc = parseNum(income)
    const cost = parseNum(costs)
    const hrs = parseNum(hours)
    const base = hrs > 0 ? (inc + cost) / hrs : 0
    const bufferPct = useBuffer ? parseNum(buffer) : 0
    const recommended = base * (1 + bufferPct / 100)
    return {
      base: round2(base),
      recommended: round2(recommended),
      bufferPct,
      yearRevenue: round2(recommended * hrs),
    }
  }, [income, costs, hours, useBuffer, buffer])

  return (
    <div style={s.card}>
      <div style={s.label}>Gewenst jaarinkomen</div>
      <div style={s.hint}>Wat je bruto wilt overhouden aan winst</div>
      <div style={s.field}>
        <span style={s.prefix}>€</span>
        <input style={s.input} value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" aria-label="Gewenst jaarinkomen" autoFocus />
      </div>

      <div style={s.label}>Zakelijke kosten per jaar</div>
      <div style={s.hint}>Verzekeringen, tools, administratie, etc.</div>
      <div style={s.field}>
        <span style={s.prefix}>€</span>
        <input style={s.input} value={costs} onChange={(e) => setCosts(e.target.value)} inputMode="decimal" aria-label="Zakelijke kosten" />
      </div>

      <div style={s.label}>Declarabele uren per jaar</div>
      <div style={s.hint}>Uren die je kunt factureren — vaak ongeveer 1.200 van 1.800 gewerkte uren</div>
      <div style={s.field}>
        <input style={s.input} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" aria-label="Declarabele uren" />
        <span style={{ ...s.prefix, marginRight: 0, marginLeft: 8 }}>uur</span>
      </div>

      <div style={s.toggleRow}>
        <div>
          <span style={{ fontSize: 15, color: '#1c1c1e', fontWeight: 500 }}>Buffer voor belasting, pensioen en lege uren</span>
          {useBuffer && (
            <input
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              inputMode="decimal"
              aria-label="Buffer percentage"
              style={{ width: 52, marginLeft: 10, padding: '6px 8px', borderRadius: 8, border: '1.5px solid #e5e5ea', fontSize: 14, fontWeight: 600, textAlign: 'center', fontFamily: 'inherit' }}
            />
          )}
          {useBuffer && <span style={{ color: '#3c3c43', fontWeight: 600, marginLeft: 4 }}>%</span>}
        </div>
        <button
          onClick={() => setUseBuffer((v) => !v)}
          aria-pressed={useBuffer}
          style={{ width: 52, height: 30, borderRadius: 9999, border: 'none', cursor: 'pointer', backgroundColor: useBuffer ? '#af52de' : '#e5e5ea', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}
        >
          <span style={{ position: 'absolute', top: 3, left: useBuffer ? 25 : 3, width: 24, height: 24, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
        </button>
      </div>

      <div style={s.resultPanel}>
        <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 500 }}>Aanbevolen uurtarief</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>
          {formatEuroNL(recommended)}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.breakdownRow}>
          <span style={{ color: '#6b6b6e' }}>Basistarief (zonder buffer)</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(base)}</span>
        </div>
        {useBuffer && (
          <div style={s.breakdownRow}>
            <span style={{ color: '#6b6b6e' }}>Buffer ({bufferPct}%)</span>
            <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(recommended - base)}</span>
          </div>
        )}
        <div style={{ ...s.breakdownRow, borderBottom: 'none' }}>
          <span style={{ color: '#6b6b6e' }}>Benodigde jaaromzet</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(yearRevenue)}</span>
        </div>
      </div>

      <div style={{ marginTop: 22, background: '#f9f9fb', border: '1px solid #ececf1', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#3c3c43' }}>
          Tarief bepaald? <strong style={{ color: '#1c1c1e' }}>Factureer het meteen.</strong>
        </div>
        <Link href="/factuur-maken" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 9999, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Factuur maken →
        </Link>
      </div>
    </div>
  )
}
