'use client'

// src/app/dashboard/artikelen/VakPrijslijst.tsx
// [VAK-BRUG] Fill an empty price list with the lines of the owner's trade.
//
// ── WHY THIS SCREEN EXISTS AT ALL ──
// vak-sjablonen.ts has known eleven trades since it was written, and for each one the invoice
// lines and — the part that matters — the BTW rate that belongs to them. It lived entirely in the
// public funnel: /factuur-maken and its landing pages. Behind the login, nothing read it.
//
// So a barber found /factuur-maken/kapper on Google, told us his trade, registered, and the app
// forgot. His catalogue started empty, and the Kassa built for exactly him opened on "je prijslijst
// is nog leeg" — a counter with no buttons. The one fact he volunteered was thrown away at the
// moment it was worth most.
//
// ── THE PRICES ARE HIS, THE RATES ARE OURS ──
// The template supplies description, unit and rate — the three things it can be right about — and
// he supplies the amount. Rule 1 of vak-sjablonen.ts, unsoftened: a wrongly prefilled amount that
// slips through is worse than an empty field. A line he leaves blank is not created rather than
// created at zero: a €0 article would be a button on his counter that rings up nothing.

import { useCallback, useEffect, useState } from 'react'
import { M3 } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { parseAmountNL } from '@/lib/parse-nl'
import { vakOpties } from '@/lib/vak-sjablonen'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"

interface Seed { description: string; unit: string; btw_rate: number }

export default function VakPrijslijst({ onCreated }: { onCreated?: () => void }) {
  const t = translator(useLocale())
  const [vak, setVak] = useState<string>('')
  const [seeds, setSeeds] = useState<Seed[]>([])
  const [letOp, setLetOp] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // What the app already knows: the trade he chose at the front door, carried through registration.
  const loadKnown = useCallback(async () => {
    try {
      const res = await fetch('/api/articles/from-vak')
      const json = await res.json()
      if (!res.ok || !json.vak) return
      setVak(json.vak)
      setSeeds(json.seeds ?? [])
      setLetOp(json.letOp ?? null)
    } catch {
      /* trade unknown → he picks it below, which is the ordinary path */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => { if (!cancelled) await loadKnown() }
    void run()
    return () => { cancelled = true }
  }, [loadKnown])

  async function pick(slug: string) {
    setVak(slug)
    setPrices({})
    setDone(false)
    setError('')
    if (!slug) { setSeeds([]); setLetOp(null); return }
    // The lines come from the SERVER rather than from the bundle, so the screen and the write agree
    // about which lines a trade has — the route rejects anything it did not itself offer.
    try {
      const res = await fetch(`/api/articles/from-vak?vak=${encodeURIComponent(slug)}`)
      const json = await res.json()
      if (res.ok && json.vak === slug) { setSeeds(json.seeds ?? []); setLetOp(json.letOp ?? null); return }
    } catch { /* fall through */ }
    setSeeds([])
    setLetOp(null)
  }

  async function save() {
    const lines = seeds
      .map((s) => ({ description: s.description, unit_price: parseAmountNL(prices[s.description] ?? '') }))
      .filter((l) => l.unit_price > 0)
    if (lines.length === 0) { setError(t('vak.fout.leeg')); return }

    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/articles/from-vak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vak, lines }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('vak.fout.opslaan'))); return }
      setDone(true)
      onCreated?.()
    } catch {
      setError(t('vak.fout.opslaan'))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section style={panel}>
        <p role="status" style={{ fontFamily: FONT, fontSize: 14, color: M3.success, margin: 0 }}>
          {t('vak.klaar')}
        </p>
      </section>
    )
  }

  return (
    <section style={panel}>
      <h2 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, margin: 0, color: M3.onSurface }}>
        {t('vak.titel')}
      </h2>
      <p style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, margin: '6px 0 14px' }}>
        {t('vak.uitleg')}
      </p>

      <label htmlFor="vak-keuze" style={label}>{t('vak.kies')}</label>
      <select
        id="vak-keuze"
        value={vak}
        onChange={(e) => void pick(e.target.value)}
        style={{ ...field, width: '100%' }}
      >
        <option value="">—</option>
        {vakOpties().map((o) => (
          <option key={o.slug} value={o.slug}>{o.label}</option>
        ))}
      </select>

      {/* [VAK-SJABLONEN] "The most valuable field in the whole file", by its own account: it is
          there precisely for the trades where the rate depends on the situation and the owner most
          often gets it wrong. He used to see it once on the public generator, before he had a
          business here — never at the moment he is actually pricing his work. This is that moment. */}
      {letOp && (
        <div style={{ background: M3.warningContainer, borderRadius: 12, padding: 12, marginTop: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: M3.warning, marginBottom: 4 }}>
            {t('vak.letOpKop')}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 13, color: M3.warning }}>{letOp}</div>
        </div>
      )}

      {seeds.length > 0 && (
        <>
          <h3 style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: M3.onSurface, margin: '20px 0 2px' }}>
            {t('vak.prijsKop')}
          </h3>
          <p style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant, margin: '0 0 10px' }}>
            {t('vak.prijsUitleg')}
          </p>
          {seeds.map((s) => (
            <div key={s.description} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurface }}>{s.description}</div>
                <div style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant }}>
                  {s.btw_rate}% btw · per {s.unit}
                </div>
              </div>
              <input
                value={prices[s.description] ?? ''}
                onChange={(e) => setPrices((p) => ({ ...p, [s.description]: e.target.value }))}
                inputMode="decimal"
                placeholder="0,00"
                aria-label={s.description}
                style={{ ...field, width: 120, fontFamily: FONT_NUM, textAlign: 'end' }}
              />
            </div>
          ))}

          {error && (
            <p role="alert" style={{ fontFamily: FONT, fontSize: 13, color: M3.error, margin: '12px 0 0' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            style={{
              marginTop: 16, width: '100%', fontFamily: FONT, fontSize: 15, fontWeight: 600,
              borderRadius: 12, padding: '14px 8px', border: 'none',
              cursor: busy ? 'default' : 'pointer', background: M3.primary, color: '#fff',
            }}
          >
            {busy ? t('kassa.bezig') : t('vak.opslaan')}
          </button>
        </>
      )}
    </section>
  )
}

const panel = {
  background: M3.surface, border: `1px solid ${M3.outlineVariant}`,
  borderRadius: 16, padding: 16, marginBottom: 16,
}
const label = {
  display: 'block', fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 6,
}
const field = {
  fontFamily: FONT, fontSize: 15, padding: '10px 12px', borderRadius: 10,
  border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface,
  boxSizing: 'border-box' as const,
}
