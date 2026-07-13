'use client'

// src/app/dashboard/aangifte/AangifteClient.tsx
// [AANGIFTE] The concept BTW-aangifte, in the Belastingdienst rubriek layout. Every
// figure is derived from the owner's own imported data (see /api/aangifte); the notes
// state exactly what each depends on. It is loudly a CONCEPT — never a filing.

import { useEffect, useState } from 'react'
import Link from 'next/link'

const M3 = {
  primary: '#1A73E8', onSurface: '#1C1B1F', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', track: '#EEF1F4', success: '#137333', error: '#B3261E',
  warning: '#7C5800', warningContainer: '#FEE8C4',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

interface Row { code: string; label: string; omzet: number; btw: number }
interface Aangifte {
  quarterLabel: string
  rows: Row[]
  verschuldigd: number; voorbelasting: number; saldo: number
  cashOmzetZonderBtw: number
  notes: string[]
}

export default function AangifteClient() {
  const [data, setData] = useState<Aangifte | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/aangifte')
        const json = await res.json()
        if (!cancelled && res.ok) setData(json.aangifte)
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  const teBetalen = data ? data.saldo >= 0 : true

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <Link href="/dashboard" style={{ fontSize: 14, color: M3.primary, textDecoration: 'none' }}>← Terug</Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, margin: '12px 0 4px' }}>
          Concept BTW-aangifte {data ? `— ${data.quarterLabel}` : ''}
        </h1>

        {/* Concept banner — this is NOT a filing. */}
        <div style={{ background: M3.warningContainer, color: M3.warning, borderRadius: 10, padding: '12px 14px', fontSize: 13.5, fontWeight: 600, margin: '10px 0 20px', lineHeight: 1.5 }}>
          ⚠ Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte.
          Je boekhouder controleert en dient in.
        </div>

        {loading && <div style={{ color: M3.neutral, fontSize: 14 }}>Berekenen…</div>}

        {!loading && !data && (
          <div style={{ color: M3.neutral, fontSize: 14 }}>Kon de concept-aangifte niet laden.</div>
        )}

        {data && (
          <>
            {/* Rubrieken */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ background: '#F7F9FB', color: M3.neutral }}>
                      <th style={th}>Rubriek</th>
                      <th style={{ ...th, textAlign: 'right', fontFamily: FONT_NUM }}>Omzet</th>
                      <th style={{ ...th, textAlign: 'right', fontFamily: FONT_NUM }}>BTW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.code} style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
                        <td style={td}>
                          <span style={{ fontWeight: 700, fontFamily: FONT_NUM }}>{r.code}</span>
                          <span style={{ color: M3.neutral, marginInlineStart: 8, fontSize: 12.5 }}>{r.label}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: FONT_NUM }}>{eur.format(r.omzet)}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: FONT_NUM }}>{r.btw ? eur.format(r.btw) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 5a / 5b / 5g */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '4px 18px', marginBottom: 16 }}>
              <TotRow label="5a · Verschuldigde omzetbelasting" value={eur.format(data.verschuldigd)} />
              <TotRow label="5b · Voorbelasting" value={`− ${eur.format(data.voorbelasting)}`} />
              <TotRow
                label={teBetalen ? '5g · Concept te betalen' : '5g · Concept terug te ontvangen'}
                value={eur.format(Math.abs(data.saldo))}
                strong color={teBetalen ? M3.onSurface : M3.success}
              />
            </div>

            {/* Honest notes — the trust layer */}
            <div style={{ background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, padding: '16px 18px' }}>
              <div style={{ fontSize: 12.5, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
                Waar dit op gebaseerd is
              </div>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {data.notes.map((n, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: M3.onSurface, lineHeight: 1.6, marginBottom: 6 }}>{n}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TotRow({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderBottom: '1px solid #F0F0F4' }}>
      <span style={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 700 : 500, color: color ?? '#1C1B1F' }}>{label}</span>
      <span style={{ fontSize: strong ? 20 : 15, fontWeight: strong ? 700 : 600, color: color ?? '#1C1B1F', fontFamily: FONT_NUM }}>{value}</span>
    </div>
  )
}

const th = { padding: '10px 14px', textAlign: 'left' as const, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.03em' }
const td = { padding: '11px 14px', color: '#1C1B1F', verticalAlign: 'top' as const }
