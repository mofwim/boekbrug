'use client'

// src/app/dashboard/bank/categoriseren/CategoriseClient.tsx
// [BANK-IDENTITY] Give each unexplained bank line an identity. One tap confirms the
// suggestion (memory → AI); confirming also TRAINS the memory so the same counterpart
// is auto-categorized next time. Self-contained: fetches /api/bank/categorize.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SELECTABLE_CATEGORIES } from '@/lib/bank-categories'

const M3 = {
  primary: '#1A73E8', onPrimary: '#FFFFFF', primaryContainer: '#D3E3FD',
  onSurface: '#1C1B1F', neutral: '#5F6368', surface: '#FFFFFF',
  outlineVariant: '#E0E0E0', success: '#137333', successContainer: '#CEEAD6',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Google Sans', 'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// Triage categories offered to the owner (Dutch), from the single source of truth.
// The AI/memory pre-selects one.
const CATS = SELECTABLE_CATEGORIES

interface Item {
  id: string
  date: string | null
  amount: number | null
  counterpart_name: string | null
  description: string | null
  suggested: string
  suggested_source: 'memory' | 'ai'
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const months = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}

export default function CategoriseClient() {
  const [items, setItems] = useState<Item[]>([])
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/bank/categorize')
        const json = await res.json()
        if (!cancelled && res.ok) {
          setItems(json.items ?? [])
          // Pre-select the suggestion for each item.
          const initial: Record<string, string> = {}
          for (const it of json.items ?? []) initial[it.id] = it.suggested
          setChoice(initial)
        }
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function confirm(id: string) {
    const category = choice[id]
    if (!category) return
    setBusy(id)
    try {
      const res = await fetch('/api/bank/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: id, category }),
      })
      if (res.ok) setItems((prev) => prev.filter((it) => it.id !== id))
    } catch { /* keep the item so the owner can retry */ } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px' }}>
        <Link href="/dashboard" style={{ fontSize: 14, color: M3.primary, textDecoration: 'none' }}>← Terug</Link>

        <header style={{ margin: '16px 0 20px' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: M3.onSurface, margin: '0 0 4px' }}>Wat is dit?</h1>
          <p style={{ fontSize: 15, color: M3.neutral, margin: 0 }}>
            Geef elke banktransactie een plek. We onthouden je keuze per bedrijf.
          </p>
        </header>

        {loading ? (
          <div style={{ height: 120, borderRadius: 16, background: '#F0F1F3' }} />
        ) : items.length === 0 ? (
          <div style={{ background: M3.successContainer, borderRadius: 16, padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0B5345' }}>Alles is gecategoriseerd</div>
            <div style={{ fontSize: 14, color: '#0B5345', marginTop: 2 }}>Geen transacties die nog aandacht nodig hebben.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((it) => (
              <div key={it.id} style={{ background: M3.surface, borderRadius: 16, border: `1px solid ${M3.outlineVariant}`, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.counterpart_name?.trim() || it.description?.trim() || 'Onbekende transactie'}
                    </div>
                    <div style={{ fontSize: 12.5, color: M3.neutral, marginTop: 2 }}>
                      {formatDate(it.date)}
                      {it.suggested_source === 'memory' ? ' · onthouden' : ' · voorstel'}
                    </div>
                  </div>
                  <div style={{ fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, color: M3.onSurface, whiteSpace: 'nowrap' }}>
                    {eur.format(it.amount ?? 0)}
                  </div>
                </div>

                {/* Category chips — pre-selected to the suggestion. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {CATS.map((c) => {
                    const active = choice[it.id] === c.key
                    return (
                      <button
                        key={c.key}
                        onClick={() => setChoice((p) => ({ ...p, [it.id]: c.key }))}
                        style={{
                          padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                          fontFamily: FONT,
                          background: active ? M3.primaryContainer : '#F1F3F4',
                          color: active ? '#041E49' : M3.neutral,
                          border: active ? `1px solid ${M3.primary}` : '1px solid transparent',
                        }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>

                <button
                  onClick={() => confirm(it.id)}
                  disabled={busy === it.id}
                  style={{
                    marginTop: 12, width: '100%', padding: '11px', borderRadius: 12, border: 'none',
                    background: busy === it.id ? '#C7C7CC' : M3.primary, color: M3.onPrimary,
                    fontSize: 15, fontWeight: 600, cursor: busy === it.id ? 'default' : 'pointer', fontFamily: FONT,
                  }}
                >
                  {busy === it.id ? 'Bezig…' : 'Bevestigen'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
