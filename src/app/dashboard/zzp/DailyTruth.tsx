'use client'

// src/app/dashboard/zzp/DailyTruth.tsx
// [HONEST-HOME] The owner's home snapshot — two layers of one question:
//   A. "Waar sta ik?"  — certain TOTALS (exact sums of STORED invoice totals + a
//      task count). Each is a button to the surface that manages it.
//   B. "Wat nu?"       — a PREVIEW of the items that need action now (overdue or due
//      ≤ 3 days), the same to-do the Vandaag page lists, with "Alle N bekijken →".
//
// It never shows a computed income/expense/net figure (the earlier version did, from
// the bank statement, and it was wrong for normal banking — which is why it was
// disabled). Numbers here are exact stored totals or plain counts. Freshness is shown
// honestly so we never imply real-time data.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const M3 = {
  primary:            '#1A73E8',
  onPrimaryContainer: '#041E49',
  primaryContainer:   '#D3E3FD',
  surface:            '#FFFFFF',
  onSurface:          '#202124',
  success:            '#137333',
  successContainer:   '#CEEAD6',
  warning:            '#7C5800',
  warningContainer:   '#FEE8C4',
  error:              '#B3261E',
  neutral:            '#5F6368',
  outlineVariant:     '#E0E0E0',
  hairline:           '#ECEFF1',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const R = { lg: 16, full: 999 }
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'
const LONG_OPEN_DAYS = 30

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

interface Bucket { count: number; total: number; overdue: number }
interface AttentionItem {
  id: string
  party: string | null
  invoiceNumber: string | null
  dueDate: string | null
  total: number
  direction: 'incoming' | 'outgoing'
}
interface TruthData {
  ok: boolean
  toPay: Bucket
  toReceive: Bucket
  bank: { lastDate: string | null; undocumented: number }
  kas?: { used: boolean; balance: number }
  attention: AttentionItem[]
  attentionCount: number
}

