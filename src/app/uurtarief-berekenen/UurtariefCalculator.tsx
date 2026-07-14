'use client'

// src/app/uurtarief-berekenen/UurtariefCalculator.tsx
// [UURTARIEF-TOOL] ZZP hourly-rate calculator (client half).
// rate = (gewenst jaarinkomen + zakelijke kosten) / declarabele uren, with an
// optional buffer % for tax/pension/downtime. Pure client math, Dutch-formatted.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL, formatEuroEN } from '@/lib/format-nl'
import { parseAmountNL, parseAmountEN } from '@/lib/parse-nl'

type Locale = 'nl' | 'en'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// UI strings only; the rate math is shared and identical. NL default keeps the
// existing Dutch tool (<UurtariefCalculator/>) unchanged.
const COPY: Record<Locale, {
  incomeLabel: string; incomeHint: string; incomeAria: string
  costsLabel: string; costsHint: string; costsAria: string
  hoursLabel: string; hoursHint: string; hoursAria: string; hoursSuffix: string
  bufferLabel: string; bufferAria: string; recommended: string
  baseRate: string; buffer: string; yearRevenue: string
  ctaText: string; ctaStrong: string; ctaBtn: string; ctaHref: string
}> = {
  nl: {
    incomeLabel: 'Gewenst jaarinkomen', incomeHint: 'Wat je bruto wilt overhouden aan winst', incomeAria: 'Gewenst jaarinkomen',
    costsLabel: 'Zakelijke kosten per jaar', costsHint: 'Verzekeringen, tools, administratie, etc.', costsAria: 'Zakelijke kosten',
    hoursLabel: 'Declarabele uren per jaar', hoursHint: 'Uren die je kunt factureren — vaak ongeveer 1.200 van 1.800 gewerkte uren', hoursAria: 'Declarabele uren', hoursSuffix: 'uur',
    bufferLabel: 'Buffer voor belasting, pensioen en lege uren', bufferAria: 'Buffer percentage', recommended: 'Aanbevolen uurtarief',
    baseRate: 'Basistarief (zonder buffer)', buffer: 'Buffer', yearRevenue: 'Benodigde jaaromzet',
    ctaText: 'Tarief bepaald?', ctaStrong: 'Factureer het meteen.', ctaBtn: 'Factuur maken →', ctaHref: '/factuur-maken',
  },
  en: {
    incomeLabel: 'Desired annual income', incomeHint: 'The profit you want to keep before tax', incomeAria: 'Desired annual income',
    costsLabel: 'Business costs per year', costsHint: 'Insurance, tools, admin, etc.', costsAria: 'Business costs',
    hoursLabel: 'Billable hours per year', hoursHint: 'Hours you can invoice — often about 1,200 of 1,800 worked hours', hoursAria: 'Billable hours', hoursSuffix: 'hrs',
    bufferLabel: 'Buffer for tax, pension and downtime', bufferAria: 'Buffer percentage', recommended: 'Recommended hourly rate',
    baseRate: 'Base rate (without buffer)', buffer: 'Buffer', yearRevenue: 'Required annual revenue',
    ctaText: 'Rate set?', ctaStrong: 'Create your account.', ctaBtn: 'Get started →', ctaHref: '/register',
  },
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

export default function UurtariefCalculator({ locale = 'nl' }: { locale?: Locale }) {
  const t = COPY[locale]
  const fmt = locale === 'en' ? formatEuroEN : formatEuroNL
  const parseNum = locale === 'en' ? parseAmountEN : parseAmountNL
  const [income, setIncome] = useState(locale === 'en' ? '40,000' : '40.000')
  const [costs, setCosts] = useState(locale === 'en' ? '5,000' : '5.000')
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
      <div style={s.label}>{t.incomeLabel}</div>
      <div style={s.hint}>{t.incomeHint}</div>
      <div style={s.field}>
        <span style={s.prefix}>€</span>
        <input style={s.input} value={income} onChange={(e) => setIncome(e.target.value)} inputMode="decimal" aria-label={t.incomeAria} autoFocus />
      </div>

      <div style={s.label}>{t.costsLabel}</div>
      <div style={s.hint}>{t.costsHint}</div>
      <div style={s.field}>
        <span style={s.prefix}>€</span>
        <input style={s.input} value={costs} onChange={(e) => setCosts(e.target.value)} inputMode="decimal" aria-label={t.costsAria} />
      </div>

      <div style={s.label}>{t.hoursLabel}</div>
      <div style={s.hint}>{t.hoursHint}</div>
      <div style={s.field}>
        <input style={s.input} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" aria-label={t.hoursAria} />
        <span style={{ ...s.prefix, marginRight: 0, marginLeft: 8 }}>{t.hoursSuffix}</span>
      </div>

      <div style={s.toggleRow}>
        <div>
          <span style={{ fontSize: 15, color: '#1c1c1e', fontWeight: 500 }}>{t.bufferLabel}</span>
          {useBuffer && (
            <input
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              inputMode="decimal"
              aria-label={t.bufferAria}
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
        <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 500 }}>{t.recommended}</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>
          {fmt(recommended)}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.breakdownRow}>
          <span style={{ color: '#6b6b6e' }}>{t.baseRate}</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{fmt(base)}</span>
        </div>
        {useBuffer && (
          <div style={s.breakdownRow}>
            <span style={{ color: '#6b6b6e' }}>{t.buffer} ({bufferPct}%)</span>
            <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{fmt(recommended - base)}</span>
          </div>
        )}
        <div style={{ ...s.breakdownRow, borderBottom: 'none' }}>
          <span style={{ color: '#6b6b6e' }}>{t.yearRevenue}</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{fmt(yearRevenue)}</span>
        </div>
      </div>

      <div style={{ marginTop: 22, background: '#f9f9fb', border: '1px solid #ececf1', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#3c3c43' }}>
          {t.ctaText} <strong style={{ color: '#1c1c1e' }}>{t.ctaStrong}</strong>
        </div>
        <Link href={t.ctaHref} style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 9999, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {t.ctaBtn}
        </Link>
      </div>
    </div>
  )
}
