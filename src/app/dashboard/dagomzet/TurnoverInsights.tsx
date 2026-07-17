'use client'

// src/app/dashboard/dagomzet/TurnoverInsights.tsx
// [TURNOVER-ANALYTICS] Compact insight panel over the imported daily turnover for the
// current quarter. Honest scope only: trend, VAT mix, payment mix, average day, average
// PIN ticket, anomalies. No best-sellers / peak-hours (needs line-level data we don't
// have). Reads /api/turnover/analytics; all math is server-side and pure.

import { useEffect, useState, type ReactNode } from 'react'

const M3 = {
  primary: '#1A73E8', onSurface: '#202124', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', track: '#EEF1F4', warning: '#7C5800', warningContainer: '#FEE8C4',
}
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const pct = (x: number) => `${Math.round(x * 100)}%`

interface Analytics {
  days: number
  totalOmzetIncl: number; totalNet: number; avgDayOmzet: number
  busiestDay: { date: string; omzet: number } | null
  quietestDay: { date: string; omzet: number } | null
  monthly: { month: string; omzet: number }[]
  vatMix: { rate: 0 | 9 | 21; net: number; share: number }[]
  payment: { pin: number; cash: number; other: number; pinShare: number; cashShare: number; otherShare: number }
  avgPinTicket: number | null; posTicketCount: number | null
  anomalies: { date: string; omzet: number; direction: 'hoog' | 'laag' }[]
}

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const monthLabel = (ym: string) => { const m = /^\d{4}-(\d{2})$/.exec(ym); return m ? MONTHS[Number(m[1]) - 1] : ym }

export default function TurnoverInsights() {
  const [data, setData] = useState<{ label: string; analytics: Analytics } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/turnover/analytics')
        const json = await res.json()
        if (!cancelled && res.ok) setData({ label: json.label, analytics: json.analytics })
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) return null
  const a = data?.analytics
  if (!a || a.days === 0) return null // nothing imported yet → no empty panel

  const maxMonth = Math.max(...a.monthly.map((m) => m.omzet), 1)

  return (
    <div style={{ marginTop: 24, background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
        <div style={{ fontSize: 13, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em' }}>Inzicht — {data?.label}</div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, padding: '16px 18px' }}>
        <Kpi label={`Omzet (${a.days} dagen)`} value={eur.format(a.totalOmzetIncl)} />
        <Kpi label="Gemiddeld per dag" value={eur.format(a.avgDayOmzet)} />
        {a.busiestDay && <Kpi label="Drukste dag" value={eur.format(a.busiestDay.omzet)} sub={a.busiestDay.date} />}
        {a.avgPinTicket != null
          ? <Kpi label="Gem. pinbon" value={eur.format(a.avgPinTicket)} sub={a.posTicketCount ? `${a.posTicketCount} pintransacties` : undefined} />
          : <Kpi label="Gem. pinbon" value="—" sub="geen pin-aantallen in de bank" />}
      </div>

      {/* Monthly trend */}
      {a.monthly.length > 1 && (
        <Section title="Omzet per maand">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 90, padding: '4px 0' }}>
            {a.monthly.map((m) => (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <div title={eur.format(m.omzet)} style={{ width: '100%', maxWidth: 48, height: `${Math.max(4, (m.omzet / maxMonth) * 64)}px`, background: M3.primary, borderRadius: 4 }} />
                <div style={{ fontSize: 11, color: M3.neutral, fontFamily: FONT_NUM }}>{monthLabel(m.month)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* VAT mix */}
      <Section title="BTW-verdeling (aandeel van de netto-omzet)">
        {a.vatMix.filter((v) => v.net > 0).map((v) => (
          <MixRow key={v.rate} label={`${v.rate}%`} share={v.share} amount={eur.format(v.net)} />
        ))}
      </Section>

      {/* Payment mix */}
      <Section title="Betaalwijzen">
        <MixRow label="PIN" share={a.payment.pinShare} amount={eur.format(a.payment.pin)} />
        <MixRow label="Contant" share={a.payment.cashShare} amount={eur.format(a.payment.cash)} />
        {a.payment.other > 0 && <MixRow label="Overig" share={a.payment.otherShare} amount={eur.format(a.payment.other)} />}
      </Section>

      {/* Anomalies */}
      {a.anomalies.length > 0 && (
        <div style={{ padding: '14px 18px', background: M3.warningContainer, borderTop: `1px solid ${M3.outlineVariant}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: M3.warning, marginBottom: 6 }}>Opvallende dagen</div>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {a.anomalies.map((x) => (
              <li key={x.date} style={{ fontSize: 13, color: M3.onSurface, lineHeight: 1.5 }}>
                {x.date} — ongewoon {x.direction} ({eur.format(x.omzet)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: M3.neutral, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface, fontFamily: FONT_NUM }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 2, fontFamily: FONT_NUM }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '14px 18px', borderTop: `1px solid ${M3.outlineVariant}` }}>
      <div style={{ fontSize: 12.5, color: M3.neutral, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

function MixRow({ label, share, amount }: { label: string; share: number; amount: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 56, fontSize: 13, color: M3.onSurface, fontFamily: FONT_NUM }}>{label}</div>
      <div style={{ flex: 1, height: 10, background: M3.track, borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: pct(share), height: '100%', background: M3.primary }} />
      </div>
      <div style={{ width: 48, textAlign: 'right', fontSize: 12.5, color: M3.neutral, fontFamily: FONT_NUM }}>{pct(share)}</div>
      <div style={{ width: 92, textAlign: 'right', fontSize: 12.5, color: M3.onSurface, fontFamily: FONT_NUM }}>{amount}</div>
    </div>
  )
}
