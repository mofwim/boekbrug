'use client'

// src/app/btw-aangifte-berekenen/BtwAangifteCalculator.tsx
// [AANGIFTE-TOOL] BTW-aangifte simulator (client). Exact rubrieken math:
// verschuldigde BTW over omzet (21% + 9%) minus voorbelasting = te betalen /
// terug te vragen. Dutch-formatted; no account, no network.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL, formatEuroEN } from '@/lib/format-nl'
import { parseAmountNL, parseAmountEN } from '@/lib/parse-nl'

type Locale = 'nl' | 'en'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// UI strings only; the rubrieken/box math is shared and identical. NL default
// keeps the existing Dutch tool (<BtwAangifteCalculator/>) unchanged.
const COPY: Record<Locale, {
  rev21Label: string; rev21Hint: string; rev21Aria: string
  rev9Label: string; rev9Hint: string; rev9Aria: string
  inputLabel: string; inputHint: string; inputAria: string
  toPay: string; toReclaim: string
  vat21: string; vat9: string; due: string; inputVat: string; balance: string
  ctaText: string; ctaStrong: string; ctaBtn: string
}> = {
  nl: {
    rev21Label: 'Omzet met 21% BTW (excl. BTW)', rev21Hint: 'Je verkopen tegen het hoge tarief, zonder BTW', rev21Aria: 'Omzet 21%',
    rev9Label: 'Omzet met 9% BTW (excl. BTW)', rev9Hint: 'Verkopen tegen het lage tarief (voeding, boeken, kappers…)', rev9Aria: 'Omzet 9%',
    inputLabel: 'Voorbelasting (BTW over je zakelijke kosten)', inputHint: 'De BTW die je zelf betaalde op inkopen en kosten', inputAria: 'Voorbelasting',
    toPay: 'Te betalen aan de Belastingdienst', toReclaim: 'Terug te vragen van de Belastingdienst',
    vat21: 'BTW 21% (rubriek 1a)', vat9: 'BTW 9% (rubriek 1b)', due: 'Verschuldigde BTW (rubriek 5a)', inputVat: 'Voorbelasting (rubriek 5b)', balance: 'Saldo (rubriek 5c)',
    ctaText: 'Nooit meer je BTW handmatig optellen?', ctaStrong: 'BoekBrug doet het per kwartaal.', ctaBtn: 'Gratis proberen →',
  },
  en: {
    rev21Label: 'Revenue at 21% VAT (excl. VAT)', rev21Hint: 'Your sales at the standard rate, without VAT', rev21Aria: 'Revenue 21%',
    rev9Label: 'Revenue at 9% VAT (excl. VAT)', rev9Hint: 'Sales at the reduced rate (food, books, hairdressers…)', rev9Aria: 'Revenue 9%',
    inputLabel: 'Input VAT (VAT on your business costs)', inputHint: 'The VAT you paid yourself on purchases and costs', inputAria: 'Input VAT',
    toPay: 'To pay to the tax office', toReclaim: 'To reclaim from the tax office',
    vat21: 'VAT 21% (box 1a)', vat9: 'VAT 9% (box 1b)', due: 'VAT due (box 5a)', inputVat: 'Input VAT (box 5b)', balance: 'Balance (box 5c)',
    ctaText: 'Never add up your VAT by hand again?', ctaStrong: 'BoekBrug does it per quarter.', ctaBtn: 'Try it free →',
  },
}

const s = {
  card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0' } as React.CSSProperties,
  group: { marginBottom: 18 } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#5f6368', marginBottom: 4 } as React.CSSProperties,
  hint: { fontSize: 12, color: '#bdc1c6', marginBottom: 8 } as React.CSSProperties,
  field: { display: 'flex', alignItems: 'center', border: '1px solid #e0e0e0', borderRadius: 12, backgroundColor: '#f8f9fa', padding: '0 14px' } as React.CSSProperties,
  prefix: { fontSize: 18, color: '#bdc1c6', marginRight: 8 } as React.CSSProperties,
  input: { flex: 1, fontSize: 19, fontWeight: 600, padding: '13px 0', border: 'none', outline: 'none', background: 'transparent', color: '#202124', width: '100%', fontFamily: 'inherit' } as React.CSSProperties,
  suffix: { fontSize: 13, color: '#bdc1c6', marginLeft: 8, whiteSpace: 'nowrap' } as React.CSSProperties,
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '9px 0', borderBottom: '1px solid #f1f3f4' } as React.CSSProperties,
}

