'use client'

// src/app/dashboard/dagomzet/TurnoverInsights.tsx
// [TURNOVER-ANALYTICS] Compact insight panel over the imported daily turnover for the
// current quarter. Honest scope only: trend, VAT mix, payment mix, average day, average
// PIN ticket, anomalies. No best-sellers / peak-hours (needs line-level data we don't
// have). Reads /api/turnover/analytics; all math is server-side and pure.

import { useEffect, useState, type ReactNode } from 'react'
import { M3, FONT_NUM } from '@/lib/design/tokens'

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

interface DayRow { date: string; total: number }

export default function TurnoverInsights() {
  const [data, setData] = useState<{ label: string; year: number; quarter: number; analytics: Analytics; days: DayRow[] } | null>(null)
  const [loading, setLoading] = useState(true)
  // null = "let the server pick the latest quarter that has data"; set = an explicit quarter to view.
  const [period, setPeriod] = useState<{ year: number; quarter: number } | null>(null)
  // [COHERENCE-TURNOVER-DELETE] bumped after a successful day-delete to re-fetch this panel.
  const [reloadTick, setReloadTick] = useState(0)
  const [manageOpen, setManageOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const qs = period ? `?year=${period.year}&quarter=${period.quarter}` : ''
        const res = await fetch(`/api/turnover/analytics${qs}`)
        const json = await res.json()
        if (!cancelled && res.ok) setData({ label: json.label, year: json.year, quarter: json.quarter, analytics: json.analytics, days: json.days ?? [] })
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [period, reloadTick])

  // [COHERENCE-TURNOVER-DELETE] Remove one wrong-date booked day. Calls the audited
  // DELETE handler, then re-fetches so the KPIs/BTW reflect the correction immediately.
  async function deleteDay(date: string) {
    setDeleting(date); setDeleteError(null)
    try {
      const res = await fetch(`/api/turnover/import?date=${encodeURIComponent(date)}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setDeleteError(j.error || 'Kon de dag niet verwijderen — probeer opnieuw.')
        return
      }
      setPendingDelete(null)
      setReloadTick((t) => t + 1)
    } catch {
      setDeleteError('Er ging iets mis — probeer opnieuw.')
    } finally {
      setDeleting(null)
    }
  }

  // Move between quarters. Anchors on the currently-shown period (server-picked on first load).
  const shift = (delta: number) => {
    const base = period ?? (data ? { year: data.year, quarter: data.quarter } : null)
    if (!base) return
    let q = base.quarter + delta, y = base.year
    while (q < 1) { q += 4; y -= 1 }
    while (q > 4) { q -= 4; y += 1 }
    setPeriod({ year: y, quarter: q })
  }

  if (loading && !data) return null
  const a = data?.analytics
  const days: DayRow[] = data?.days ?? []
  // Nothing booked yet AND the owner hasn't navigated → no empty panel at all.
  if (period === null && (!a || a.days === 0)) return null

  const maxMonth = a ? Math.max(...a.monthly.map((m) => m.omzet), 1) : 1

  const Nav = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => shift(-1)} aria-label="Vorig kwartaal"
        style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, lineHeight: 1, color: M3.onSurface }}>‹</button>
      <div style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, minWidth: 64, textAlign: 'center' }}>{data?.label ?? '—'}</div>
      <button onClick={() => shift(1)} aria-label="Volgend kwartaal"
        style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, lineHeight: 1, color: M3.onSurface }}>›</button>
    </div>
  )

  // The owner navigated to a quarter with no booked omzet — keep the panel + nav so they can move on.
  if (!a || a.days === 0) {
    return (
      <div style={{ marginTop: 24, background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${M3.outlineVariant}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 13, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em' }}>Geboekte omzet</div>
          {Nav}
        </div>
        <div style={{ padding: '20px 18px', fontSize: 13.5, color: M3.neutral }}>Geen kassa-omzet geboekt in {data?.label}.</div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 24, background: M3.surface, borderRadius: 14, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${M3.outlineVariant}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13, color: M3.neutral, textTransform: 'uppercase', letterSpacing: '.04em' }}>Geboekte omzet</div>
        {Nav}
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

      {/* [COHERENCE-TURNOVER-DELETE] Manage booked days — the only way to REMOVE a
          wrong-date/wrong-period day that would otherwise feed the BTW-aangifte forever.
          Collapsed by default so it never distracts from the insights. */}
      {days.length > 0 && (
        <div style={{ borderTop: `1px solid ${M3.outlineVariant}` }}>
          <button
            onClick={() => setManageOpen((o) => !o)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span style={{ fontSize: 12.5, color: M3.neutral }}>Geboekte dagen beheren ({days.length})</span>
            <span style={{ fontSize: 13, color: M3.primary, fontWeight: 600 }}>{manageOpen ? 'Verbergen' : 'Tonen'}</span>
          </button>
          {manageOpen && (
            <div style={{ padding: '0 18px 14px' }}>
              <p style={{ fontSize: 12, color: M3.neutral, margin: '0 0 10px', lineHeight: 1.5 }}>
                Staat hier een dag met de verkeerde datum of uit een andere periode? Verwijder hem —
                dat corrigeert je omzet en BTW-aangifte. Daarna kun je het juiste Z-rapport opnieuw importeren.
              </p>
              {deleteError && (
                <p style={{ fontSize: 12.5, color: M3.error, margin: '0 0 10px' }}>{deleteError}</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${M3.outlineVariant}`, borderRadius: 10, overflow: 'hidden' }}>
                {days.map((d, i) => (
                  <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i > 0 ? `1px solid ${M3.outlineVariant}` : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: M3.onSurface, fontFamily: FONT_NUM }}>{d.date}</div>
                      <div style={{ fontSize: 12, color: M3.neutral, fontFamily: FONT_NUM }}>{eur.format(d.total)}</div>
                    </div>
                    {pendingDelete === d.date ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: M3.neutral }}>Zeker weten?</span>
                        <button onClick={() => deleteDay(d.date)} disabled={deleting === d.date}
                          style={{ border: 'none', background: M3.error, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                          {deleting === d.date ? 'Bezig…' : 'Verwijder'}
                        </button>
                        <button onClick={() => setPendingDelete(null)} disabled={deleting === d.date}
                          style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.neutral, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, cursor: 'pointer' }}>
                          Nee
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setPendingDelete(d.date); setDeleteError(null) }} aria-label={`Verwijder ${d.date}`}
                        style={{ border: 'none', background: 'none', color: M3.error, cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>delete</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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
