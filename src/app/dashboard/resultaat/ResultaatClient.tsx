'use client'

// src/app/dashboard/resultaat/ResultaatClient.tsx
// [RESULT] The true quarterly picture across all channels (invoices + categorized
// bank + cash), honestly de-duplicated. Fetches /api/result.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BackLink } from '@/components/ui/BackLink'
import { useSearchParams } from 'next/navigation'
import { quarterFromParams } from '@/lib/quarter'

const M3 = {
  primary: '#1A73E8', onSurface: '#202124', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', success: '#137333', error: '#B3261E',
  warning: '#7C5800', warningContainer: '#FEE8C4', primaryContainer: '#D3E3FD', onPrimaryContainer: '#041E49',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface Result {
  omzet: number; kosten: number; resultaat: number
  btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number
  cashOmzetZonderBtw: number
}
// [TRIANGLE] Card-takings reconciliation summary from /api/result.
interface Reconciliation {
  totalCommission: number; commissionBooked: number; acquirerFeeInvoices: number
  grossMismatchDays: number; incompleteDays: number; eftSettlements: number
}
interface Data { ok: boolean; label: string; result: Result; reconciliation?: Reconciliation }

export default function ResultaatClient() {
  const sp = useSearchParams()
  // [QUARTER] Honour ?year&quarter, else default to the last COMPLETED quarter — the same
  // default klaar/aangifte use — so the three surfaces always show the same quarter.
  const initial = quarterFromParams((k) => sp.get(k))
  const [year, setYear] = useState(initial.year)
  const [quarter, setQuarter] = useState<number>(initial.quarter)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const curYear = new Date().getFullYear()

  useEffect(() => {
    let cancelled = false
    setLoading(true); setData(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/result?year=${year}&quarter=${quarter}`)
        const json = await res.json()
        if (!cancelled && res.ok) setData(json)
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [year, quarter])

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <BackLink style={{ color: M3.primary }} />

        <header style={{ margin: '16px 0 20px' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: M3.onSurface, margin: '0 0 2px' }}>Resultaat</h1>
          <p style={{ fontSize: 15, color: M3.neutral, margin: 0 }}>
            {data ? data.label : 'Dit kwartaal'} · bank, facturen én kas samen
          </p>
        </header>

        {/* [QUARTER] Quarter picker — parity with klaar/aangifte. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 18 }}>
          {[1, 2, 3, 4].map((q) => {
            const active = quarter === q
            return (
              <button key={q} onClick={() => setQuarter(q)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, border: `1px solid ${active ? M3.primary : M3.outlineVariant}`, background: active ? M3.primary : M3.surface, color: active ? '#fff' : M3.onSurface, fontFamily: FONT }}>Q{q}</button>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6 }}>
            <button onClick={() => setYear((y) => Math.max(2000, y - 1))} title="Vorig jaar" style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer', color: M3.primary, fontSize: 18, lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, minWidth: 38, textAlign: 'center' }}>{year}</span>
            <button onClick={() => setYear((y) => Math.min(y + 1, curYear))} disabled={year >= curYear} style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: year >= curYear ? 'default' : 'pointer', color: year >= curYear ? M3.outlineVariant : M3.primary, fontSize: 18, lineHeight: 1, opacity: year >= curYear ? 0.5 : 1 }}>›</button>
          </div>
        </div>

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

            {/* [TRIANGLE] Card reconciliation — shown only when there's card activity. The
                commission is already IN the resultaat above; this makes it visible and
                flags days where the till and the terminal disagree (a real difference). */}
            {data.reconciliation && (data.reconciliation.eftSettlements > 0 || data.reconciliation.commissionBooked > 0 || data.reconciliation.grossMismatchDays > 0) && (
              <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 18, marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>KAART-CONTROLE (kassa · terminal · bank)</div>
                <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
                  <Metric label="Acquirer-commissie" value={eur.format(data.reconciliation.commissionBooked)} color={M3.onSurface} />
                  <Metric label="Terminal-afrekeningen" value={String(data.reconciliation.eftSettlements)} color={M3.onSurface} />
                </div>
                <div style={{ fontSize: 12.5, color: '#9aa0a6', marginTop: 8, lineHeight: 1.5 }}>
                  De commissie is verwerkt in het resultaat hierboven en is BTW-vrij (vrijstelling betalingsverkeer).
                </div>
                {data.reconciliation.grossMismatchDays > 0 && (
                  <div style={{ background: M3.warningContainer, borderRadius: 12, padding: '10px 12px', marginTop: 10, fontSize: 13, color: M3.warning }}>
                    {data.reconciliation.grossMismatchDays} dag(en) waar de kassa-PIN ≠ de terminal-afrekening — een echt verschil (ontbrekende bon of terminalstoring). Controleer die dagen.
                  </div>
                )}
                {data.reconciliation.incompleteDays > 0 && (
                  <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 8 }}>
                    {data.reconciliation.incompleteDays} dag(en) nog niet compleet — upload de terminal-afrekening of het bankafschrift voor een volledige controle.
                  </div>
                )}
              </div>
            )}

            {/* Honest nudge: cash sales without a BTW rate aren't in the BTW figure. */}
            {data.result.cashOmzetZonderBtw > 0 && (
              <div style={{ background: M3.warningContainer, borderRadius: 14, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: M3.warning }}>
                {eur.format(data.result.cashOmzetZonderBtw)} omzet is nog zonder BTW-tarief geboekt (contante omzet, bankomzet of een
                niet-gesplitste kassadag) — die BTW zit dus niet in dit bedrag. Ken het tarief toe bij Kas of Dagomzet voor een compleet BTW-cijfer.
              </div>
            )}

            <p style={{ fontSize: 12.5, color: '#9aa0a6', margin: '4px 2px 16px', lineHeight: 1.5 }}>
              Voorbelasting komt alleen van facturen en bonnen (een kale bank- of kasregel levert geen BTW-aftrek op).
              Overboekingen, privé en belasting tellen niet mee als omzet of kosten.
            </p>

            {/* Primary next step: the concept BTW-aangifte (rubrieken 1a/1b/5a/5b/5g) —
                the same figures shown here, mapped to the Belastingdienst-vakken. Carries
                the SAME year/quarter so it opens on the quarter you're looking at. The
                redundant "/dashboard/quarterly" owner link was removed (it showed an
                invoice-only, different number — the two-parallel-surfaces confusion). */}
            <Link href={`/dashboard/aangifte?year=${year}&quarter=${quarter}`} style={{
              display: 'block', textAlign: 'center', padding: '12px', borderRadius: 12,
              border: `1px solid ${M3.primary}`, color: M3.primary, textDecoration: 'none', fontSize: 15, fontWeight: 600,
            }}>
              Concept BTW-aangifte →
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
