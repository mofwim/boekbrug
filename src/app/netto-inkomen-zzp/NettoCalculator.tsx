'use client'

// src/app/netto-inkomen-zzp/NettoCalculator.tsx
// [NETTO-TOOL] ZZP net-income estimator (client). Indicatief — geen fiscaal advies.
//
// 2026 parameters (Belastingdienst / Rijksoverheid, geverifieerd juli 2026):
//   zelfstandigenaftrek €1.200 · startersaftrek €2.123 · mkb-winstvrijstelling 12,7%
//   box 1: 35,75% t/m €38.883 · 37,56% t/m €78.426 · 49,50% daarboven
//   algemene heffingskorting max €3.115, afbouw 6,398% vanaf €29.736 (→ €0 bij €78.426)
//   arbeidskorting max €5.685, afbouw 6,51% vanaf €45.592
//   Zvw 4,85% over max €79.409
// The arbeidskorting build-up is modelled with a conservative linear ramp to the
// max at ~€39.000 (the detailed per-segment table is not reproduced), so for low
// incomes the estimate leans toward MORE tax — safe for planning.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL, formatEuroEN } from '@/lib/format-nl'
import { parseAmountNL, parseAmountEN } from '@/lib/parse-nl'
import { round2 } from '@/lib/invoice-totals'

type Locale = 'nl' | 'en'

// UI strings only — the 2026 tax parameters and the whole calculation are shared
// and identical for both locales. NL is the default so the existing Dutch tool
// (<NettoCalculator/>) is unchanged.
const COPY: Record<Locale, {
  profitLabel: string; profitHint: string; profitAria: string
  hoursTitle: string; hoursHint: string; starterTitle: string; starterHint: string
  netYear: string; perMonth: string; effRate: string
  rProfit: string; rDeduction: string; rMkb: string; rTaxable: string
  rIbBefore: string; rCredits: string; rIb: string; rZvw: string
  ctaText: string; ctaStrong: string; ctaBtn: string
}> = {
  nl: {
    profitLabel: 'Verwachte jaarwinst', profitHint: 'Omzet min zakelijke kosten (vóór ondernemersaftrek)', profitAria: 'Jaarwinst',
    hoursTitle: 'Ik voldoe aan het urencriterium', hoursHint: '≥ 1.225 uur → zelfstandigenaftrek €1.200',
    starterTitle: 'Ik ben starter', starterHint: 'Startersaftrek €2.123 (eerste jaren)',
    netYear: 'Netto over per jaar (schatting)', perMonth: 'per maand', effRate: 'effectieve druk',
    rProfit: 'Jaarwinst', rDeduction: 'Ondernemersaftrek', rMkb: 'MKB-winstvrijstelling (12,7%)', rTaxable: 'Belastbare winst',
    rIbBefore: 'Inkomstenbelasting (vóór kortingen)', rCredits: 'Heffingskortingen', rIb: 'Inkomstenbelasting', rZvw: 'Bijdrage Zvw (4,85%)',
    ctaText: 'Je omzet en BTW altijd bij de hand?', ctaStrong: 'BoekBrug houdt het per kwartaal bij.', ctaBtn: 'Gratis proberen →',
  },
  en: {
    profitLabel: 'Expected annual profit', profitHint: 'Revenue minus business costs (before entrepreneur deduction)', profitAria: 'Annual profit',
    hoursTitle: 'I meet the hours criterion', hoursHint: '≥ 1,225 hours → self-employed deduction €1,200',
    starterTitle: 'I am a starter', starterHint: "Starter's deduction €2,123 (first years)",
    netYear: 'Net per year (estimate)', perMonth: 'per month', effRate: 'effective rate',
    rProfit: 'Annual profit', rDeduction: 'Entrepreneur deduction', rMkb: 'SME profit exemption (12.7%)', rTaxable: 'Taxable profit',
    rIbBefore: 'Income tax (before credits)', rCredits: 'Tax credits', rIb: 'Income tax', rZvw: 'Healthcare contribution Zvw (4.85%)',
    ctaText: 'Your revenue and VAT always at hand?', ctaStrong: 'BoekBrug keeps it per quarter.', ctaBtn: 'Try it free →',
  },
}

