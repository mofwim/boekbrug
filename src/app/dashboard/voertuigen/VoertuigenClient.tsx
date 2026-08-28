'use client'

// src/app/dashboard/voertuigen/VoertuigenClient.tsx
// [VOERTUIG] The cars a garage works on — state and network. Everything that draws a row lives in
// VoertuigenPanels.tsx so the render gate can hand those components real vehicles.
//
// Carries no money. A job that costs something is rung up on the Kassa or sent as an invoice, both
// of which already own their own truth — see the header of supabase/migrations/vehicles.sql.

import { useCallback, useEffect, useState } from 'react'
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { useDialog } from '@/components/ui/Dialog'
import DateFieldNL from '@/components/ui/DateFieldNL'
import { normalizeKenteken, isKentekenShape, vehiclesNeedingApk } from '@/lib/vehicle'
import { ApkCallList, VehicleList, type VehicleRow } from './VoertuigenPanels'

const FONT = "'Roboto', -apple-system, sans-serif"

const EMPTY = { kenteken: '', description: '', customer_name: '', customer_phone: '', apk_expiry: '', notes: '' }

export default function VoertuigenClient() {
  const t = translator(useLocale())
  const dialog = useDialog()
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [today, setToday] = useState('')
  const [form, setForm] = useState({ ...EMPTY })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles')
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('vtg.fout.laden'))); return }
      setVehicles(json.vehicles ?? [])
      setToday(json.today ?? '')
    } catch {
      setError(t('vtg.fout.laden'))
    }
  }, [t])

  useEffect(() => {
    let cancelled = false
    const run = async () => { if (!cancelled) await load() }
    void run()
    return () => { cancelled = true }
  }, [load])

  async function save() {
    if (busy) return
    // Checked here as well as on the server, because the counter is a phone: telling him the plate
    // is wrong before the round trip is the difference between a form and a conversation.
    if (!isKentekenShape(form.kenteken)) {
      setError('Dit lijkt geen Nederlands kenteken. Controleer de tekens.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, kenteken: normalizeKenteken(form.kenteken) }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('vtg.fout.opslaan'))); return }
      setForm({ ...EMPTY })
      setOpen(false)
      await load()
    } catch {
      setError(t('vtg.fout.opslaan'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (busy) return
    // [KASSA-DIALOOG] Zie KassaClient.voidTicket: dezelfde vervanging, dezelfde reden.
    const ok = await dialog.confirm({
      title: t('vtg.verwijderenVraag'),
      message: t('vtg.verwijderenUitleg'),
      confirmLabel: t('lijst.verwijderen'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/vehicles?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json(); setError(failureText(res.status, j, t('vtg.fout.opslaan'))); return }
      await load()
    } catch {
      setError(t('vtg.fout.opslaan'))
    } finally {
      setBusy(false)
    }
  }

  const calling = today ? vehiclesNeedingApk(vehicles, today) : []

  return (
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 96px' }}>
      {/* [DEUR] Zie KassaClient: de naam hoort in de gedeelde balk (chrome.voertuigen), de uitleg
          hier. */}
      <header>
        <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>
          {t('vtg.uitleg')}
        </p>
      </header>

      {error && (
        <div role="alert" style={{ fontFamily: FONT, fontSize: 14, color: M3.error, background: M3.errorContainer, borderRadius: 12, padding: 12 }}>
          {error}
        </div>
      )}

      {/* The reason to open this in the morning — rendered only when there is something to call
          about, because an empty reminder panel trains an owner to stop reading it. */}
      <ApkCallList vehicles={calling} t={t} />

      {open ? (
        <section style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label={t('vtg.kenteken')} value={form.kenteken}
            onChange={(v) => setForm((f) => ({ ...f, kenteken: v }))} placeholder="12-ABC-3" />
          <Field label={t('vtg.auto')} value={form.description}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Volkswagen Golf" />
          <Field label={t('vtg.klant')} value={form.customer_name}
            onChange={(v) => setForm((f) => ({ ...f, customer_name: v }))} />
          <Field label={t('vtg.telefoon')} value={form.customer_phone}
            onChange={(v) => setForm((f) => ({ ...f, customer_phone: v }))} />
          <div>
            <label style={labelStyle}>{t('vtg.apk')}</label>
            {/* [DATE-NL] A date in the order a Dutch owner reads it. */}
            <DateFieldNL value={form.apk_expiry} onChange={(iso) => setForm((f) => ({ ...f, apk_expiry: iso }))} />
          </div>
          <Field label={t('vtg.notitie')} value={form.notes}
            onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
          <button type="button" onClick={() => void save()} disabled={busy} style={primaryButton}>
            {busy ? t('kassa.bezig') : t('vtg.opslaan')}
          </button>
        </section>
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={primaryButton}>
          {t('vtg.toevoegen')}
        </button>
      )}

      <VehicleList vehicles={vehicles} today={today} onRemove={(id) => void remove(id)} t={t} />
    </div>
  )
}

function Field({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        style={{
          width: '100%', fontFamily: FONT, fontSize: 15, padding: '11px 13px', borderRadius: 10,
          border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface,
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

const labelStyle = { display: 'block', fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 5 }
const primaryButton = {
  width: '100%', fontFamily: FONT, fontSize: 15, fontWeight: 600, borderRadius: 12,
  padding: '14px 8px', border: 'none', background: M3.primary, color: '#fff', cursor: 'pointer',
}
