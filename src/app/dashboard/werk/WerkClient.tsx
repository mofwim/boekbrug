'use client'

// src/app/dashboard/werk/WerkClient.tsx
// [WERK] The trade's own work — state and network. Everything that draws a row lives in
// WerkPanels.tsx so the render gate can hand those components real rows.
//
// The screen a mechanic opens the app for: the werkorders of today grouped by status, one button
// to open a new one, and on each one the taps the trade makes — move it, add a line, attach the
// hours and the parts invoice, make the invoice. The invoice is made through the ordinary draft
// door on the server and opened in the ordinary editor; nothing about money is decided here.
//
// [WERK-BEURT] Repeating work (a weekly schoonmaak) ticks beurten off here and invoices them
// together. [WERK-VERZAMEL] Finished work of one client can go on one verzamelfactuur from the
// list. [WERK-BON] A bon or photo is taken from INSIDE the work: it goes through the ordinary
// intake door (/api/intake — read, deduplicated, filed), and what comes back is attached to this
// work as a cost or as a file. The owner is standing at the parts counter with the werkorder
// open; that is where the bon belongs, not in a guess made later at intake.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { sendWithFit } from '@/lib/upload-fit'
import { useDialog } from '@/components/ui/Dialog'
import { normalizeKenteken, isKentekenShape, displayKenteken } from '@/lib/vehicle'
import { workSkin, REPEAT_KEYS, type WorkStatus, type WorkLine, type WorkMargin } from '@/lib/werk'
import type { WorkRow, AttachedHours, AttachedCost, AttachedDocument, WorkInvoiceSummary } from '@/lib/werk-rows'
import {
  WorkList, WorkSheet, WorkForm, StatusChips, LinesEditor, MarginLine, AttachedList, CandidateList, VisitsPanel, DocumentsList, TogetherOffer,
  EMPTY_FORM, invoiceButtonState, primaryButton, ghostButton, type WorkFormValue, type T,
} from './WerkPanels'

const FONT = "'Roboto', -apple-system, sans-serif"

type Detail = {
  row: WorkRow
  hours: AttachedHours[]
  hoursTotal: number
  costs: AttachedCost[]
  documents: AttachedDocument[]
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
  const fileRef = useRef<HTMLInputElement>(null)

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
      setDetail({ row: json.row, hours: json.hours ?? [], hoursTotal: json.hoursTotal ?? 0, costs: json.costs ?? [], documents: json.documents ?? [], invoice: json.invoice ?? null, margin: json.margin, candidates: json.candidates ?? null })
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
          repeat_every: skin.recurring && form.repeat_every ? form.repeat_every : null,
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

  // [WERK-BEURT] Tick a beurt off, or take an unbilled one back.
  async function visit(action: 'visit' | 'unvisit', on: string, noteText = '') {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/werk/${detail.row.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, on: on || undefined, note: noteText || undefined }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      await openDetail(detail.row.id)
      await load()
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  // [WERK-VERZAMEL] One invoice for several finished pieces of work of one client.
  async function together(ids: string[], clientName: string) {
    if (busy) return
    const ok = await dialog.confirm({ title: t('werk.verzamel'), message: t('werk.verzamelVraag', { n: ids.length, client: clientName }), confirmLabel: t('werk.factuurMaken') })
    if (!ok) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/werk/factuur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.factuur'))); return }
      router.push(`/dashboard/invoice/${json.invoiceId}/edit`)
    } catch {
      setError(t('werk.fout.factuur'))
    } finally { setBusy(false) }
  }

  // [WERK-BON] A bon or photo from inside the work: through the ordinary intake door, then
  // attached here as a cost (a bon read as a purchase) or as a file (anything else). Nothing is
  // booked differently because it came from this screen — intake decides what it is, this screen
  // only says which werkorder it belongs to.
  async function bon(file: File) {
    if (!detail || busy) return
    setBusy(true); setError(''); setNote('')
    try {
      // [UPLOAD-PLAFOND] Through the shared fit, as every document upload: a phone photo is shrunk
      // to the platform's ceiling first, and a 413 is answered by squeezing harder once.
      const { response: res } = await sendWithFit(file, (f) => {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('source', 'camera')
        return fetch('/api/intake', { method: 'POST', body: fd })
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      const invoiceId = typeof json.invoice_id === 'string' ? json.invoice_id : null
      const documentId = typeof json.document_id === 'string' ? json.document_id : null
      if (invoiceId && (json.destination === 'invoice' || json.destination === 'receipt')) {
        const link = await fetch(`/api/werk/${detail.row.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'attach_cost', ids: [invoiceId] }) })
        setNote(link.ok ? t('werk.bonKosten') : t('werk.bonNietGekoppeld'))
      } else if (documentId) {
        const link = await fetch(`/api/werk/${detail.row.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'attach_document', ids: [documentId] }) })
        setNote(link.ok ? t('werk.bonBestand') : t('werk.bonNietGekoppeld'))
      } else {
        setNote(typeof json.message === 'string' && json.message ? json.message : t('werk.bonNietGekoppeld'))
      }
      await openDetail(detail.row.id)
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
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

      <TogetherOffer rows={rows} t={t} disabled={busy} onTogether={(ids, client) => void together(ids, client)} />

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

          {detail.row.repeat_every && (
            <>
              <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.beurten')} · {t(REPEAT_KEYS[detail.row.repeat_every])}</p>
              <VisitsPanel visits={detail.row.visits} t={t} disabled={busy || detail.row.status === 'geannuleerd'}
                onVisit={(on, n) => void visit('visit', on, n)} onUnvisit={(on) => void visit('unvisit', on)}
                invoiceHref={(id) => `/dashboard/invoice/${id}/edit`} />
            </>
          )}

          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.regels')}</p>
          <LinesEditor skin={skin} lines={lines} t={t} onChange={setLines} disabled={busy || detail.row.status === 'gefactureerd'} />
          {linesDirty && (
            <button type="button" onClick={() => void patch({ lines })} disabled={busy} style={{ ...primaryButton, marginTop: 8 }}>{busy ? t('act.bezig') : t('werk.opslaan')}</button>
          )}

          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.uren')} · {t('werk.kosten')} · {t('werk.bestanden')}</p>
          <AttachedList hours={detail.hours} costs={detail.costs} t={t}
            onDetachHours={detail.row.status === 'gefactureerd' ? undefined : (id) => void koppel('detach_hours', [id])}
            onDetachCost={(id) => void koppel('detach_cost', [id])} />
          <DocumentsList documents={detail.documents} t={t} onDetach={(id) => void koppel('detach_document', [id])} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden aria-hidden="true" tabIndex={-1}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void bon(f) }} />
          {picking === null ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {detail.row.status !== 'gefactureerd' && (
                <button type="button" style={ghostButton} disabled={busy} onClick={() => { setPicking('hours'); setChosen(new Set()); void openDetail(detail.row.id, true) }}>{t('werk.urenKoppelen')}</button>
              )}
              <button type="button" style={ghostButton} disabled={busy} onClick={() => { setPicking('costs'); setChosen(new Set()); void openDetail(detail.row.id, true) }}>{t('werk.kostenKoppelen')}</button>
              <button type="button" style={ghostButton} disabled={busy} onClick={() => fileRef.current?.click()}>{t('werk.bon')}</button>
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
              <button type="button" onClick={() => void makeInvoice()} disabled={busy || linesDirty} style={primaryButton}>
                {busy ? t('act.bezig') : detail.row.repeat_every ? t('werk.beurtFactuur', { n: detail.row.visits.filter((v) => !v.invoice_id).length }) : t('werk.factuurMaken')}
              </button>
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