const P = {
  zelfstandigenaftrek: 1200,
  startersaftrek: 2123,
  mkb: 0.127,
  brackets: [
    { upto: 38883, rate: 0.3575 },
    { upto: 78426, rate: 0.3756 },
    { upto: Infinity, rate: 0.495 },
  ],
  ahkMax: 3115,
  ahkStart: 29736,
  ahkRate: 0.06398,
  akMax: 5685,
  akFullAt: 39000,
  akPhaseStart: 45592,
  akPhaseRate: 0.0651,
  zvwRate: 0.0485,
  zvwMax: 79409,
}

// [CENT] round2 comes from invoice-totals — one function for the whole app. This file had its
// own, and it gave a different answer; see the header of invoice-totals.round2.
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function box1(belastbaar: number): number {
  let tax = 0
  let prev = 0
  for (const b of P.brackets) {
    if (belastbaar <= prev) break
    const slice = Math.min(belastbaar, b.upto) - prev
    tax += slice * b.rate
    prev = b.upto
  }
  return tax
}

function algemeneHeffingskorting(belastbaar: number): number {
  return clamp(P.ahkMax - Math.max(0, belastbaar - P.ahkStart) * P.ahkRate, 0, P.ahkMax)
}

function arbeidskorting(ai: number): number {
  if (ai <= 0) return 0
  if (ai <= P.akPhaseStart) return Math.min(P.akMax, (P.akMax * ai) / P.akFullAt)
  return Math.max(0, P.akMax - (ai - P.akPhaseStart) * P.akPhaseRate)
}

const s = {
  card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', border: '1px solid #e0e0e0' } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#5f6368', marginBottom: 4 } as React.CSSProperties,
  hint: { fontSize: 12, color: '#bdc1c6', marginBottom: 8 } as React.CSSProperties,
  field: { display: 'flex', alignItems: 'center', border: '1px solid #e0e0e0', borderRadius: 12, backgroundColor: '#f8f9fa', padding: '0 14px', marginBottom: 18 } as React.CSSProperties,
  input: { flex: 1, fontSize: 22, fontWeight: 700, padding: '14px 0', border: 'none', outline: 'none', background: 'transparent', color: '#202124', width: '100%', fontFamily: 'inherit' } as React.CSSProperties,
  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 2px' } as React.CSSProperties,
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '9px 0', borderBottom: '1px solid #f1f3f4' } as React.CSSProperties,
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{ width: 52, height: 30, borderRadius: 9999, border: 'none', cursor: 'pointer', backgroundColor: on ? '#1a73e8' : '#e0e0e0', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  )
}

