'use client'

// src/app/dashboard/dagomzet/HandmatigeDag.tsx
// [KASSA] One trading day, typed by hand — the panel that sits under the Z-report upload.
//
// ── WHY A SHOP NEEDS THIS EVEN THOUGH THE UPLOAD EXISTS ──
// The upload reads a kassa-rapport. An owner without a kassa has no such file, and until now that
// left him no way to record a rate split ANYWHERE: bank_transactions carries no btw_rate column, so
// his PIN takings arrived as revenue with no rate, and /api/btw/file BLOCKS a filing on exactly
// that ("er staat nog omzet zonder BTW-tarief"). His own aangifte was held shut by money he could
// not classify. daily_turnover.source has allowed 'manual' since the table was created; this is the
// door that was designed for it.
//
// The two totals are shown side by side and the button stays shut until they agree, because they
// are not decoration: pin_amount is what suppresses the day's card settlement when it lands on the
// bank, and cash_amount is what feeds the drawer as ontvangsten. Splits that disagree double-count
// revenue. The server refuses them too (validateManualDay) — this only makes the refusal visible
// before the owner presses anything.

import { useState } from 'react'
import { M3 } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { parseAmountNL } from '@/lib/parse-nl'
import DateFieldNL from '@/components/ui/DateFieldNL'
import { amsterdamToday } from '@/lib/turnover-import'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** The six amount boxes, keyed by the field the API expects. Labels come from the catalogue. */
const REVENUE_FIELDS = [
  { key: 'gross_21', labelKey: 'dzh.omzet21' },
  { key: 'gross_9', labelKey: 'dzh.omzet9' },
  { key: 'gross_0', labelKey: 'dzh.omzet0' },
] as const
const PAID_FIELDS = [
  { key: 'pin', labelKey: 'kassa.splitPin' },
  { key: 'cash', labelKey: 'kassa.splitContant' },
  { key: 'other', labelKey: 'kassa.splitOverig' },
] as const

type FieldKey = (typeof REVENUE_FIELDS)[number]['key'] | (typeof PAID_FIELDS)[number]['key']

const EMPTY: Record<FieldKey, string> = {
  gross_21: '', gross_9: '', gross_0: '', pin: '', cash: '', other: '',
}

export default function HandmatigeDag({ onSaved }: { onSaved?: () => void }) {
  const t = translator(useLocale())
  const [date, setDate] = useState(() => amsterdamToday())
  const [values, setValues] = useState<Record<FieldKey, string>>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const amount = (key: FieldKey) => parseAmountNL(values[key])
  const revenueTotal = REVENUE_FIELDS.reduce((sum, f) => sum + amount(f.key), 0)
  const paidTotal = PAID_FIELDS.reduce((sum, f) => sum + amount(f.key), 0)
  // The same one-cent slack the server allows, so the button and the server never disagree about
  // whether a day is enterable — a form that refuses what the API accepts is its own bug report.
  const agree = Math.abs(revenueTotal - paidTotal) <= 0.011
  const canSave = revenueTotal > 0 && paidTotal > 0 && agree && !busy

  function set(key: FieldKey, raw: string) {
    setDone(false)
    setError('')
    setValues((current) => ({ ...current, [key]: raw }))
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/turnover/day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          gross_21: amount('gross_21'), gross_9: amount('gross_9'), gross_0: amount('gross_0'),
          pin: amount('pin'), cash: amount('cash'), other: amount('other'),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('dzh.fout.opslaan'))); return }
      setValues(EMPTY)
      setDone(true)
      onSaved?.()
    } catch {
      setError(t('dzh.fout.opslaan'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      style={{
        background: M3.surface, border: `1px solid ${M3.outlineVariant}`,
        borderRadius: 16, padding: 16, marginTop: 16,
      }}
    >
      <h2 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, margin: 0, color: M3.onSurface }}>
        {t('dzh.titel')}
      </h2>
      <p style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, margin: '6px 0 16px' }}>
        {t('dzh.uitleg')}
      </p>

      <label style={labelStyle}>{t('dzh.datum')}</label>
      <DateFieldNL value={date} onChange={(iso) => { setDone(false); if (iso) setDate(iso) }} />

      <h3 style={groupHeading}>{t('dzh.omzetKop')}</h3>
      {REVENUE_FIELDS.map((f) => (
        <AmountRow key={f.key} label={t(f.labelKey)} value={values[f.key]} onChange={(v) => set(f.key, v)} />
      ))}

      <h3 style={groupHeading}>{t('dzh.betaaldKop')}</h3>
      {PAID_FIELDS.map((f) => (
        <AmountRow key={f.key} label={t(f.labelKey)} value={values[f.key]} onChange={(v) => set(f.key, v)} />
      ))}

      <div
        style={{
          display: 'flex', justifyContent: 'space-between', gap: 12,
          marginTop: 16, padding: 12, borderRadius: 12,
          background: agree ? M3.surfaceVariant : M3.warningContainer,
        }}
      >
        <div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant }}>{t('dzh.totaalOmzet')}</div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 18, color: M3.onSurface }}>{eur.format(revenueTotal)}</div>
        </div>
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant }}>{t('dzh.totaalBetaald')}</div>
          <div style={{ fontFamily: FONT_NUM, fontSize: 18, color: M3.onSurface }}>{eur.format(paidTotal)}</div>
        </div>
      </div>
      {!agree && (
        <p style={{ fontFamily: FONT, fontSize: 13, color: M3.warning, margin: '8px 0 0' }}>
          {t('dzh.moetGelijk')}
        </p>
      )}

      {error && (
        <p role="alert" style={{ fontFamily: FONT, fontSize: 13, color: M3.error, margin: '12px 0 0' }}>
          {error}
        </p>
      )}
      {done && (
        <p role="status" style={{ fontFamily: FONT, fontSize: 13, color: M3.success, margin: '12px 0 0' }}>
          {t('dzh.klaar')}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!canSave}
        style={{
          marginTop: 16, width: '100%', fontFamily: FONT, fontSize: 15, fontWeight: 600,
          borderRadius: 12, padding: '14px 8px', border: 'none', cursor: canSave ? 'pointer' : 'not-allowed',
          background: canSave ? M3.primary : M3.outlineVariant,
          color: canSave ? '#fff' : M3.onSurfaceVariant,
        }}
      >
        {busy ? t('kassa.bezig') : t('dzh.opslaan')}
      </button>
    </section>
  )
}

function AmountRow({
  label, value, onChange,
}: { label: string; value: string; onChange: (raw: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
      <span style={{ flex: 1, fontFamily: FONT, fontSize: 14, color: M3.onSurface }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        aria-label={label}
        style={{
          width: 128, fontFamily: FONT_NUM, fontSize: 15, padding: '10px 12px', borderRadius: 10,
          border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface,
          textAlign: 'end',
        }}
      />
    </div>
  )
}

const labelStyle = {
  display: 'block', fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 6,
}
const groupHeading = {
  fontFamily: FONT, fontSize: 14, fontWeight: 600, color: M3.onSurface, margin: '20px 0 4px',
}