// ── Date helpers (timezone-proof, mirrors VandaagClient) ──────────────────────
function dayNumberFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return NaN
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / 86_400_000)
}
function todayDayNumber(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  return dayNumberFromIso(parts)
}
function daysUntilDue(dueIso: string): number {
  return dayNumberFromIso(dueIso) - todayDayNumber()
}
function dueLabel(dueIso: string): string {
  const d = daysUntilDue(dueIso)
  if (d <= -LONG_OPEN_DAYS) return 'Al lang open'
  if (d < 0) return Math.abs(d) === 1 ? '1 dag te laat' : `${Math.abs(d)} dagen te laat`
  if (d === 0) return 'Vervalt vandaag'
  if (d === 1) return 'Vervalt morgen'
  return `Vervalt over ${d} dagen`
}
function dueAccent(dueIso: string): string {
  const d = daysUntilDue(dueIso)
  return d < 0 && d > -LONG_OPEN_DAYS ? M3.error : M3.warning
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

  const { toPay, toReceive, bank, attention, attentionCount } = data
  const lastDate = formatDate(bank.lastDate)
  // [NO-CODEER] Uncoded bank debits no longer count as "not clear" — coding a bare debit
  // gives no BTW and can double-count an invoice, so it isn't an open task the owner owes.
  // "Alles is bij" now reflects only real open money: nothing to pay and nothing to receive.
  const allClear = toPay.count === 0 && toReceive.count === 0

  // incoming → the manage surface (pay / mark paid); outgoing → the invoice detail.
  const openItem = (it: AttentionItem) =>
    router.push(
      it.direction === 'incoming'
        ? `/dashboard/incoming/manage?focus=${it.id}`
        : `/dashboard/invoice/${it.id}`
    )

  return (
    <div style={{ marginBottom: 20, fontFamily: FONT }}>
      {/* ── Layer A: WAAR JE STAAT (certain totals) ── */}
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
          <div style={{ display: 'flex', gap: 10 }}>
            <MoneyCard label="Te betalen" bucket={toPay} emptyText="Niets te betalen"
              subject="inkoopfactuur" onClick={() => router.push('/dashboard/incoming/manage')} />
            <MoneyCard label="Te ontvangen" bucket={toReceive} emptyText="Niets openstaand"
              subject="factuur" onClick={() => router.push('/dashboard/facturen')} />
          </div>
        </>
      )}

      {/* [NO-CODEER] The per-line bank-categorize entry was removed on purpose. For a
          retail administration costs come in on the INCOMING invoice (which carries the
          BTW to reclaim) and revenue from the Z-report/dagomzet — hand-coding a bare bank
          debit gives no voorbelasting and can double-count an invoice already booked, so
          the "give every transaction a category" flow was more busywork than truth. The
          page + API still exist (reachable by URL) if we ever re-enable it; the readiness
          screen still flags genuinely unexplained INCOME (money in with no invoice). */}

      {/* [CASH-LEDGER] Kas line — only when the owner actually uses cash. */}
      {data.kas?.used && (
        <button
          onClick={() => router.push('/dashboard/kas')}
          style={{
            width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
            marginTop: 10, borderRadius: R.lg, padding: '14px 16px',
            background: M3.surface, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>Kas — in kassa</div>
          <span style={{ fontFamily: FONT_NUM, fontSize: 18, fontWeight: 700, color: data.kas.balance < 0 ? '#B3261E' : M3.onSurface }}>
            {eur.format(data.kas.balance)}
          </span>
        </button>
      )}

      {/* ── Layer B: DIT HEEFT JE AANDACHT NODIG (item preview → Vandaag) ── */}
      {attention.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ margin: '0 2px 10px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>
              DIT HEEFT JE AANDACHT NODIG
            </span>
          </div>

          <div style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, border: `1px solid ${M3.outlineVariant}`, overflow: 'hidden' }}>
            {attention.map((it, i) => (
              <AttentionRow key={it.id} item={it} onClick={() => openItem(it)} divider={i > 0} />
            ))}

            {/* "Alle N bekijken →" — the full list lives on Vandaag. */}
            <button
              onClick={() => router.push('/dashboard/vandaag')}
              style={{
                width: '100%', textAlign: 'center', cursor: 'pointer', fontFamily: FONT,
                padding: '12px', border: 'none', borderTop: `1px solid ${M3.hairline}`,
                background: 'transparent', color: M3.primary, fontSize: 14, fontWeight: 600,
              }}
            >
              {attentionCount > attention.length
                ? `Alle ${attentionCount} bekijken →`
                : 'Alles bekijken →'}
            </button>
          </div>
        </div>
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

// A compact preview row for one item that needs action. One tap → its resolve surface.
// A negative incoming total is a creditnota (it REDUCES what you owe) — never "pay".
function AttentionRow({ item, onClick, divider }: {
  item: AttentionItem; onClick: () => void; divider: boolean
}) {
  const isCredit = item.direction === 'incoming' && item.total < 0
  const accent = item.dueDate ? dueAccent(item.dueDate) : M3.neutral

  // [HONEST-HOME] Make money-out vs money-in unmistakable at a glance — the same
  // vocabulary as the totals above ("Te betalen" / "Te ontvangen"), so a daily user
  // never has to wonder "is this a bill I owe or an invoice owed to me?".
  const kind = isCredit ? 'Creditnota' : item.direction === 'incoming' ? 'Te betalen' : 'Te ontvangen'
  const kindColor = item.direction === 'incoming' ? '#8A4B00' : M3.primary
  const dueText = !isCredit && item.dueDate ? dueLabel(item.dueDate) : ''

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
        border: 'none', background: 'transparent',
        borderTop: divider ? `1px solid ${M3.hairline}` : 'none',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.party?.trim() || 'Onbekende partij'}
        </div>
        <div style={{ fontSize: 12.5, marginTop: 2 }}>
          <span style={{ color: kindColor, fontWeight: 600 }}>{kind}</span>
          {dueText && <span style={{ color: accent, fontWeight: 500 }}> · {dueText}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: isCredit ? M3.success : M3.onSurface, whiteSpace: 'nowrap' }}>
          {eur.format(item.total)}
        </div>
      </div>
      <span className="material-symbols-outlined" style={{ color: '#9aa0a6', fontSize: 20, flexShrink: 0 }}>chevron_right</span>
    </button>
  )
}
