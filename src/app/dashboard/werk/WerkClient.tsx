'use client'

// src/app/dashboard/werk/WerkClient.tsx
// [WERK] The trade's own work — state and network. Everything that draws a row lives in
// WerkPanels.tsx so the render gate can hand those components real rows.
//
// The screen a mechanic opens the app for: the werkorders of today grouped by status, one button
// to open a new one, and on each one the taps the trade makes — move it, add a line, attach the
// hours and the parts invoice, make the invoice. The invoice is made through the ordinary draft
// door on the server and opened in the ordinary editor; nothing about money is decided here.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { useDialog } from '@/components/ui/Dialog'
import { normalizeKenteken, isKentekenShape, displayKenteken } from '@/lib/vehicle'
import { workSkin, type WorkStatus, type WorkLine, type WorkMargin } from '@/lib/werk'
import type { WorkRow, AttachedHours, AttachedCost, WorkInvoiceSummary } from '@/lib/werk-rows'
import {
  WorkList, WorkSheet, WorkForm, StatusChips, LinesEditor, MarginLine, AttachedList, CandidateList,
  EMPTY_FORM, invoiceButtonState, primaryButton, ghostButton, type WorkFormValue, type T,
} from './WerkPanels'

const FONT = "'Roboto', -apple-system, sans-serif"

type Detail = {
  row: WorkRow
  hours: AttachedHours[]
  hoursTotal: number
  costs: AttachedCost[]
  invoice: WorkInvoiceSummary | null
  margin: WorkMargin
  candidates: { hours: AttachedHours[]; costs: AttachedCost[] } | null
}