export default function NettoCalculator({ locale = 'nl' }: { locale?: Locale }) {
  const t = COPY[locale]
  const fmt = locale === 'en' ? formatEuroEN : formatEuroNL
  const parseNum = locale === 'en' ? parseAmountEN : parseAmountNL
  const [winstStr, setWinstStr] = useState(locale === 'en' ? '50,000' : '50.000')
  const [urencriterium, setUrencriterium] = useState(true)
  const [starter, setStarter] = useState(false)

  const r = useMemo(() => {
    const winst = Math.max(0, parseNum(winstStr))
    const aftrekWens = (urencriterium ? P.zelfstandigenaftrek : 0) + (urencriterium && starter ? P.startersaftrek : 0)
    const ondernemersaftrek = Math.min(aftrekWens, winst)
    const winstNaAftrek = Math.max(0, winst - ondernemersaftrek)
    const mkb = winstNaAftrek * P.mkb
    const belastbaar = winstNaAftrek - mkb
    const ib = box1(belastbaar)
    const ahk = algemeneHeffingskorting(belastbaar)
    const ak = arbeidskorting(belastbaar)
    const ibNa = Math.max(0, ib - ahk - ak)
    const zvw = Math.min(belastbaar, P.zvwMax) * P.zvwRate
    const totaal = ibNa + zvw
    const netto = winst - totaal
    return {
      winst,
      ondernemersaftrek: round2(ondernemersaftrek),
      mkb: round2(mkb),
      belastbaar: round2(belastbaar),
      ib: round2(ib),
      korting: round2(ahk + ak),
      ibNa: round2(ibNa),
      zvw: round2(zvw),
      totaal: round2(totaal),
      netto: round2(netto),
      nettoMaand: round2(netto / 12),
      druk: winst > 0 ? Math.round((totaal / winst) * 1000) / 10 : 0,
    }
  }, [winstStr, urencriterium, starter])

  return (
    <div style={s.card}>
      <div style={s.label}>{t.profitLabel}</div>
      <div style={s.hint}>{t.profitHint}</div>
      <div style={s.field}>
        <span style={{ fontSize: 20, color: '#bdc1c6', marginInlineEnd: 8 }}>€</span>
        <input style={s.input} value={winstStr} onChange={(e) => setWinstStr(e.target.value)} inputMode="decimal" aria-label={t.profitAria} autoFocus />
      </div>

      <div style={s.toggleRow}>
        <div>
          <div style={{ fontSize: 15, color: '#202124', fontWeight: 500 }}>{t.hoursTitle}</div>
          <div style={{ fontSize: 12, color: '#bdc1c6' }}>{t.hoursHint}</div>
        </div>
        <Toggle on={urencriterium} onClick={() => setUrencriterium((v) => !v)} />
      </div>
      <div style={{ ...s.toggleRow, opacity: urencriterium ? 1 : 0.4 }}>
        <div>
          <div style={{ fontSize: 15, color: '#202124', fontWeight: 500 }}>{t.starterTitle}</div>
          <div style={{ fontSize: 12, color: '#bdc1c6' }}>{t.starterHint}</div>
        </div>
        <Toggle on={starter && urencriterium} onClick={() => urencriterium && setStarter((v) => !v)} />
      </div>

      <div style={{ marginTop: 12, background: 'linear-gradient(135deg, #34a853, #1e9e4a)', borderRadius: 16, padding: '22px 24px', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.92, fontWeight: 500 }}>{t.netYear}</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>{fmt(r.netto)}</div>
        <div style={{ fontSize: 14, opacity: 0.95, marginTop: 4 }}>
          ≈ {fmt(r.nettoMaand)} {t.perMonth} · {t.effRate} {locale === 'en' ? String(r.druk) : String(r.druk).replace('.', ',')}%
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rProfit}</span><span style={{ fontWeight: 600 }}>{fmt(r.winst)}</span></div>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rDeduction}</span><span style={{ fontWeight: 600 }}>− {fmt(r.ondernemersaftrek)}</span></div>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rMkb}</span><span style={{ fontWeight: 600 }}>− {fmt(r.mkb)}</span></div>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rTaxable}</span><span style={{ fontWeight: 600 }}>{fmt(r.belastbaar)}</span></div>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rIbBefore}</span><span style={{ fontWeight: 600 }}>{fmt(r.ib)}</span></div>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rCredits}</span><span style={{ fontWeight: 600 }}>− {fmt(r.korting)}</span></div>
        <div style={s.row}><span style={{ color: '#5f6368' }}>{t.rIb}</span><span style={{ fontWeight: 600 }}>{fmt(r.ibNa)}</span></div>
        <div style={{ ...s.row, borderBottom: 'none' }}><span style={{ color: '#5f6368' }}>{t.rZvw}</span><span style={{ fontWeight: 600 }}>{fmt(r.zvw)}</span></div>
      </div>

      <div style={{ marginTop: 22, background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#3c4043' }}>
          {t.ctaText}{' '}
          <strong style={{ color: '#202124' }}>{t.ctaStrong}</strong>
        </div>
        <Link href="/register" style={{ backgroundColor: '#1a73e8', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 9999, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t.ctaBtn}</Link>
      </div>
    </div>
  )
}
