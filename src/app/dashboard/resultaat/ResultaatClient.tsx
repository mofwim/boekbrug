'use client'

// src/app/dashboard/resultaat/ResultaatClient.tsx
// [RESULT] The true quarterly picture across all channels (invoices + categorized
// bank + cash), honestly de-duplicated. Fetches /api/result.

import { useEffect, useState } from 'react'
import Link from 'next/link'

const M3 = {
  primary: '#1A73E8', onSurface: '#1C1B1F', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', success: '#137333', error: '#B3261E',
  warning: '#7C5800', warningContainer: '#FEE8C4', primaryContainer: '#D3E3FD', onPrimaryContainer: '#041E49',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface Result {
  omzet: number; kosten: number; resultaat: number
  btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number
  cashOmzetZonderBtw: number
}
interface Data { ok: boolean; label: string; result: Result }

export default function ResultaatClient() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/result')
        const json = await res.json()
        if (!cancelled && res.ok) setData(json)
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <Link href="/dashboard" style={{ fontSize: 14, color: M3.primary, textDecoration: 'none' }}>← Terug</Link>

        <header style={{ margin: '16px 0 20px' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: M3.onSurface, margin: '0 0 2px' }}>Resultaat</h1>
          <p style={{ fontSize: 15, color: M3.neutral, margin: 0 }}>
            {data ? data.label : 'Dit kwartaal'} · bank, facturen én kas samen
          </p>
        </header>

        {loading ? (
          <div style={{ height: 220, borderRadius: 16, background: '#F0F1F3' }} />
        ) : !data?.ok ? (
          <div style={{ color: M3.neutral, fontSize: 14 }}>Kon het resultaat niet laden.</div>
        ) : (
          <>
            {/* Result headline */}
            <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>RESULTAAT (excl. BTW)</div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 32, fontWeight: 700, marginTop: 4, color: data.result.resultaat >= 0 ? M3.success : M3.error }}>
                {data.result.resultaat >= 0 ? '+' : '−'}{eur.format(Math.abs(data.result.resultaat))}
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
                <Metric label="Omzet" value={eur.format(data.result.omzet)} color={M3.onSurface} />
                <Metric label="Kosten" value={eur.format(data.result.kosten)} color={M3.onSurface} />
              </div>
            </div>

            {/* BTW block */}
            <div style={{ background: M3.primaryContainer, borderRadius: 16, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.onPrimaryContainer }}>BTW DIT KWARTAAL</div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 28, fontWeight: 700, marginTop: 4, color: M3.onPrimaryContainer }}>
                {eur.format(Math.abs(data.result.btwSaldo))}
              </div>
              <div style={{ fontSize: 13, color: '#3c4043', marginTop: 2 }}>
                {data.result.btwSaldo >= 0 ? 'te betalen aan de Belastingdienst' : 'terug te ontvangen'}
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
                <Metric label="Verschuldigd" value={eur.format(data.result.btwVerschuldigd)} color={M3.onPrimaryContainer} />
                <Metric label="Voorbelasting" value={eur.format(data.result.btwVoorbelasting)} color={M3.onPrimaryContainer} />
              </div>
            </div>

            {/* Honest nudge: cash sales without a BTW rate aren't in the BTW figure. */}
            {data.result.cashOmzetZonderBtw > 0 && (
              <div style={{ background: M3.warningContainer, borderRadius: 14, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: M3.warning }}>
                {eur.format(data.result.cashOmzetZonderBtw)} contante omzet is nog zonder BTW-tarief geboekt — die BTW zit
                dus niet in dit bedrag. Vul het tarief in bij Kas voor een compleet BTW-cijfer.
              </div>
            )}

            <p style={{ fontSize: 12.5, color: '#9aa0a6', margin: '4px 2px 16px', lineHeight: 1.5 }}>
              Voorbelasting komt alleen van facturen en bonnen (een kale bank- of kasregel levert geen BTW-aftrek op).
              Overboekingen, privé en belasting tellen niet mee als omzet of kosten.
            </p>

            {/* Primary next step: the concept BTW-aangifte (rubrieken 1a/1b/5a/5b/5g) —
                the same figures shown here, mapped to the Belastingdienst-vakken. The
                button used to be labelled "BTW-aangifte" but pointed at /quarterly
                (detailed per-factuur cijfers), sending the owner to the wrong surface. */}
            <Link href="/dashboard/aangifte" style={{
              display: 'block', textAlign: 'center', padding: '12px', borderRadius: 12,
              border: `1px solid ${M3.primary}`, color: M3.primary, textDecoration: 'none', fontSize: 15, fontWeight: 600,
            }}>
              Concept BTW-aangifte →
            </Link>
            <Link href="/dashboard/quarterly" style={{
              display: 'block', textAlign: 'center', padding: '10px', marginTop: 8,
              color: '#9aa0a6', textDecoration: 'none', fontSize: 13, fontWeight: 500,
            }}>
              Gedetailleerde cijfers per kwartaal →
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#5F6368' }}>{label}</div>
      <div style={{ fontFamily: FONT_NUM, fontSize: 16, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}
