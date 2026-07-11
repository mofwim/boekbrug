'use client'

// src/app/btw-aangifte-berekenen/BtwAangifteCalculator.tsx
// [AANGIFTE-TOOL] BTW-aangifte simulator (client). Exact rubrieken math:
// verschuldigde BTW over omzet (21% + 9%) minus voorbelasting = te betalen /
// terug te vragen. Dutch-formatted; no account, no network.

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatEuroNL } from '@/lib/format-nl'
import { parseAmountNL as parseNum } from '@/lib/parse-nl'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const s = {
  card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', border: '1px solid #ececf1' } as React.CSSProperties,
  group: { marginBottom: 18 } as React.CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: '#6b6b6e', marginBottom: 4 } as React.CSSProperties,
  hint: { fontSize: 12, color: '#aeaeb2', marginBottom: 8 } as React.CSSProperties,
  field: { display: 'flex', alignItems: 'center', border: '1px solid #e5e5ea', borderRadius: 12, backgroundColor: '#f9f9fb', padding: '0 14px' } as React.CSSProperties,
  prefix: { fontSize: 18, color: '#aeaeb2', marginRight: 8 } as React.CSSProperties,
  input: { flex: 1, fontSize: 19, fontWeight: 600, padding: '13px 0', border: 'none', outline: 'none', background: 'transparent', color: '#1c1c1e', width: '100%', fontFamily: 'inherit' } as React.CSSProperties,
  suffix: { fontSize: 13, color: '#aeaeb2', marginLeft: 8, whiteSpace: 'nowrap' } as React.CSSProperties,
  row: { display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '9px 0', borderBottom: '1px solid #f0f0f4' } as React.CSSProperties,
}

export default function BtwAangifteCalculator() {
  const [omzet21, setOmzet21] = useState('10.000')
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
  const panelColor = teBetalen ? 'linear-gradient(135deg, #ff9500, #f0730a)' : 'linear-gradient(135deg, #34c759, #24a148)'

  return (
    <div style={s.card}>
      <div style={s.group}>
        <div style={s.label}>Omzet met 21% BTW (excl. BTW)</div>
        <div style={s.hint}>Je verkopen tegen het hoge tarief, zonder BTW</div>
        <div style={s.field}>
          <span style={s.prefix}>€</span>
          <input style={s.input} value={omzet21} onChange={(e) => setOmzet21(e.target.value)} inputMode="decimal" aria-label="Omzet 21%" autoFocus />
        </div>
      </div>

      <div style={s.group}>
        <div style={s.label}>Omzet met 9% BTW (excl. BTW)</div>
        <div style={s.hint}>Verkopen tegen het lage tarief (voeding, boeken, kappers…)</div>
        <div style={s.field}>
          <span style={s.prefix}>€</span>
          <input style={s.input} value={omzet9} onChange={(e) => setOmzet9(e.target.value)} inputMode="decimal" aria-label="Omzet 9%" />
        </div>
      </div>

      <div style={s.group}>
        <div style={s.label}>Voorbelasting (BTW over je zakelijke kosten)</div>
        <div style={s.hint}>De BTW die je zelf betaalde op inkopen en kosten</div>
        <div style={s.field}>
          <span style={s.prefix}>€</span>
          <input style={s.input} value={voorbelasting} onChange={(e) => setVoorbelasting(e.target.value)} inputMode="decimal" aria-label="Voorbelasting" />
        </div>
      </div>

      <div style={{ marginTop: 8, background: panelColor, borderRadius: 16, padding: '22px 24px', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.92, fontWeight: 500 }}>
          {teBetalen ? 'Te betalen aan de Belastingdienst' : 'Terug te vragen van de Belastingdienst'}
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0 0' }}>
          {formatEuroNL(Math.abs(r.saldo))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={s.row}>
          <span style={{ color: '#6b6b6e' }}>BTW 21% (rubriek 1a)</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(r.btw21)}</span>
        </div>
        <div style={s.row}>
          <span style={{ color: '#6b6b6e' }}>BTW 9% (rubriek 1b)</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(r.btw9)}</span>
        </div>
        <div style={s.row}>
          <span style={{ color: '#6b6b6e' }}>Verschuldigde BTW (rubriek 5a)</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>{formatEuroNL(r.verschuldigd)}</span>
        </div>
        <div style={s.row}>
          <span style={{ color: '#6b6b6e' }}>Voorbelasting (rubriek 5b)</span>
          <span style={{ fontWeight: 600, color: '#1c1c1e' }}>− {formatEuroNL(r.voor)}</span>
        </div>
        <div style={{ ...s.row, borderBottom: 'none' }}>
          <span style={{ color: '#1c1c1e', fontWeight: 700 }}>Saldo (rubriek 5c)</span>
          <span style={{ fontWeight: 800, color: '#1c1c1e' }}>{formatEuroNL(r.saldo)}</span>
        </div>
      </div>

      <div style={{ marginTop: 22, background: '#f9f9fb', border: '1px solid #ececf1', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#3c3c43' }}>
          Nooit meer je BTW handmatig optellen?{' '}
          <strong style={{ color: '#1c1c1e' }}>BoekBrug doet het per kwartaal.</strong>
        </div>
        <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 18px', borderRadius: 9999, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Gratis proberen →
        </Link>
      </div>
    </div>
  )
}