export default function BtwAangifteCalculator({ locale = 'nl' }: { locale?: Locale }) {
  const t = COPY[locale]
  const fmt = locale === 'en' ? formatEuroEN : formatEuroNL
  const parseNum = locale === 'en' ? parseAmountEN : parseAmountNL
  const [omzet21, setOmzet21] = useState(locale === 'en' ? '10,000' : '10.000')
  const [omzet9, setOmzet9] = useState('0')
  const [voorbelasting, setVoorbelasting] = useState('500')

  const r = useMemo(() => {
    const o21 = parseNum(omzet21)
    const o9 = parseNum(omzet9)
    const btw21 = round2(o21 * 0.21)
    const btw9 = round2(o9 * 0.09)
    const verschuldigd = round2(btw21 + btw9)
    const voor = round2(parseNum(voorbelasting))
    const saldo = round2(verschuldigd - voor) // >0 = betalen, <0 = terug
    return { o21, o9, btw21, btw9, verschuldigd, voor, saldo }
  }, [omzet21, omzet9, voorbelasting])

  const teBetalen = r.saldo >= 0
  const panelColor = teBetalen ? 'linear-gradient(135deg, #e37400, #f0730a)' : 'linear-gradient(135deg, #34a853, #34a853)'

  return (
    <div style={s.card}>
      <div style={s.group}>
        <div style={s.label}>{t.rev21Label}</div>
        <div style={s.hint}>{t.rev21Hint}</div>
        <div style={s.field}>
          <span style={s.prefix}>€</span>
          <input style={s.input} value={omzet21} onChange={(e) => setOmzet21(e.target.value)} inputMode="decimal" aria-label={t.rev21Aria} autoFocus />
        </div>
      </div>

      <div style={s.group}>
        <div style={s.label}>{t.rev9Label}</div>
        <div style={s.hint}>{t.rev9Hint}</div>
        <div style={s.field}>
          <span style={s.prefix}>€</span>
          <input style={s.input} value={omzet9} onChange={(e) => setOmzet9(e.target.value)} inputMode="decimal" aria-label={t.rev9Aria} />
        </div>
      </div>

      <div style={s.group}>
        <div style={s.label}>{t.inputLabel}</div>
        <div style={s.hint}>{t.inputHint}</div>
        <div style={s.field}>
          <span style={s.prefix}>€</span>
          <input style={s.input} value={voorbelasting} onChange={(e) => setVoorbelasting(e.target.value)} inputMode="decimal" aria-label={t.inputAria} />
        </div>
      </div>

      <div style={{ marginTop: 8, background: panelColor, borderRadius: 16, padding: '22px 24px', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.92, fontWeight: 500 }}>
          {teBetalen ? t.toPay : t.toReclaim}
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>
          {fmt(Math.abs(r.saldo))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.row}>
          <span style={{ color: '#5f6368' }}>{t.vat21}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>{fmt(r.btw21)}</span>
        </div>
        <div style={s.row}>
          <span style={{ color: '#5f6368' }}>{t.vat9}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>{fmt(r.btw9)}</span>
        </div>
        <div style={s.row}>
          <span style={{ color: '#5f6368' }}>{t.due}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>{fmt(r.verschuldigd)}</span>
        </div>
        <div style={s.row}>
          <span style={{ color: '#5f6368' }}>{t.inputVat}</span>
          <span style={{ fontWeight: 600, color: '#202124' }}>− {fmt(r.voor)}</span>
        </div>
        <div style={{ ...s.row, borderBottom: 'none' }}>
          <span style={{ color: '#202124', fontWeight: 700 }}>{t.balance}</span>
          <span style={{ fontWeight: 800, color: '#202124' }}>{fmt(r.saldo)}</span>
        </div>
      </div>

      <div style={{ marginTop: 22, background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#3c4043' }}>
          {t.ctaText}{' '}
          <strong style={{ color: '#202124' }}>{t.ctaStrong}</strong>
        </div>
        <Link href="/register" style={{ backgroundColor: '#1a73e8', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 9999, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {t.ctaBtn}
        </Link>
      </div>
    </div>
  )
}
