'use client'

// src/app/dashboard/zzp/DailyTruth.tsx
// [HONEST-HOME] The owner's home snapshot — answers one question: "waar sta ik?"
//
// It shows ONLY facts the system can PROVE, and each fact is a BUTTON to the one
// place that resolves it:
//   1. Te betalen     — confirmed unpaid supplier bills (exact stored total) → manage
//   2. Te ontvangen   — your unpaid sent invoices (exact stored total)       → facturen
//   3. Nog te documenteren — bank debits without a document (a COUNT)        → bank
//
// It never shows a computed income/expense/net figure. The earlier version did, from
// the bank statement, and it was wrong for normal banking (transfers, tax, private
// mixed in) — which is why it was disabled. Numbers here are sums of STORED invoice
// totals (exact) or plain task counts. Freshness ("bank bijgewerkt tot …") is shown
// honestly so we never imply real-time data.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const M3 = {
  primary:            '#1A73E8',
  onPrimaryContainer: '#041E49',
  primaryContainer:   '#D3E3FD',
  surface:            '#FFFFFF',
  onSurface:          '#1C1B1F',
  success:            '#137333',
  successContainer:   '#CEEAD6',
  warning:            '#7C5800',
  warningContainer:   '#FEE8C4',
  neutral:            '#5F6368',
  outlineVariant:     '#E0E0E0',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const R = { lg: 16, full: 999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface Bucket { count: number; total: number; overdue: number }
interface TruthData {
  ok: boolean
  toPay: Bucket
  toReceive: Bucket
  bank: { lastDate: string | null; undocumented: number }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
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

  if (loading) {
    return <div style={{ height: 148, borderRadius: R.lg, background: '#F5F5F7', marginBottom: 16 }} />
  }
  if (!data?.ok) return null

  const { toPay, toReceive, bank } = data
  const lastDate = formatDate(bank.lastDate)
  const allClear = toPay.count === 0 && toReceive.count === 0 && bank.undocumented === 0

  return (
    <div style={{ marginBottom: 20, fontFamily: FONT }}>
      {/* Header + honest freshness note */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 2px 10px' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>
          WAAR JE STAAT
        </span>
        {lastDate && (
          <span style={{ fontSize: 11.5, color: '#9aa0a6' }}>bank bijgewerkt tot {lastDate}</span>
        )}
      </div>

      {allClear ? (
        <div style={{
          background: M3.successContainer, borderRadius: R.lg, padding: '18px 16px',
          boxShadow: EL1, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22 }}>✓</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0B5345' }}>Alles is bij</div>
            <div style={{ fontSize: 13, color: '#0B5345', marginTop: 2 }}>
              Niets openstaand en niets te documenteren.
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Two money facts — sums of STORED totals (exact). Side by side. */}
          <div style={{ display: 'flex', gap: 10 }}>
            <MoneyCard
              label="Te betalen"
              bucket={toPay}
              emptyText="Niets te betalen"
              subject="inkoopfactuur"
              onClick={() => router.push('/dashboard/incoming/manage')}
            />
            <MoneyCard
              label="Te ontvangen"
              bucket={toReceive}
              emptyText="Niets openstaand"
              subject="factuur"
              onClick={() => router.push('/dashboard/facturen')}
            />
          </div>

          {/* One task count — never a money figure. */}
          <button
            onClick={() => router.push('/dashboard/bank')}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
              marginTop: 10, borderRadius: R.lg, padding: '14px 16px',
              background: bank.undocumented > 0 ? M3.warningContainer : M3.surface,
              boxShadow: EL1,
              border: `1px solid ${bank.undocumented > 0 ? 'transparent' : M3.outlineVariant}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: bank.undocumented > 0 ? M3.warning : M3.onSurface }}>
                Nog te documenteren
              </div>
              <div style={{ fontSize: 12.5, color: bank.undocumented > 0 ? M3.warning : M3.neutral, marginTop: 2 }}>
                {bank.undocumented > 0
                  ? `${bank.undocumented} ${bank.undocumented === 1 ? 'transactie zonder bon' : 'transacties zonder bon'}`
                  : 'Alle uitgaven hebben een bon'}
              </div>
            </div>
            <span style={{ fontFamily: FONT_NUM, fontSize: 20, fontWeight: 700, color: bank.undocumented > 0 ? M3.warning : M3.success }}>
              {bank.undocumented > 0 ? bank.undocumented : '✓'}
            </span>
          </button>
        </>
      )}
    </div>
  )
}

// A single money fact: exact stored total + count, or a calm empty state.
function MoneyCard({ label, bucket, emptyText, subject, onClick }: {
  label: string; bucket: Bucket; emptyText: string; subject: string; onClick: () => void
}) {
  const has = bucket.count > 0
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
        borderRadius: R.lg, padding: '14px 16px', minWidth: 0,
        background: has ? M3.primaryContainer : M3.surface,
        boxShadow: EL1,
        border: `1px solid ${has ? 'transparent' : M3.outlineVariant}`,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: has ? M3.onPrimaryContainer : M3.neutral }}>
        {label}
      </div>
      {has ? (
        <>
          <div style={{ fontFamily: FONT_NUM, fontSize: 19, fontWeight: 700, color: M3.onPrimaryContainer, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {eur.format(bucket.total)}
          </div>
          <div style={{ fontSize: 11.5, color: '#3c4043', marginTop: 2 }}>
            {bucket.count} {bucket.count === 1 ? subject : `${subject}s`}
            {bucket.overdue > 0 ? ` · ${bucket.overdue} over datum` : ''}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: M3.neutral, marginTop: 6 }}>{emptyText}</div>
      )}
    </button>
  )
}
