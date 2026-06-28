'use client'

// src/app/dashboard/zzp/DailyTruth.tsx
// [DAILY-TRUTH] An honest financial snapshot for the owner's home screen.
//
// Goal (decided this session): a LIVE, HONEST picture for the owner — not
// matching for the accountant. It sits at the TOP of the home screen so the
// owner sees their financial reality before the action buttons. It never
// pretends: the bank statement is uploaded manually, so we say how current the
// numbers are ("bijgewerkt tot {date}") rather than implying real-time data.
//
// Three honest facts, in priority order for a shop owner:
//   1. Openstaand te betalen  — confirmed bills not yet paid (what you owe)
//   2. Dit kwartaal           — paid income vs expense (where you stand)
//   3. Nog te documenteren    — bank transactions still missing a document
//      (the honest "not done yet" — the same truth Brug's status must reflect)
//
// Self-contained: fetches /api/daily-truth on mount. Material You tokens to match
// ZzpDashboard. Default export (Turbopack RSC requirement for 'use client').

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const M3 = {
  primary:            '#1A73E8',
  onPrimary:          '#FFFFFF',
  primaryContainer:   '#D3E3FD',
  onPrimaryContainer: '#041E49',
  surface:            '#FFFFFF',
  onSurface:          '#1C1B1F',
  success:            '#34A853',
  successContainer:   '#CEEAD6',
  warning:            '#E37400',
  warningContainer:   '#FEE8C4',
  error:              '#B3261E',
  errorContainer:     '#FCD8DF',
  neutral:            '#5F6368',
  outlineVariant:     '#E0E0E0',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const R = { md: 12, lg: 16, full: 999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface TruthData {
  ok: boolean
  quarterLabel: string
  openBills: { count: number; total: number; overdue: number }
  quarter: { income: number; expense: number; net: number }
  bank: { lastDate: string | null; undocumented: number }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })
}

export default function DailyTruth() {
  const router = useRouter()
  const [data, setData] = useState<TruthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/daily-truth')
        const json = await res.json()
        if (!cancelled && res.ok) setData(json)
      } catch {
        /* silent — the panel just doesn't render rather than showing an error */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // While loading, reserve space quietly (no jarring empty flash, no spinner noise).
  if (loading) {
    return (
      <div style={{ height: 132, borderRadius: R.lg, background: '#F5F5F7', marginBottom: 16 }} />
    )
  }
  if (!data?.ok) return null

  const { openBills, quarter, bank } = data
  const net = quarter.net
  const netPositive = net >= 0
  const lastDate = formatDate(bank.lastDate)

  return (
    <div style={{ marginBottom: 16, fontFamily: FONT }}>
      {/* Header row: title + honest freshness note */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 2px 10px' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>
          JE GELD VANDAAG
        </span>
        {lastDate && (
          <span style={{ fontSize: 11.5, color: '#9aa0a6' }}>
            bank bijgewerkt tot {lastDate}
          </span>
        )}
      </div>

      {/* Primary card: what you owe — the most actionable fact for an owner */}
      <button
        onClick={() => router.push('/dashboard/incoming/manage')}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
          border: 'none', borderRadius: R.lg, padding: 16, marginBottom: 10,
          background: openBills.count > 0 ? M3.primaryContainer : M3.successContainer,
          boxShadow: EL1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: openBills.count > 0 ? M3.onPrimaryContainer : '#0B5345' }}>
            {openBills.count > 0 ? 'Openstaand te betalen' : 'Niets openstaand'}
          </div>
          <div style={{ fontSize: 12, color: openBills.count > 0 ? '#3c4043' : '#0B5345', marginTop: 2 }}>
            {openBills.count > 0
              ? `${openBills.count} ${openBills.count === 1 ? 'factuur' : 'facturen'}${openBills.overdue > 0 ? ` · ${openBills.overdue} over de datum` : ''}`
              : 'Alle bevestigde inkoopfacturen zijn betaald'}
          </div>
        </div>
        {openBills.count > 0 && (
          <div style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: M3.onPrimaryContainer, whiteSpace: 'nowrap' }}>
            {eur.format(openBills.total)}
          </div>
        )}
      </button>

      {/* Secondary row: this quarter (income/expense/net) + still-to-document */}
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Quarter net */}
        <div style={{
          flex: 1, borderRadius: R.lg, padding: '12px 14px', background: M3.surface,
          boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`,
        }}>
          <div style={{ fontSize: 11.5, color: M3.neutral, fontWeight: 600 }}>Dit kwartaal</div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 17, fontWeight: 700, marginTop: 3, color: netPositive ? M3.success : M3.error }}>
            {netPositive ? '+' : '−'}{eur.format(Math.abs(net))}
          </div>
          <div style={{ fontSize: 11, color: '#9aa0a6', marginTop: 2 }}>
            in {eur.format(quarter.income)} · uit {eur.format(quarter.expense)}
          </div>
        </div>

        {/* Still to document — honest, links to the bank screen */}
        <button
          onClick={() => router.push('/dashboard/bank')}
          style={{
            flex: 1, textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
            borderRadius: R.lg, padding: '12px 14px',
            background: bank.undocumented > 0 ? M3.warningContainer : M3.surface,
            boxShadow: EL1, border: `1px solid ${bank.undocumented > 0 ? 'transparent' : M3.outlineVariant}`,
          }}
        >
          <div style={{ fontSize: 11.5, color: bank.undocumented > 0 ? '#8A4B00' : M3.neutral, fontWeight: 600 }}>
            Nog te documenteren
          </div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 17, fontWeight: 700, marginTop: 3, color: bank.undocumented > 0 ? M3.warning : M3.success }}>
            {bank.undocumented}
          </div>
          <div style={{ fontSize: 11, color: bank.undocumented > 0 ? '#8A4B00' : '#9aa0a6', marginTop: 2 }}>
            {bank.undocumented > 0 ? 'transacties zonder bon' : 'alles gedocumenteerd'}
          </div>
        </button>
      </div>
    </div>
  )
}