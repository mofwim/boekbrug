'use client'

// src/app/btw-berekenen/BtwCalculator.tsx
// [BTW-TOOL] Interactive BTW calculator — the client half of /btw-berekenen.
// Bidirectional (exclusief ↔ inclusief), 21/9/0% + custom, live, Dutch-formatted.
// No account, no network — everything is computed in the browser.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL, formatEuroEN } from '@/lib/format-nl'
import { parseAmountNL, parseAmountEN } from '@/lib/parse-nl'

type Mode = 'excl' | 'incl'
type Locale = 'nl' | 'en'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const PRESET_RATES = [21, 9, 0]

// UI strings only. The calculation and number engine are identical for both
// locales; only display text and the euro formatter differ. NL is the default
// so every existing Dutch call site (<BtwCalculator/>) is unchanged.
const COPY: Record<Locale, {
  exclTab: string; inclTab: string; amountExcl: string; amountIncl: string
  amountAria: string; rateLabel: string; or: string; customPh: string
  customAria: string; vatAmount: string; bExcl: string; bVat: string; bIncl: string
  ctaText: string; ctaStrong: string; ctaBtn: string; ctaHref: string
}> = {
  nl: {
    exclTab: 'Bedrag is excl. BTW', inclTab: 'Bedrag is incl. BTW',
    amountExcl: 'Bedrag exclusief BTW', amountIncl: 'Bedrag inclusief BTW',
    amountAria: 'Bedrag', rateLabel: 'BTW-tarief', or: 'of', customPh: 'bijv. 6',
    customAria: 'Eigen BTW-tarief', vatAmount: 'BTW-bedrag',
    bExcl: 'Bedrag exclusief BTW', bVat: 'BTW', bIncl: 'Bedrag inclusief BTW',
    ctaText: 'BTW automatisch op je facturen?', ctaStrong: 'Maak gratis een factuur.',
    ctaBtn: 'Factuur maken →', ctaHref: '/factuur-maken',
  },
  en: {
    exclTab: 'Amount is excl. VAT', inclTab: 'Amount is incl. VAT',
    amountExcl: 'Amount excluding VAT', amountIncl: 'Amount including VAT',
    amountAria: 'Amount', rateLabel: 'VAT rate', or: 'or', customPh: 'e.g. 6',
    customAria: 'Custom VAT rate', vatAmount: 'VAT amount',
    bExcl: 'Amount excluding VAT', bVat: 'VAT', bIncl: 'Amount including VAT',
    ctaText: 'VAT automatically on your invoices?', ctaStrong: 'Create a free account.',
    ctaBtn: 'Get started →', ctaHref: '/register',
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
  label: { fontSize: 13, fontWeight: 600, color: '#5f6368', marginBottom: 8 } as React.CSSProperties,
  segRow: {
    display: 'flex',
    gap: 4,
    backgroundColor: '#f8f9fa',
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
    color: active ? '#1a73e8' : '#5f6368',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
    transition: 'all 0.12s ease',
  }),
  amountWrap: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    padding: '0 14px',
    marginBottom: 20,
  } as React.CSSProperties,
  euro: { fontSize: 22, color: '#bdc1c6', marginRight: 8 } as React.CSSProperties,
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: 700,
    padding: '14px 0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#202124',
    width: '100%',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  rateChip: (active: boolean): React.CSSProperties => ({
    padding: '9px 16px',
    borderRadius: 9999,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: active ? '1.5px solid #1a73e8' : '1.5px solid #e0e0e0',
    backgroundColor: active ? '#e8f0fe' : '#ffffff',
    color: active ? '#1a73e8' : '#3c4043',
  }),
  customInput: {
    width: 64,
    padding: '9px 10px',
    borderRadius: 9999,
    border: '1.5px solid #e0e0e0',
    fontSize: 14,
    fontWeight: 600,
    outline: 'none',
    textAlign: 'center',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  resultPanel: {
    marginTop: 24,
    background: 'linear-gradient(135deg, #1a73e8, #0a63d6)',
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

export default function BtwCalculator({ locale = 'nl' }: { locale?: Locale }) {
  const t = COPY[locale]
  const fmt = locale === 'en' ? formatEuroEN : formatEuroNL
  const parseNum = locale === 'en' ? parseAmountEN : parseAmountNL
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
          {t.exclTab}
        </button>
        <button style={s.seg(mode === 'incl')} onClick={() => setMode('incl')}>
          {t.inclTab}
        </button>
      </div>

      {/* Amount */}
      <div style={s.label}>{mode === 'excl' ? t.amountExcl : t.amountIncl}</div>
      <div style={s.amountWrap}>
        <span style={s.euro}>€</span>
        <input
          style={s.amountInput}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={locale === 'en' ? '0.00' : '0,00'}
          aria-label={t.amountAria}
          autoFocus
        />
      </div>

      {/* Rate */}
      <div style={s.label}>{t.rateLabel}</div>
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
        <span style={{ color: '#bdc1c6', fontSize: 13 }}>{t.or}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            style={{
              ...s.customInput,
              borderColor: customActive ? '#1a73e8' : '#e0e0e0',
              backgroundColor: customActive ? '#e8f0fe' : '#fff',
            }}
            value={customRate}
            onChange={(e) => {
              setCustomRate(e.target.value)
              setCustomActive(true)
            }}
            onFocus={() => customRate !== '' && setCustomActive(true)}
            inputMode="decimal"
            placeholder={t.customPh}
            aria-label={t.customAria}
          />
          <span style={{ color: '#3c4043', fontSize: 14, fontWeight: 600 }}>%</span>
        </div>
      </div>

      {/* Headline result — the BTW amount */}
      <div style={s.resultPanel}>
        <div style={s.resultLabel}>{t.vatAmount} ({effRate}%)</div>
        <div style={s.resultBig}>{fmt(btw)}</div>
      </div>

      {/* Breakdown */}
      <div style={{ marginTop: 18 }}>
        <div style={s.breakdownRow}>
          <span style={{ color: '#5f6368' }}>{t.bExcl}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>{fmt(ex)}</span>
        </div>
        <div style={s.breakdownRow}>
          <span style={{ color: '#5f6368' }}>{t.bVat} ({effRate}%)</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>{fmt(btw)}</span>
        </div>
        <div style={{ ...s.breakdownRow, borderBottom: 'none' }}>
          <span style={{ color: '#202124', fontWeight: 700 }}>{t.bIncl}</span>
          <span style={{ fontWeight: 800, color: '#202124' }}>{fmt(inc)}</span>
        </div>
      </div>

      {/* Funnel CTA */}
      <div
        style={{
          marginTop: 22,
          background: '#f8f9fa',
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
