'use client'

// src/app/kilometervergoeding/KmCalculator.tsx
// [KM-TOOL] Kilometervergoeding calculator (client half). Km × tarief, with a
// retour toggle and a trips multiplier. Rate is editable (default = the 2026
// onbelaste tarief, €0,25) so it never silently goes stale.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL } from '@/lib/format-nl'
import { parseAmountNL as parseNum } from '@/lib/parse-nl'

// Onbelaste kilometervergoeding 2026 (Belastingdienst). Editable in the UI.
const DEFAULT_RATE = '0,25'

const s = {
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    border: '1px solid #ececf1',
  } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#6b6b6e', marginBottom: 8 } as React.CSSProperties,
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
    padding: '12px 2px',
    marginBottom: 6,
  } as React.CSSProperties,
  resultPanel: {
    marginTop: 22,
    background: 'linear-gradient(135deg, #34c759, #24a148)',
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

export default function KmCalculator() {
  const [km, setKm] = useState('50')
  const [rate, setRate] = useState(DEFAULT_RATE)
  const [retour, setRetour] = useState(false)
  const [trips, setTrips] = useState('1')

  const { totalKm, perKm, total } = useMemo(() => {
    const oneWay = parseNum(km)
    const perKm = parseNum(rate)
    const n = Math.max(1, Math.round(parseNum(trips)) || 1)
    const totalKm = oneWay * (retour ? 2 : 1) * n
    return { totalKm, perKm, total: Math.round(totalKm * perKm * 100) / 100 }
  }, [km, rate, retour, trips])

  return (
    <div style={s.card}>
      <div style={s.label}>Afstand (enkele reis) in kilometers</div>
      <div style={s.field}>
        <input
          style={s.input}
          value={km}
          onChange={(e) => setKm(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          aria-label="Kilometers"
          autoFocus
        />
        <span style={{ ...s.prefix, marginRight: 0, marginLeft: 8 }}>km</span>
      </div>

      <div style={s.label}>Tarief per kilometer</div>
      <div style={s.field}>
        <span style={s.prefix}>€</span>
        <input
          style={s.input}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          placeholder="0,25"
          aria-label="Tarief per kilometer"
        />
      </div>

      <div style={s.toggleRow}>
        <span style={{ fontSize: 15, color: '#1c1c1e', fontWeight: 500 }}>Heen en terug (retour)</span>
        <button
          onClick={() => setRetour((v) => !v)}
          aria-pressed={retour}
          style={{
            width: 52,
            height: 30,
            borderRadius: 9999,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: retour ? '#34c759' : '#e5e5ea',
            position: 'relative',
            transition: 'background 0.15s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: retour ? 25 : 3,
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: '#fff',
              transition: 'left 0.15s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        </button>
      </div>

      <div style={s.label}>Aantal ritten</div>
      <div style={s.field}>
        <input
          style={s.input}
          value={trips}
          onChange={(e) => setTrips(e.target.value)}
          inputMode="numeric"
          placeholder="1"
          aria-label="Aantal ritten"
        />
        <span style={{ ...s.prefix, marginRight: 0, marginLeft: 8 }}>×</span>
      </div>

      <div style={s.resultPanel}>
        <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 500 }}>Vergoeding</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>
          {formatEuroNL(total)}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.breakdownRow}>
          <span style={{ color: '#6b6b6e' }}>Totaal kilometers</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>
            {totalKm.toLocaleString('nl-NL')} km
          </span>
        </div>
        <div style={{ ...s.breakdownRow, borderBottom: 'none' }}>
          <span style={{ color: '#6b6b6e' }}>Tarief per km</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(perKm)}</span>
        </div>
      </div>

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
          Reiskosten doorberekenen aan je klant?{' '}
          <strong style={{ color: '#1c1c1e' }}>Zet ze op je factuur.</strong>
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
