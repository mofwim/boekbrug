'use client'

// src/app/kilometervergoeding/KmCalculator.tsx
// [KM-TOOL] Kilometervergoeding calculator (client half). Km × tarief, with a
// retour toggle and a trips multiplier. Rate is editable (default = the 2026
// onbelaste tarief, €0,25) so it never silently goes stale.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL, formatEuroEN } from '@/lib/format-nl'
import { parseAmountNL, parseAmountEN } from '@/lib/parse-nl'

type Locale = 'nl' | 'en'

// Onbelaste kilometervergoeding 2026 (Belastingdienst). Editable in the UI.
const DEFAULT_RATE = '0,25'
const DEFAULT_RATE_EN = '0.25'

// UI strings only; the km × rate math is shared and identical. NL default keeps
// the existing Dutch tool (<KmCalculator/>) unchanged.
const COPY: Record<Locale, {
  distanceLabel: string; kmAria: string; rateLabel: string; rateAria: string
  returnLabel: string; tripsLabel: string; tripsAria: string
  allowance: string; totalKm: string; ratePerKm: string
  ctaText: string; ctaStrong: string; ctaBtn: string; ctaHref: string
}> = {
  nl: {
    distanceLabel: 'Afstand (enkele reis) in kilometers', kmAria: 'Kilometers',
    rateLabel: 'Tarief per kilometer', rateAria: 'Tarief per kilometer',
    returnLabel: 'Heen en terug (retour)', tripsLabel: 'Aantal ritten', tripsAria: 'Aantal ritten',
    allowance: 'Vergoeding', totalKm: 'Totaal kilometers', ratePerKm: 'Tarief per km',
    ctaText: 'Reiskosten doorberekenen aan je klant?', ctaStrong: 'Zet ze op je factuur.',
    ctaBtn: 'Factuur maken →', ctaHref: '/factuur-maken',
  },
  en: {
    distanceLabel: 'Distance (one way) in kilometres', kmAria: 'Kilometres',
    rateLabel: 'Rate per kilometre', rateAria: 'Rate per kilometre',
    returnLabel: 'Round trip (return)', tripsLabel: 'Number of trips', tripsAria: 'Number of trips',
    allowance: 'Allowance', totalKm: 'Total kilometres', ratePerKm: 'Rate per km',
    ctaText: 'Charge travel costs to your client?', ctaStrong: 'Put them on your invoice.',
    ctaBtn: 'Get started →', ctaHref: '/register',
  },
}

const s = {
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
    border: '1px solid #e0e0e0',
  } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#5f6368', marginBottom: 8 } as React.CSSProperties,
  field: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    padding: '0 14px',
    marginBottom: 18,
  } as React.CSSProperties,
  prefix: { fontSize: 18, color: '#bdc1c6', marginRight: 8 } as React.CSSProperties,
  input: {
    flex: 1,
    fontSize: 20,
    fontWeight: 600,
    padding: '13px 0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#202124',
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
    background: 'linear-gradient(135deg, #34a853, #24a148)',
    borderRadius: 16,
    padding: '22px 24px',
    color: '#fff',
  } as React.CSSProperties,
  breakdownRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    padding: '10px 0',
    borderBottom: '1px solid #f1f3f4',
  } as React.CSSProperties,
}

export default function KmCalculator({ locale = 'nl' }: { locale?: Locale }) {
  const t = COPY[locale]
  const fmt = locale === 'en' ? formatEuroEN : formatEuroNL
  const parseNum = locale === 'en' ? parseAmountEN : parseAmountNL
  const [km, setKm] = useState('50')
  const [rate, setRate] = useState(locale === 'en' ? DEFAULT_RATE_EN : DEFAULT_RATE)
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
      <div style={s.label}>{t.distanceLabel}</div>
      <div style={s.field}>
        <input
          style={s.input}
          value={km}
          onChange={(e) => setKm(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          aria-label={t.kmAria}
          autoFocus
        />
        <span style={{ ...s.prefix, marginRight: 0, marginLeft: 8 }}>km</span>
      </div>

      <div style={s.label}>{t.rateLabel}</div>
      <div style={s.field}>
        <span style={s.prefix}>€</span>
        <input
          style={s.input}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          placeholder={locale === 'en' ? '0.25' : '0,25'}
          aria-label={t.rateAria}
        />
      </div>

      <div style={s.toggleRow}>
        <span style={{ fontSize: 15, color: '#202124', fontWeight: 500 }}>{t.returnLabel}</span>
        <button
          onClick={() => setRetour((v) => !v)}
          aria-pressed={retour}
          style={{
            width: 52,
            height: 30,
            borderRadius: 9999,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: retour ? '#34a853' : '#e0e0e0',
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

      <div style={s.label}>{t.tripsLabel}</div>
      <div style={s.field}>
        <input
          style={s.input}
          value={trips}
          onChange={(e) => setTrips(e.target.value)}
          inputMode="numeric"
          placeholder="1"
          aria-label={t.tripsAria}
        />
        <span style={{ ...s.prefix, marginRight: 0, marginLeft: 8 }}>×</span>
      </div>

      <div style={s.resultPanel}>
        <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 500 }}>{t.allowance}</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>
          {fmt(total)}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.breakdownRow}>
          <span style={{ color: '#5f6368' }}>{t.totalKm}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>
            {totalKm.toLocaleString(locale === 'en' ? 'en-IE' : 'nl-NL')} km
          </span>
        </div>
        <div style={{ ...s.breakdownRow, borderBottom: 'none' }}>
          <span style={{ color: '#5f6368' }}>{t.ratePerKm}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>{fmt(perKm)}</span>
        </div>
      </div>

      <div
        style={{
          marginTop: 22,
          background: '#f8f9fa',
          border: '1px solid #e0e0e0',
          borderRadius: 14,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 14, color: '#3c4043' }}>
          {t.ctaText}{' '}
          <strong style={{ color: '#202124' }}>{t.ctaStrong}</strong>
        </div>
        <Link
          href={t.ctaHref}
          style={{
            backgroundColor: '#1a73e8',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            padding: '10px 18px',
            borderRadius: 9999,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {t.ctaBtn}
        </Link>
      </div>
    </div>
  )
}
