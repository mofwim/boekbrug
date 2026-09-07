'use client'

// src/app/dashboard/bedrijfsmiddelen/BedrijfsmiddelenClient.tsx
// [BEDRIJFSMIDDEL] The register — state and network. Rows are drawn in BedrijfsmiddelenPanels.tsx.
// The owner decides what is an asset; the app computes the depreciation (depreciation.ts) and the
// year screen follows. Nothing here books anything by itself.

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { useDialog } from '@/components/ui/Dialog'
import DateFieldNL from '@/components/ui/DateFieldNL'
import type { AssetCandidate } from '@/lib/asset-candidates'
import { MIN_USEFUL_LIFE_YEARS } from '@/lib/depreciation'
import { RegisterList, CandidateList, BTN_DARK, BTN_LIGHT, type AssetView } from './BedrijfsmiddelenPanels'

const FONT = "'Roboto', -apple-system, sans-serif"
const FIELD: React.CSSProperties = { width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #DADCE0', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
const LABEL: React.CSSProperties = { fontSize: 12.5, color: '#5F6368', display: 'block', marginBottom: 4 }

type Form = { description: string; cost: string; residual_value: string; useful_life_years: string; in_use_from: string; invoice_id: string | null }
const EMPTY: Form = { description: '', cost: '', residual_value: '0', useful_life_years: String(MIN_USEFUL_LIFE_YEARS), in_use_from: '', invoice_id: null }

export default function BedrijfsmiddelenClient() {
  const t = translator(useLocale())
  const dialog = useDialog()
  const [assets, setAssets] = useState<AssetView[]>([])
  const [candidates, setCandidates] = useState<AssetCandidate[]>([])
  const [available, setAvailable] = useState(true)
  const [btwDeductible, setBtwDeductible] = useState(true)
  const [today, setToday] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/assets')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(failureText(res.status, json, t('bm.fout.laden'))); return }
      setAssets(json.assets ?? [])
      setCandidates(json.candidates ?? [])
      setAvailable(json.available !== false)
      setBtwDeductible(json.btwDeductible !== false)
      setToday(json.today ?? '')
      setError('')
    } catch {
      setError(t('bm.fout.laden'))
    }
  }, [t])

  useEffect(() => {
    let cancelled = false
    void (async () => { if (!cancelled) await load() })()
    return () => { cancelled = true }
  }, [load])

  async function call(method: string, body?: unknown, query = '') {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/assets${query}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(failureText(res.status, json, t('bm.fout.opslaan'))); return false }
      await load()
      return true
    } catch {
      setError(t('bm.fout.opslaan')); return false
    } finally {
      setBusy(false)
    }
  }

  function openForm(c?: AssetCandidate) {
    setForm(c
      ? { ...EMPTY, description: c.supplierName, cost: String(c.amount), in_use_from: c.invoiceDate ?? today, invoice_id: c.invoiceId }
      : { ...EMPTY, in_use_from: today })
  }

  async function save() {
    if (!form || busy) return
    const ok = await call('POST', {
      description: form.description, cost: form.cost, residual_value: form.residual_value,
      useful_life_years: Number(form.useful_life_years), in_use_from: form.in_use_from, invoice_id: form.invoice_id,
    })
    if (ok) setForm(null)
  }

  async function dispose(a: AssetView) {
    const ok = await dialog.confirm({ title: t('bm.afvoeren'), message: t('bm.afvoerenUitleg'), confirmLabel: t('bm.afvoeren') })
    if (!ok) return
    await call('PATCH', { id: a.id, disposed_on: today })
  }

  async function remove(a: AssetView) {
    const ok = await dialog.confirm({ title: t('bm.verwijderVraag'), message: t('bm.verwijderUitleg'), confirmLabel: t('bm.verwijderen') })
    if (!ok) return
    await call('DELETE', undefined, `?id=${encodeURIComponent(a.id)}`)
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px', display: 'grid', gap: 16, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: 0 }}>{t('bm.titel')}</h1>
        {available && !form && <button type="button" onClick={() => openForm()} style={BTN_DARK}>{t('bm.toevoegen')}</button>}
      </div>
      <p style={{ fontSize: 13.5, color: '#5F6368', margin: 0, lineHeight: 1.6 }}>{t('bm.intro')}</p>

      {!available && <p style={{ fontSize: 13.5, color: '#B26A00', margin: 0 }}>{t('bm.nietBeschikbaar')}</p>}
      {error && <p role="alert" style={{ fontSize: 13.5, color: '#C5221F', margin: 0 }}>{error}</p>}

      {form && (
        <section style={{ background: '#fff', border: '1px solid #E0E0E0', borderRadius: 12, padding: '16px 20px', display: 'grid', gap: 12 }}>
          <div>
            <label style={LABEL}>{t('bm.veld.omschrijving')}</label>
            <input style={FIELD} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LABEL}>{btwDeductible ? t('bm.veld.aanschaf') : t('bm.veld.aanschafIncl')}</label>
              <input style={FIELD} inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </div>
            <div>
              <label style={LABEL}>{t('bm.veld.restwaarde')}</label>
              <input style={FIELD} inputMode="decimal" value={form.residual_value} onChange={(e) => setForm({ ...form, residual_value: e.target.value })} />
            </div>
            <div>
              <label style={LABEL}>{t('bm.veld.gebruiksduur')}</label>
              <input style={FIELD} inputMode="numeric" value={form.useful_life_years} onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })} />
            </div>
            <div>
              <label style={LABEL}>{t('bm.veld.inGebruik')}</label>
              <DateFieldNL value={form.in_use_from} onChange={(iso) => setForm({ ...form, in_use_from: iso })} style={FIELD} />
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: '#5F6368', margin: 0, lineHeight: 1.5 }}>{t('bm.regel')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void save()} disabled={busy} style={BTN_DARK}>{t('bm.opslaan')}</button>
            <button type="button" onClick={() => setForm(null)} style={BTN_LIGHT}>{t('bm.annuleren')}</button>
          </div>
        </section>
      )}

      {available && !form && (
        <CandidateList candidates={candidates} t={t as never} onYes={(c) => openForm(c)} onNo={(c) => void call('POST', { action: 'dismiss', invoice_id: c.invoiceId })} />
      )}

      {available && <RegisterList assets={assets} t={t as never} onDispose={(a) => void dispose(a)} onDelete={(a) => void remove(a)} />}
      {available && assets.some((a) => a.disposed_on) && (
        <p style={{ fontSize: 12.5, color: '#5F6368', margin: 0 }}>{t('bm.boekwinstNoot')}</p>
      )}
    </main>
  )
}
