'use client'

// src/app/dashboard/kas/KasClient.tsx
// [CASH-LEDGER] The cash book. Running balance + a light add form + the ledger.
// Cash sales (in) and cash expenses (out); deposits/withdrawals to the bank are
// 'transfer' so they change the drawer balance but never the revenue/cost picture.

import { useEffect, useState } from 'react'
import Link from 'next/link'

const M3 = {
  primary: '#1A73E8', onPrimary: '#fff', onSurface: '#1C1B1F', neutral: '#5F6368',
  surface: '#FFFFFF', outlineVariant: '#E0E0E0', success: '#137333', error: '#B3261E',
  primaryContainer: '#D3E3FD',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

const CATS: { key: string; label: string }[] = [
  { key: 'omzet', label: 'Omzet' },
  { key: 'kosten', label: 'Kost' },
  { key: 'prive', label: 'Privé' },
  { key: 'transfer', label: 'Naar/van bank' },
]

interface Entry {
  id: string
  entry_date: string
  direction: 'in' | 'out'
  amount: number
  category: string
  description: string | null
}

// [KASBOEK] The live quarterly cash book (a pure projection over the truth layer — see
// /api/kasboek). Mirrors the shapes in lib/kasboek.ts, only the fields the panel renders.
interface KasRow { date: string; beginsaldo: number; ontvangsten: number; uitgaven: number; descriptions: string[]; eindsaldo: number }
interface KasMonth { key: string; label: string; rows: KasRow[]; totalIn: number; totalOut: number }
interface Kasboek {
  year: number; quarter: number; openingBalance: number; closingBalance: number
  months: KasMonth[]; totalIn: number; totalOut: number
}

// Previous quarter for the ◀ selector (Q1 → Q4 of the prior year).
function prevQuarter(y: number, q: number): { year: number; quarter: number } {
  return q <= 1 ? { year: y - 1, quarter: 4 } : { year: y, quarter: q - 1 }
}
function nextQuarter(y: number, q: number): { year: number; quarter: number } {
  return q >= 4 ? { year: y + 1, quarter: 1 } : { year: y, quarter: q + 1 }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function KasClient() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('omzet')
  const [btwRate, setBtwRate] = useState(21)
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // [KASBOEK] Live quarterly cash book. Loaded lazily; on first open the endpoint defaults to
  // the last completed quarter and tells us which one it picked (kb.year/kb.quarter).
  const [kbOpen, setKbOpen] = useState(false)
  const [kb, setKb] = useState<Kasboek | null>(null)
  const [kbLoading, setKbLoading] = useState(false)
  const [kbPeriod, setKbPeriod] = useState<{ year: number; quarter: number } | null>(null)

  async function loadKasboek(period: { year: number; quarter: number } | null) {
    setKbLoading(true)
    try {
      const qs = period ? `?year=${period.year}&quarter=${period.quarter}` : ''
      const res = await fetch(`/api/kasboek${qs}`)
      const json = await res.json()
      if (res.ok && json.kasboek) {
        setKb(json.kasboek as Kasboek)
        setKbPeriod({ year: json.kasboek.year, quarter: json.kasboek.quarter })
      }
    } catch { /* silent — the panel shows a retry */ } finally { setKbLoading(false) }
  }

  function openKasboek() {
    setKbOpen(true)
    if (!kb) void loadKasboek(null)
  }

  async function load() {
    try {
      const res = await fetch('/api/cash')
      const json = await res.json()
      if (res.ok) { setEntries(json.entries ?? []); setBalance(json.balance ?? 0) }
    } catch { /* silent */ } finally { setLoading(false) }
  }
  // Initial load — inline async IIFE so no setState runs synchronously in the effect.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cash')
        const json = await res.json()
        if (!cancelled && res.ok) { setEntries(json.entries ?? []); setBalance(json.balance ?? 0) }
      } catch { /* silent */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Default the category to match the direction (in → omzet, out → kost).
  function setDir(d: 'in' | 'out') {
    setDirection(d)
    setCategory(d === 'in' ? 'omzet' : 'kosten')
  }

  async function add() {
    const val = Number(amount.replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) { setError('Vul een bedrag groter dan 0 in.'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/cash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_date: date, direction, amount: val, category, description, btw_rate: category === 'omzet' ? btwRate : undefined }),
      })
      if (res.ok) { setAmount(''); setDescription(''); await load(); if (kbOpen) void loadKasboek(kbPeriod) }
      else { setError('Kon de boeking niet opslaan. Probeer opnieuw.') }
    } catch { setError('Er ging iets mis.') } finally { setSaving(false) }
  }

  async function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id)) // optimistic
    try { await fetch(`/api/cash?id=${id}`, { method: 'DELETE' }); await load(); if (kbOpen) void loadKasboek(kbPeriod) } catch { await load() }
  }

  // [CASH-SETTLE] 'betaling' is a system-managed settlement of a cash-paid invoice — labelled
  // for display, but never offered in the add form (CATS), and not manually deletable (undo the
  // payment on the invoice instead; the kasboek then reconciles it away).
  const catLabel = (k: string) => (k === 'betaling' ? 'Factuurbetaling (contant)' : CATS.find((c) => c.key === k)?.label ?? k)

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <Link href="/dashboard" style={{ fontSize: 14, color: M3.primary, textDecoration: 'none' }}>← Terug</Link>

        {/* Balance */}
        <div style={{ margin: '16px 0 20px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>KAS — SALDO IN KASSA</div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 34, fontWeight: 700, color: balance < 0 ? M3.error : M3.onSurface, marginTop: 4 }}>
            {eur.format(balance)}
          </div>
          {balance < 0 && (
            <div style={{ fontSize: 12.5, color: M3.error, marginTop: 2 }}>Negatief saldo — je hebt meer uitgaven dan ontvangsten geboekt.</div>
          )}
        </div>

        {/* Add form */}
        <div style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Toggle active={direction === 'in'} onClick={() => setDir('in')} label="Ontvangen" color={M3.success} />
            <Toggle active={direction === 'out'} onClick={() => setDir('out')} label="Uitgegeven" color={M3.error} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00"
              style={{ flex: 1, minWidth: 0, padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT_NUM, boxSizing: 'border-box' }}
            />
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {CATS.map((c) => {
              const active = category === c.key
              return (
                <button key={c.key} onClick={() => setCategory(c.key)}
                  style={{ padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                    background: active ? M3.primaryContainer : '#F1F3F4', color: active ? '#041E49' : M3.neutral,
                    border: active ? `1px solid ${M3.primary}` : '1px solid transparent' }}>
                  {c.label}
                </button>
              )
            })}
          </div>

          {/* BTW rate — only for a cash sale, so verschuldigde BTW is exact. */}
          {category === 'omzet' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: M3.neutral }}>BTW:</span>
              {[21, 9, 0].map((r) => {
                const active = btwRate === r
                return (
                  <button key={r} onClick={() => setBtwRate(r)}
                    style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT,
                      background: active ? M3.primaryContainer : '#F1F3F4', color: active ? '#041E49' : M3.neutral,
                      border: active ? `1px solid ${M3.primary}` : '1px solid transparent' }}>
                    {r}%
                  </button>
                )
              })}
            </div>
          )}

          <input
            value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Omschrijving (optioneel)"
            style={{ width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 12, border: `1.5px solid ${M3.outlineVariant}`, fontFamily: FONT, boxSizing: 'border-box', marginBottom: 12 }}
          />

          {error && <div style={{ fontSize: 13, color: M3.error, marginBottom: 10 }}>{error}</div>}

          <button onClick={add} disabled={saving}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: saving ? '#C7C7CC' : M3.primary, color: M3.onPrimary, fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
            {saving ? 'Bezig…' : 'Toevoegen'}
          </button>
        </div>

        {/* Ledger */}
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral, margin: '0 2px 10px' }}>BOEKINGEN</div>
        {loading ? (
          <div style={{ height: 80, borderRadius: 16, background: '#F0F1F3' }} />
        ) : entries.length === 0 ? (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: '24px 20px', textAlign: 'center', color: M3.neutral, fontSize: 14 }}>
            Nog geen kasboekingen. Voeg je eerste contante ontvangst of uitgave toe.
          </div>
        ) : (
          <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, overflow: 'hidden' }}>
            {entries.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: i > 0 ? '1px solid #ECEFF1' : 'none' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description?.trim() || catLabel(e.category)}
                  </div>
                  <div style={{ fontSize: 12, color: M3.neutral, marginTop: 1 }}>{formatDate(e.entry_date)} · {catLabel(e.category)}</div>
                </div>
                <div style={{ fontFamily: FONT_NUM, fontSize: 14.5, fontWeight: 700, color: e.direction === 'in' ? M3.success : M3.error, whiteSpace: 'nowrap' }}>
                  {e.direction === 'in' ? '+' : '−'}{eur.format(e.amount)}
                </div>
                {e.category === 'betaling' ? (
                  <span title="Automatisch: betaling van een contant betaalde factuur. Maak de betaling op de factuur ongedaan om dit te verwijderen."
                    style={{ flexShrink: 0, color: '#9aa0a6', fontSize: 16, lineHeight: 1 }}>🔗</span>
                ) : (
                  <button onClick={() => remove(e.id)} aria-label="Verwijderen"
                    style={{ flexShrink: 0, border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* [KASBOEK] Live quarterly cash book — the running-balance view the accountant gets,
            built live from the till's daily cash takings + these boekingen (never stored twice). */}
        <div style={{ marginTop: 28 }}>
          {!kbOpen ? (
            <button onClick={openKasboek}
              style={{ width: '100%', padding: '13px 16px', borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📗 Kasboek per kwartaal — voor de boekhouder</span>
              <span style={{ color: M3.primary, fontSize: 20, lineHeight: 1 }}>＋</span>
            </button>
          ) : (
            <div style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, color: M3.neutral }}>KASBOEK — KWARTAAL</div>
                <button onClick={() => setKbOpen(false)} aria-label="Sluiten"
                  style={{ border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              {/* Quarter selector */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '10px 0 6px' }}>
                <button onClick={() => kbPeriod && loadKasboek(prevQuarter(kbPeriod.year, kbPeriod.quarter))} disabled={!kbPeriod || kbLoading} aria-label="Vorig kwartaal"
                  style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 999, width: 34, height: 34, cursor: kbPeriod ? 'pointer' : 'default', fontSize: 16, color: M3.onSurface }}>◀</button>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: M3.onSurface, minWidth: 96, textAlign: 'center' }}>
                  {kbPeriod ? `Q${kbPeriod.quarter} ${kbPeriod.year}` : '—'}
                </div>
                <button onClick={() => kbPeriod && loadKasboek(nextQuarter(kbPeriod.year, kbPeriod.quarter))} disabled={!kbPeriod || kbLoading} aria-label="Volgend kwartaal"
                  style={{ border: `1px solid ${M3.outlineVariant}`, background: M3.surface, borderRadius: 999, width: 34, height: 34, cursor: kbPeriod ? 'pointer' : 'default', fontSize: 16, color: M3.onSurface }}>▶</button>
              </div>

              {kbLoading ? (
                <div style={{ height: 120, borderRadius: 12, background: '#F0F1F3', marginTop: 10 }} />
              ) : !kb ? (
                <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '20px 0' }}>
                  Kon het kasboek niet laden. <button onClick={() => loadKasboek(kbPeriod)} style={{ border: 'none', background: 'transparent', color: M3.primary, cursor: 'pointer', fontFamily: FONT, fontSize: 14 }}>Opnieuw</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: M3.neutral, padding: '6px 2px', borderBottom: `1px solid ${M3.outlineVariant}` }}>
                    <span>Beginsaldo kwartaal</span>
                    <span style={{ fontFamily: FONT_NUM, fontWeight: 600, color: M3.onSurface }}>{eur.format(kb.openingBalance)}</span>
                  </div>

                  {kb.months.length === 0 ? (
                    <div style={{ textAlign: 'center', color: M3.neutral, fontSize: 14, padding: '18px 0' }}>
                      Geen kasbewegingen in dit kwartaal.
                    </div>
                  ) : kb.months.map((m) => (
                    <div key={m.key} style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, marginBottom: 4 }}>{m.label}</div>
                      <div style={{ border: `1px solid ${M3.outlineVariant}`, borderRadius: 10, overflow: 'hidden' }}>
                        {m.rows.map((r, i) => (
                          <div key={r.date} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '7px 10px', borderTop: i > 0 ? '1px solid #ECEFF1' : 'none', fontSize: 13 }}>
                            <span style={{ width: 52, flexShrink: 0, color: M3.neutral }}>{formatDate(r.date)}</span>
                            <span style={{ flex: 1, minWidth: 0, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.descriptions.length ? r.descriptions.join(' · ') : (r.ontvangsten > 0 ? 'Kasontvangsten' : 'Kasuitgave')}
                            </span>
                            {r.ontvangsten > 0 && <span style={{ fontFamily: FONT_NUM, color: M3.success, whiteSpace: 'nowrap' }}>+{eur.format(r.ontvangsten)}</span>}
                            {r.uitgaven > 0 && <span style={{ fontFamily: FONT_NUM, color: M3.error, whiteSpace: 'nowrap' }}>−{eur.format(r.uitgaven)}</span>}
                            <span style={{ fontFamily: FONT_NUM, fontWeight: 700, color: r.eindsaldo < 0 ? M3.error : M3.onSurface, minWidth: 72, textAlign: 'right', whiteSpace: 'nowrap' }}>{eur.format(r.eindsaldo)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', borderTop: `1px solid ${M3.outlineVariant}`, background: '#FAFAFA', fontSize: 12.5, fontWeight: 600, color: M3.neutral }}>
                          <span>Totaal {m.label}</span>
                          <span style={{ fontFamily: FONT_NUM }}>+{eur.format(m.totalIn)} · −{eur.format(m.totalOut)}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, padding: '10px 2px 2px', marginTop: 8, borderTop: `2px solid ${M3.outlineVariant}` }}>
                    <span>Eindsaldo kwartaal</span>
                    <span style={{ fontFamily: FONT_NUM, color: kb.closingBalance < 0 ? M3.error : M3.onSurface }}>{eur.format(kb.closingBalance)}</span>
                  </div>

                  {kbPeriod && (
                    <a href={`/api/kasboek?year=${kbPeriod.year}&quarter=${kbPeriod.quarter}&format=xlsx`}
                      style={{ display: 'block', marginTop: 14, padding: '11px', borderRadius: 12, background: M3.primaryContainer, color: '#041E49', fontSize: 14, fontWeight: 600, textAlign: 'center', textDecoration: 'none', fontFamily: FONT }}>
                      ⬇︎ Download voor boekhouder (.xlsx)
                    </a>
                  )}
                  <div style={{ fontSize: 11.5, color: M3.neutral, marginTop: 8, lineHeight: 1.4 }}>
                    Dit kasboek wordt live berekend uit je dagelijkse contante omzet en je kasboekingen.
                    De omzet is al één keer geteld in je resultaat — dit overzicht toont alleen het kassaldo, dus niets wordt dubbel geboekt.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: '10px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
        background: active ? color : '#F1F3F4', color: active ? '#fff' : '#5F6368', border: 'none' }}>
      {label}
    </button>
  )
}
