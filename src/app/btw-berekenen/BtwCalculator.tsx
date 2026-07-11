'use client'

// src/app/btw-berekenen/BtwCalculator.tsx
// [BTW-TOOL] Interactive BTW calculator — the client half of /btw-berekenen.
// Bidirectional (exclusief ↔ inclusief), 21/9/0% + custom, live, Dutch-formatted.
// No account, no network — everything is computed in the browser.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL } from '@/lib/format-nl'

type Mode = 'excl' | 'incl'

// Tolerant Dutch amount parse: "1.250,00" → 1250, "1,5" → 1.5, "1250.00" → 1250.
function parseNum(s: string): number {
  const t = String(s ?? '').trim()
  if (!t) return 0
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = parseFloat(normalized)
  return isFinite(n) && n >= 0 ? n : 0
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const PRESET_RATES = [21, 9, 0]

const s = {
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    border: '1px solid #ececf1',
  } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#6b6b6e', marginBottom: 8 } as React.CSSProperties,
  segRow: {
    display: 'flex',
    gap: 4,
    backgroundColor: '#f2f2f7',
    padding: 4,
    borderRadius: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  seg: (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 8px',
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    backgroundColor: active ? '#ffffff' : 'transparent',
    color: active ? '#007aff' : '#6b6b6e',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
    transition: 'all 0.12s ease',
  }),
  amountWrap: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #e5e5ea',
    borderRadius: 12,
    backgroundColor: '#f9f9fb',
    padding: '0 14px',
    marginBottom: 20,
  } as React.CSSProperties,
  euro: { fontSize: 22, color: '#aeaeb2', marginRight: 8 } as React.CSSProperties,
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: 700,
    padding: '14px 0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#1c1c1e',
    width: '100%',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  rateChip: (active: boolean): React.CSSProperties => ({
    padding: '9px 16px',
    borderRadius: 9999,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: active ? '1.5px solid #007aff' : '1.5px solid #e5e5ea',
    backgroundColor: active ? '#e8f1ff' : '#ffffff',
    color: active ? '#007aff' : '#3c3c43',
  }),
  customInput: {
    width: 64,
    padding: '9px 10px',
    borderRadius: 9999,
    border: '1.5px solid #e5e5ea',
    fontSize: 14,
    fontWeight: 600,
    outline: 'none',
    textAlign: 'center',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  resultPanel: {
    marginTop: 24,
    background: 'linear-gradient(135deg, #007aff, #0a63d6)',
    borderRadius: 16,
    padding: '22px 24px',
    color: '#fff',
  } as React.CSSProperties,
  resultLabel: { fontSize: 13, opacity: 0.85, fontWeight: 500 } as React.CSSProperties,
  resultBig: { fontSize: 34, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' } as React.CSSProperties,
  breakdownRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    padding: '10px 0',
    borderBottom: '1px solid #f0f0f4',
  } as React.CSSProperties,
}

export default function BtwCalculator() {
  const [mode, setMode] = useState<Mode>('excl')
  const [amount, setAmount] = useState('100')
  const [rate, setRate] = useState(21)
  const [customActive, setCustomActive] = useState(false)
  const [customRate, setCustomRate] = useState('')

  const effRate = customActive ? Math.max(0, parseNum(customRate)) : rate

  const { ex, btw, inc } = useMemo(() => {
    const a = parseNum(amount)
    if (mode === 'excl') {
      const btw = round2((a * effRate) / 100)
      return { ex: round2(a), btw, inc: round2(a + btw) }
    }
    const ex = round2(a / (1 + effRate / 100))
    return { ex, btw: round2(a - ex), inc: round2(a) }
  }, [amount, effRate, mode])

  // The headline answer to "BTW berekenen" is the BTW amount itself.
  return (
    <div style={s.card}>
      {/* Mode */}
      <div style={s.segRow}>
        <button style={s.seg(mode === 'excl')} onClick={() => setMode('excl')}>
          Bedrag is excl. BTW
        </button>
        <button style={s.seg(mode === 'incl')} onClick={() => setMode('incl')}>
          Bedrag is incl. BTW
        </button>
      </div>

      {/* Amount */}
      <div style={s.label}>{mode === 'excl' ? 'Bedrag exclusief BTW' : 'Bedrag inclusief BTW'}</div>
      <div style={s.amountWrap}>
        <span style={s.euro}>€</span>
        <input
          style={s.amountInput}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          aria-label="Bedrag"
          autoFocus
        />
      </div>

      {/* Rate */}
      <div style={s.label}>BTW-tarief</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {PRESET_RATES.map((r) => (
          <button
            key={r}
            style={s.rateChip(!customActive && rate === r)}
            onClick={() => {
              setCustomActive(false)
              setRate(r)
            }}
          >
            {r}%
          </button>
        ))}
        <span style={{ color: '#aeaeb2', fontSize: 13 }}>of</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            style={{
              ...s.customInput,
              borderColor: customActive ? '#007aff' : '#e5e5ea',
              backgroundColor: customActive ? '#e8f1ff' : '#fff',
            }}
            value={customRate}
            onChange={(e) => {
              setCustomRate(e.target.value)
              setCustomActive(true)
            }}
            onFocus={() => customRate !== '' && setCustomActive(true)}
            inputMode="decimal"
            placeholder="bijv. 6"
            aria-label="Eigen BTW-tarief"
          />
          <span style={{ color: '#3c3c43', fontSize: 14, fontWeight: 600 }}>%</span>
        </div>
      </div>

      {/* Headline result — the BTW amount */}
      <div style={s.resultPanel}>
        <div style={s.resultLabel}>BTW-bedrag ({effRate}%)</div>
        <div style={s.resultBig}>{formatEuroNL(btw)}</div>
      </div>

      {/* Breakdown */}
      <div style={{ marginTop: 18 }}>
        <div style={s.breakdownRow}>
          <span style={{ color: '#6b6b6e' }}>Bedrag exclusief BTW</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(ex)}</span>
        </div>
        <div style={s.breakdownRow}>
          <span style={{ color: '#6b6b6e' }}>BTW ({effRate}%)</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(btw)}</span>
        </div>
        <div style={{ ...s.breakdownRow, borderBottom: 'none' }}>
          <span style={{ color: '#1c1c1e', fontWeight: 700 }}>Bedrag inclusief BTW</span>
          <span style={{ fontWeight: 800, color: '#1c1c1e' }}>{formatEuroNL(inc)}</span>
        </div>
      </div>

      {/* Funnel CTA */}
      <div
        style={{
          marginTop: 22,
          background: '#f9f9fb',
          border: '1px solid #ececf1',
          borderRadius: 14,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 14, color: '#3c3c43' }}>
          BTW automatisch op je facturen?{' '}
          <strong style={{ color: '#1c1c1e' }}>Maak gratis een factuur.</strong>
        </div>
        <Link
          href="/factuur-maken"
          style={{
            backgroundColor: '#007aff',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            padding: '10px 18px',
            borderRadius: 9999,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Factuur maken →
        </Link>
      </div>
    </div>
  )
}