export default function WerkClient({ vak }: { vak: string }) {
  const t = translator(useLocale()) as unknown as T
  const router = useRouter()
  const dialog = useDialog()
  const skin = workSkin(vak)!
  const [rows, setRows] = useState<WorkRow[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<WorkFormValue>({ ...EMPTY_FORM })
  const [detail, setDetail] = useState<Detail | null>(null)
  const [lines, setLines] = useState<WorkLine[]>([])
  const [picking, setPicking] = useState<'hours' | 'costs' | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/werk?status=${filter}`)
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.laden'))); return }
      setRows(json.rows ?? [])
      setError('')
    } catch {
      setError(t('werk.fout.laden'))
    }
  }, [filter, t])

  useEffect(() => {
    let cancelled = false
    const run = async () => { if (!cancelled) await load() }
    void run()
    return () => { cancelled = true }
  }, [load])

  async function openDetail(id: string, withCandidates = false) {
    try {
      const res = await fetch(`/api/werk/${id}${withCandidates ? '?candidates=1' : ''}`)
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.laden'))); return }
      setDetail({ row: json.row, hours: json.hours ?? [], hoursTotal: json.hoursTotal ?? 0, costs: json.costs ?? [], invoice: json.invoice ?? null, margin: json.margin, candidates: json.candidates ?? null })
      setLines(json.row.lines ?? [])
      setNote('')
    } catch {
      setError(t('werk.fout.laden'))
    }
  }

  async function create() {
    if (busy) return
    if (skin.skin === 'werkorder' && !isKentekenShape(form.kenteken)) { setError('Dit lijkt geen Nederlands kenteken. Controleer de tekens.'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/werk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, client_name: form.client_name, planned_on: form.planned_on || null, notes: form.notes,
          kenteken: skin.vehicle && form.kenteken ? normalizeKenteken(form.kenteken) : undefined,
          fields: form.fields, lines,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      setCreating(false); setForm({ ...EMPTY_FORM }); setLines([])
      await load()
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  async function patch(body: Record<string, unknown>) {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/werk', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: detail.row.id, ...body }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      await openDetail(detail.row.id)
      await load()
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  async function koppel(action: string, ids: string[]) {
    if (!detail || busy || ids.length === 0) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/werk/${detail.row.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      setPicking(null); setChosen(new Set())
      await openDetail(detail.row.id)
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  async function makeInvoice() {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/werk/${detail.row.id}/factuur`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.factuur'))); return }
      const extra = json.hoursWithoutRate > 0 ? ` ${t('werk.urenZonderTarief', { n: json.hoursWithoutRate })}` : ''
      setNote(`${t('werk.factuurKlaar')}${extra}`)
      router.push(`/dashboard/invoice/${json.invoiceId}/edit`)
    } catch {
      setError(t('werk.fout.factuur'))
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!detail || busy) return
    const ok = await dialog.confirm({ title: t('werk.verwijderenVraag'), message: detail.row.title, confirmLabel: t('werk.verwijderen'), danger: true })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/werk?id=${encodeURIComponent(detail.row.id)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      setDetail(null)
      await load()
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  const toggle = (id: string) => setChosen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const noun = t(skin.nounKey)
  const plural = t(skin.pluralKey)
  const linesDirty = detail ? JSON.stringify(lines) !== JSON.stringify(detail.row.lines) : false

  return (
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 96px' }}>
      <header>
        <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>{t('werk.uitleg', { plural })}</p>
      </header>

      {error && (
        <div role="alert" style={{ fontFamily: FONT, fontSize: 14, color: M3.error, background: M3.errorContainer, borderRadius: 12, padding: 12 }}>{error}</div>
      )}

      <button type="button" onClick={() => { setForm({ ...EMPTY_FORM }); setLines([]); setCreating(true) }} style={primaryButton}>
        {t('werk.nieuw', { noun })}
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        {(['open', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            style={{ ...ghostButton, background: filter === f ? '#E8F0FE' : M3.surface, borderColor: filter === f ? M3.primary : M3.outlineVariant }}>
            {f === 'open' ? t('werk.filter.open') : t('werk.filter.alles')}
          </button>
        ))}
      </div>

      <WorkList rows={rows} skin={skin} t={t} onOpen={(id) => void openDetail(id)} />

      {creating && (
        <WorkSheet title={t('werk.nieuw', { noun })} onClose={() => !busy && setCreating(false)} testId="work-create-sheet">
          <WorkForm skin={skin} value={form} onChange={setForm} t={t} disabled={busy} />
          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '14px 0 6px' }}>{t('werk.regels')}</p>
          <LinesEditor skin={skin} lines={lines} t={t} onChange={setLines} disabled={busy} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setCreating(false)} disabled={busy} style={{ ...ghostButton, flex: 1, padding: '12px' }}>{t('werk.annuleren')}</button>
            <button type="button" onClick={() => void create()} disabled={busy} style={{ ...primaryButton, flex: 2 }}>{busy ? t('act.bezig') : t('werk.opslaan')}</button>
          </div>
        </WorkSheet>
      )}

      {detail && (
        <WorkSheet title={`${skin.vehicle && detail.row.kenteken ? `${displayKenteken(detail.row.kenteken)} · ` : ''}${detail.row.title}`} onClose={() => !busy && setDetail(null)} testId="work-detail-sheet">
          <p style={{ fontFamily: FONT, fontSize: 13.5, color: M3.onSurfaceVariant, margin: '0 0 12px' }}>
            {detail.row.client_name ?? '—'}
            {skin.fields.filter((f) => detail.row.fields[f.key] !== undefined).map((f) => ` · ${t(f.labelKey)}: ${detail.row.fields[f.key]}`).join('')}
          </p>

          {note && <div style={{ fontFamily: FONT, fontSize: 13, background: '#E6F4EA', color: '#137333', borderRadius: 10, padding: 10, marginBottom: 12 }}>{note}</div>}

          <StatusChips skin={skin} current={detail.row.status} t={t} disabled={busy || detail.row.status === 'gefactureerd'} onPick={(s: WorkStatus) => void patch({ status: s })} />

          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.regels')}</p>
          <LinesEditor skin={skin} lines={lines} t={t} onChange={setLines} disabled={busy || detail.row.status === 'gefactureerd'} />
          {linesDirty && (
            <button type="button" onClick={() => void patch({ lines })} disabled={busy} style={{ ...primaryButton, marginTop: 8 }}>{busy ? t('act.bezig') : t('werk.opslaan')}</button>
          )}

          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.uren')} · {t('werk.kosten')}</p>
          <AttachedList hours={detail.hours} costs={detail.costs} t={t}
            onDetachHours={detail.row.status === 'gefactureerd' ? undefined : (id) => void koppel('detach_hours', [id])}
            onDetachCost={(id) => void koppel('detach_cost', [id])} />
          {picking === null ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {detail.row.status !== 'gefactureerd' && (
                <button type="button" style={ghostButton} disabled={busy} onClick={() => { setPicking('hours'); setChosen(new Set()); void openDetail(detail.row.id, true) }}>{t('werk.urenKoppelen')}</button>
              )}
              <button type="button" style={ghostButton} disabled={busy} onClick={() => { setPicking('costs'); setChosen(new Set()); void openDetail(detail.row.id, true) }}>{t('werk.kostenKoppelen')}</button>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {picking === 'hours' ? (
                <CandidateList<AttachedHours>
                  items={detail.candidates?.hours ?? []}
                  label={(i) => `${i.worked_on} · ${i.hours} ${t('werk.uren').toLowerCase()} · ${i.description}`}
                  t={t} chosen={chosen} onToggle={toggle} />
              ) : (
                <CandidateList<AttachedCost>
                  items={detail.candidates?.costs ?? []}
                  label={(i) => `${i.client_name ?? '—'} · ${i.invoice_number ?? ''} · € ${Math.abs(i.total_ex_btw ?? 0).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`}
                  t={t} chosen={chosen} onToggle={toggle} />
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" style={{ ...ghostButton, flex: 1 }} disabled={busy} onClick={() => { setPicking(null); setChosen(new Set()) }}>{t('werk.annuleren')}</button>
                <button type="button" style={{ ...primaryButton, flex: 2 }} disabled={busy || chosen.size === 0} onClick={() => void koppel(picking === 'hours' ? 'attach_hours' : 'attach_cost', [...chosen])}>{t('werk.opslaan')}</button>
              </div>
            </div>
          )}

          <div style={{ margin: '16px 0 0' }}>
            <MarginLine margin={detail.margin} hoursTotal={detail.hoursTotal} t={t} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {invoiceButtonState(detail.row, detail.invoice) === 'make' && (
              <button type="button" onClick={() => void makeInvoice()} disabled={busy || linesDirty} style={primaryButton}>{busy ? t('act.bezig') : t('werk.factuurMaken')}</button>
            )}
            {invoiceButtonState(detail.row, detail.invoice) === 'view' && (
              <button type="button" onClick={() => router.push(`/dashboard/invoice/${detail.invoice?.id ?? detail.row.invoice_id}/edit`)} style={primaryButton}>{t('werk.factuurBekijken')}</button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {!detail.row.invoice_id && detail.hours.length === 0 && detail.costs.length === 0 && (
                <button type="button" onClick={() => void remove()} disabled={busy} style={{ ...ghostButton, color: M3.error }}>{t('werk.verwijderen')}</button>
              )}
              <button type="button" onClick={() => setDetail(null)} disabled={busy} style={{ ...ghostButton, marginInlineStart: 'auto' }}>{t('werk.sluiten')}</button>
            </div>
          </div>
        </WorkSheet>
      )}
    </div>
  )
}
