'use client'

// src/app/dashboard/werk/WerkClient.tsx
// [WERK] The trade's own work — state and network. Everything that draws a row lives in
// WerkPanels.tsx so the render gate can hand those components real rows.
//
// The screen a mechanic opens the app for: the werkorders of today grouped by status, one button
// to open a new one, and on each one the taps the trade makes — move it, add a line, write the
// hours, attach the parts invoice, make the invoice. The invoice is made through the ordinary
// draft door on the server and opened in the ordinary editor; nothing about money is decided here.
//
// [WERK-BEURT] Repeating work (a weekly schoonmaak) ticks beurten off here and invoices them
// together. [WERK-VERZAMEL] Finished work of one client can go on one verzamelfactuur from the
// list. [WERK-BON] A bon or photo is taken from INSIDE the work: it goes through the ordinary
// intake door (/api/intake — read, deduplicated, filed), and what comes back is attached to this
// work as a cost or as a file. The owner is standing at the parts counter with the werkorder
// open; that is where the bon belongs, not in a guess made later at intake.
//
// [WERK-3] After the adversarial review: a refusal from the server is shown INSIDE the sheet
// (the page behind it is covered); lines the owner typed survive every other tap in the sheet;
// the work's details can be changed after the fact; the list answers "vandaag" and "deze week".

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'
import { sendWithFit } from '@/lib/upload-fit'
import { useDialog } from '@/components/ui/Dialog'
import { normalizeKenteken, isKentekenShape, displayKenteken } from '@/lib/vehicle'
import { amsterdamToday, formatEuroNL } from '@/lib/format-nl'
import {
  workSkin, REPEAT_KEYS, canDelete, hoursBudget, phoneTarget, readyMessageNL, dueOn, inWindow, linesTotalInc, financialReadiness, overBudget, contractFee, periodOf, periodLabelNL,
  type WorkStatus, type WorkLine, type WorkMargin, type ContractStat,
  bundleState,
} from '@/lib/werk'
import type { WorkStand } from '@/lib/werk-stand'
import type { WorkRow, AttachedHours, AttachedCost, AttachedDocument, WorkHistory, WorkInvoiceSummary } from '@/lib/werk-rows'
import {
  WorkList, WorkSheet, WorkForm, StatusChips, LinesEditor, MarginLine, AttachedList, CandidateList, VisitsPanel, DocumentsList, TogetherOffer, ReadinessList, ContractsPanel,
  HistoryList, HoursForm, EMPTY_FORM, invoiceButtonState, primaryButton, ghostButton, type WorkFormValue, type LineSuggestion, type T, StandPanel , BundlePanel } from './WerkPanels'

const FONT = "'Roboto', -apple-system, sans-serif"

type Detail = {
  row: WorkRow
  hours: AttachedHours[]
  hoursTotal: number
  costs: AttachedCost[]
  documents: AttachedDocument[]
  invoice: WorkInvoiceSummary | null
  margin: WorkMargin
  history: WorkHistory[]
  candidates: { hours: AttachedHours[]; costs: AttachedCost[] } | null
  /** [OFFERTE-WERK] The accepted offerte this work came from, by name. */
  offerte: { id: string; invoice_number: string | null } | null
}

/** [OFFERTE-WERK] One offerte that can still become work. */
type OfferteOptie = { id: string; invoice_number: string | null; client_name: string | null; total_ex_btw: number | null; akkoord: boolean }

type Filter = 'open' | 'vandaag' | 'week' | 'all' | 'contracten'

/** The form as the row is: what "Gegevens aanpassen" starts from. */
function formFromRow(row: WorkRow): WorkFormValue {
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(row.fields)) fields[k] = String(v)
  return { title: row.title, client_name: row.client_name ?? '', kenteken: row.kenteken ?? '', planned_on: row.planned_on ?? '', fields, repeat_every: row.repeat_every ?? '', notes: row.notes ?? '' }
}

export default function WerkClient({ vak }: { vak: string }) {
  const t = translator(useLocale()) as unknown as T
  const router = useRouter()
  const dialog = useDialog()
  const skin = workSkin(vak)!
  const [rows, setRows] = useState<WorkRow[]>([])
  const [filter, setFilter] = useState<Filter>('open')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<WorkFormValue>({ ...EMPTY_FORM })
  const [detail, setDetail] = useState<Detail | null>(null)
  const [lines, setLines] = useState<WorkLine[]>([])
  const [picking, setPicking] = useState<'hours' | 'costs' | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [suggestions, setSuggestions] = useState<LineSuggestion[]>([])
  const [previous, setPrevious] = useState<WorkLine[] | null>(null)
  // [OFFERTE-WERK] The offertes that can still become work, and the one the owner picked.
  const [offertes, setOffertes] = useState<OfferteOptie[]>([])
  const [offerteId, setOfferteId] = useState('')
  // [CONTRACT] The portfolio, loaded when the chip is chosen; per client, this period's figures.
  const [contracts, setContracts] = useState<{ period: string; groups: Array<{ client_name: string; contracts: ContractStat[] }>; readFailed: boolean } | null>(null)
  // [WERK-STAND] What the screen opens on: the money position. null = not read yet; 'failed' = said so.
  const [stand, setStand] = useState<WorkStand | 'failed' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The lines as typed, readable from an async reload without a stale closure.
  const linesRef = useRef<WorkLine[]>([])
  useEffect(() => { linesRef.current = lines }, [lines])

  const load = useCallback(async () => {
    try {
      if (filter === 'contracten') {
        const res = await fetch('/api/werk?contracten=1')
        const json = await res.json()
        if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.laden'))); return }
        setContracts({ period: json.period, groups: json.groups ?? [], readFailed: !!json.readFailed })
        setError('')
        return
      }
      // [WERK-STAND] The position beside the rows; its failure is its own line, never the list's.
      const [res, standRes] = await Promise.all([
        fetch(`/api/werk?status=${filter === 'all' ? 'all' : 'open'}`),
        fetch('/api/werk?stand=1').catch(() => null),
      ])
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.laden'))); return }
      setRows(json.rows ?? [])
      setError('')
      const standJson = standRes && standRes.ok ? await standRes.json().catch(() => null) : null
      setStand(standJson && standJson.counts ? { pluralKey: standJson.pluralKey, counts: standJson.counts, signals: standJson.signals ?? [] } : 'failed')
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

  // The owner's own articles, once, as the description box's suggestions: a standard job is a
  // pick, not a retype, and its price and rate come along.
  const loadSuggestions = useCallback(async () => {
    if (suggestions.length > 0) return
    try {
      const res = await fetch('/api/articles')
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(json.articles)) return
      setSuggestions((json.articles as Array<Record<string, unknown>>).filter((a) => a.active !== false).map((a) => ({
        description: String(a.description ?? ''), unit_price: typeof a.unit_price === 'number' ? a.unit_price : null,
        btw_rate: typeof a.btw_rate === 'number' ? a.btw_rate : 21, unit: typeof a.unit === 'string' ? a.unit : null,
      })).filter((a) => a.description))
    } catch { /* suggestions are a convenience; the box works without them */ }
  }, [suggestions.length])

  /**
   * Load one piece of work. `keepLines` leaves the line editor as the owner typed it — every tap
   * that is not "save the lines" (a status chip, a beurt, a bon) reloads the row and must not
   * throw three typed lines away.
   */
  async function openDetail(id: string, withCandidates = false, keepLines = false) {
    try {
      const res = await fetch(`/api/werk/${id}${withCandidates ? '?candidates=1' : ''}`)
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.laden'))); return }
      setDetail({ row: json.row, hours: json.hours ?? [], hoursTotal: json.hoursTotal ?? 0, costs: json.costs ?? [], documents: json.documents ?? [], invoice: json.invoice ?? null, margin: json.margin, history: json.history ?? [], candidates: json.candidates ?? null, offerte: json.offerte ?? null })
      const dirty = JSON.stringify(linesRef.current) !== JSON.stringify(detail?.row.lines ?? [])
      if (!(keepLines && dirty)) setLines(json.row.lines ?? [])
      setEditing(false)
      void loadSuggestions()
    } catch {
      setError(t('werk.fout.laden'))
    }
  }

  function startCreate() {
    setForm({ ...EMPTY_FORM }); setLines([]); setPrevious(null); setError(''); setCreating(true)
    setOfferteId('')
    void loadSuggestions()
    // [OFFERTE-WERK] A failed read leaves the picker away; typing the work by hand still works.
    void (async () => {
      try {
        const res = await fetch('/api/werk?offertes=1')
        const json = await res.json().catch(() => ({}))
        setOffertes(res.ok && Array.isArray(json.offertes) ? json.offertes : [])
      } catch { setOffertes([]) }
    })()
  }

  /** [OFFERTE-WERK] Picking an offerte fills what it knows; the lines and the amount come from
   *  the server when the work is saved, so the agreement travels whole. */
  function pickOfferte(id: string) {
    setOfferteId(id)
    const o = offertes.find((x) => x.id === id)
    if (!o) return
    setForm((f) => ({
      ...f,
      client_name: o.client_name ?? f.client_name,
      title: f.title.trim() ? f.title : (o.invoice_number ? `Offerte ${o.invoice_number}` : f.title),
    }))
    setPrevious(null)
  }

  // "Regels van vorige keer": the courier's fixed tariff for this opdrachtgever, one tap.
  async function lookupPrevious(clientName: string) {
    const name = clientName.trim()
    if (!name) { setPrevious(null); return }
    try {
      const res = await fetch(`/api/werk?vorige=${encodeURIComponent(name)}`)
      const json = await res.json().catch(() => ({}))
      setPrevious(res.ok && Array.isArray(json.lines) && json.lines.length > 0 ? json.lines : null)
    } catch { setPrevious(null) }
  }

  async function create() {
    if (busy) return
    if (!form.client_name.trim()) { setError(t('werk.fout.klant')); return }
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
          offerte_id: offerteId || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      setCreating(false); setForm({ ...EMPTY_FORM }); setLines([]); setPrevious(null); setOfferteId('')
      await load()
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  async function patch(body: Record<string, unknown>) {
    if (!detail || busy) return
    // Lines the owner typed ride along with any other change, so a status tap never loses them.
    const dirty = JSON.stringify(lines) !== JSON.stringify(detail.row.lines)
    const withLines = dirty && body.lines === undefined && detail.row.status !== 'gefactureerd' ? { ...body, lines } : body
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/werk', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: detail.row.id, ...withLines }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      await openDetail(detail.row.id)
      await load()
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  async function saveDetails() {
    if (!detail) return
    if (!form.client_name.trim()) { setError(t('werk.fout.klant')); return }
    await patch({
      title: form.title, client_name: form.client_name, planned_on: form.planned_on || null, notes: form.notes, fields: form.fields,
      ...(skin.recurring ? { repeat_every: form.repeat_every || null } : {}),
    })
  }

  async function koppel(action: string, ids: string[]) {
    if (!detail || busy || ids.length === 0) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/werk/${detail.row.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      if (action.startsWith('attach') && json.touched === 0) setError(t('werk.nietsGekoppeld'))
      setPicking(null); setChosen(new Set())
      await openDetail(detail.row.id, false, true)
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  // [WERK-3] Hours written on the work, on site: through the ordinary hours door with this work's id.
  async function writeHours(entry: { worked_on: string; hours: string; description: string; hourly_rate: string }) {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/uren', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: detail.row.client_id, work_item_id: detail.row.id,
          worked_on: entry.worked_on || amsterdamToday(), hours: entry.hours.replace(',', '.'), description: entry.description,
          hourly_rate: entry.hourly_rate.trim() ? entry.hourly_rate.replace(',', '.') : null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.opslaan'))); return }
      await openDetail(detail.row.id, false, true)
    } catch {
      setError(t('werk.fout.opslaan'))
    } finally { setBusy(false) }
  }

  // [CONTRACT] The period invoice from the portfolio: this month's fee, once, through the same door.
  async function invoicePeriod(id: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/werk/${id}/factuur`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: periodOf(amsterdamToday()) }) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.factuur'))); return }
      router.push(`/dashboard/invoice/${json.invoiceId}/edit`)
    } catch {
      setError(t('werk.fout.factuur'))
    } finally { setBusy(false) }
  }

  async function makeInvoice() {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const period = contractFee(detail.row) !== null ? periodOf(amsterdamToday()) : null
      const res = await fetch(`/api/werk/${detail.row.id}/factuur`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(period ? { period } : {}) })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, t('werk.fout.factuur'))); return }
      if (json.hoursWithoutRate > 0) {
        // The one sentence the owner must read before the editor: stay, say it, and let the
        // "Factuur bekijken" button that appears on reload take them there.
        setNote(`${t('werk.factuurKlaar')} ${t('werk.urenZonderTarief', { n: json.hoursWithoutRate })}`)
        await openDetail(detail.row.id)
        await load()
        return
      }
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
      await openDetail(detail.row.id, false, true)
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
      await openDetail(detail.row.id, false, true)
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
  const closed = detail ? detail.row.status === 'gefactureerd' && !!detail.row.invoice_id : false

  // The list, answered: today, this week, or everything open; then the search box over what is shown.
  const today = amsterdamToday()
  const needle = search.trim().toLowerCase()
  const shown = rows.filter((r) => {
    if (filter === 'vandaag' || filter === 'week') {
      if (!inWindow(dueOn(r), today, filter === 'vandaag' ? 0 : 7)) return false
    }
    if (!needle) return true
    const hay = [r.title, r.client_name ?? '', r.kenteken ?? '', ...Object.values(r.fields).map(String)].join(' ').toLowerCase()
    return hay.includes(needle)
  })

  const phone = detail ? phoneTarget(detail.row.fields.telefoon) : null
  const readyText = detail ? readyMessageNL({ skin, kenteken: detail.row.kenteken ? displayKenteken(detail.row.kenteken) : null, fields: detail.row.fields, totalIncBtw: detail.invoice?.total_inc_btw ?? (lines.length > 0 ? linesTotalInc(lines) : null) }) : ''

  return (
    <div style={{ ...COLUMN, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 96px' }}>
      {/* [WERK-STAND] The money first, the list second: this screen is the door from work to
          money, not a work-order system. A tap on a line lands on the screen that fixes it. */}
      <StandPanel stand={stand} t={t} onTap={(href) => { if (href === '/dashboard/werk') setFilter('open'); else router.push(href) }} />
      <header>
        <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>{t('werk.uitleg', { plural })}</p>
      </header>

      {error && !creating && !detail && (
        <div role="alert" style={{ fontFamily: FONT, fontSize: 14, color: M3.error, background: M3.errorContainer, borderRadius: 12, padding: 12 }}>{error}</div>
      )}

      <button type="button" onClick={startCreate} style={primaryButton}>
        {t('werk.nieuw', { noun })}
      </button>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([...(['open', 'vandaag', 'week', 'all'] as const), ...(skin.recurring ? (['contracten'] as const) : [])] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            style={{ ...ghostButton, background: filter === f ? '#E8F0FE' : M3.surface, borderColor: filter === f ? M3.primary : M3.outlineVariant }}>
            {f === 'open' ? t('werk.filter.open') : f === 'vandaag' ? t('werk.filter.vandaag') : f === 'week' ? t('werk.filter.week') : f === 'contracten' ? t('werk.filter.contracten') : t('werk.filter.alles')}
          </button>
        ))}
      </div>
      {filter === 'contracten' && contracts && (
        <ContractsPanel groups={contracts.groups} period={contracts.period} t={t} disabled={busy} readFailed={contracts.readFailed}
          onOpen={(id) => void openDetail(id)} onInvoicePeriod={(id) => void invoicePeriod(id)} />
      )}
      {rows.length > 5 && (
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('werk.zoeken')} aria-label={t('werk.zoeken')}
          style={{ fontFamily: FONT, fontSize: 15, padding: '10px 12px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface }} />
      )}

      {filter !== 'contracten' && <TogetherOffer rows={shown} t={t} disabled={busy} onTogether={(ids, client) => void together(ids, client)} />}

      <WorkList rows={shown} skin={skin} t={t} onOpen={(id) => { setError(''); setNote(''); void openDetail(id) }} />

      {creating && (
        <WorkSheet title={t('werk.nieuw', { noun })} onClose={() => !busy && setCreating(false)} testId="work-create-sheet" error={error}>
          {/* [OFFERTE-WERK] The accepted offerte becomes the work: its lines and its agreed
              amount travel, and the offerte moves to the archive so there is one door to the money. */}
          {offertes.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 5 }} htmlFor="werk-offerte">{t('werk.offerte.kies')}</label>
              <select id="werk-offerte" value={offerteId} disabled={busy} onChange={(e) => pickOfferte(e.target.value)}
                style={{ width: '100%', fontFamily: FONT, fontSize: 15, padding: '10px 12px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface }}>
                <option value="">{t('werk.offerte.geen')}</option>
                {offertes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {[o.invoice_number, o.client_name, o.total_ex_btw !== null ? formatEuroNL(o.total_ex_btw) : null, o.akkoord ? t('werk.offerte.akkoord') : null].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
              {offerteId && <p style={{ fontFamily: FONT, fontSize: 12.5, color: M3.onSurfaceVariant, margin: '6px 0 0' }}>{t('werk.offerte.uitleg')}</p>}
            </div>
          )}
          <WorkForm skin={skin} value={form} onChange={(v) => { setForm(v); if (v.client_name !== form.client_name) setPrevious(null) }} t={t} disabled={busy} />
          <button type="button" onClick={() => void lookupPrevious(form.client_name)} disabled={busy || !form.client_name.trim()} style={{ ...ghostButton, marginTop: 8 }}>{t('werk.vorigeZoeken')}</button>
          {previous && (
            <button type="button" onClick={() => { setLines(previous); setPrevious(null) }} disabled={busy} style={{ ...ghostButton, marginTop: 8, marginInlineStart: 8 }}>{t('werk.vorigeRegels', { n: previous.length })}</button>
          )}
          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '14px 0 6px' }}>{t('werk.regels')}</p>
          <LinesEditor skin={skin} lines={lines} t={t} onChange={setLines} disabled={busy} suggestions={suggestions} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setCreating(false)} disabled={busy} style={{ ...ghostButton, flex: 1, padding: '12px' }}>{t('werk.annuleren')}</button>
            <button type="button" onClick={() => void create()} disabled={busy} style={{ ...primaryButton, flex: 2 }}>{busy ? t('act.bezig') : t('werk.opslaan')}</button>
          </div>
        </WorkSheet>
      )}

      {detail && (
        <WorkSheet title={`${skin.vehicle && detail.row.kenteken ? `${displayKenteken(detail.row.kenteken)} · ` : ''}${detail.row.title}`} onClose={() => !busy && setDetail(null)} testId="work-detail-sheet" error={error}>
          {editing ? (
            <>
              <WorkForm skin={skin} value={form} onChange={setForm} t={t} disabled={busy} editing />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" onClick={() => setEditing(false)} disabled={busy} style={{ ...ghostButton, flex: 1, padding: '12px' }}>{t('werk.annuleren')}</button>
                <button type="button" onClick={() => void saveDetails()} disabled={busy} style={{ ...primaryButton, flex: 2 }}>{busy ? t('act.bezig') : t('werk.opslaan')}</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontFamily: FONT, fontSize: 13.5, color: M3.onSurfaceVariant, margin: '0 0 4px' }}>
                {detail.row.client_name ?? '—'}
                {skin.fields.filter((f) => f.key !== 'telefoon' && detail.row.fields[f.key] !== undefined).map((f) => ` · ${t(f.labelKey)}: ${detail.row.fields[f.key]}`).join('')}
              </p>
              {detail.row.notes && <p style={{ fontFamily: FONT, fontSize: 13.5, color: M3.onSurface, margin: '0 0 8px', whiteSpace: 'pre-wrap' }} data-testid="work-notes">{detail.row.notes}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {!closed && <button type="button" onClick={() => { setForm(formFromRow(detail.row)); setEditing(true) }} disabled={busy} style={ghostButton}>{t('werk.gegevensAanpassen')}</button>}
                {phone && <a href={phone.tel} style={{ ...ghostButton, textDecoration: 'none' }}>{t('werk.bellen')}</a>}
                {phone && detail.row.status === 'klaar' && (
                  <a href={`${phone.wa}?text=${encodeURIComponent(readyText)}`} target="_blank" rel="noopener noreferrer" style={{ ...ghostButton, textDecoration: 'none' }}>{t('werk.klaarBericht')}</a>
                )}
              </div>
            </>
          )}

          {note && <div style={{ fontFamily: FONT, fontSize: 13, background: '#E6F4EA', color: '#137333', borderRadius: 10, padding: 10, marginBottom: 12 }}>{note}</div>}

          <StatusChips skin={skin} current={detail.row.status} t={t} disabled={busy || closed} onPick={(s: WorkStatus) => void patch({ status: s })} />

          {detail.row.repeat_every && (
            <>
              <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t(skin.visitKeys?.list ?? 'werk.beurten')} · {t(REPEAT_KEYS[detail.row.repeat_every])}</p>
              <VisitsPanel visits={detail.row.visits} t={t} disabled={busy || detail.row.status === 'geannuleerd'}
                onVisit={(on, n) => void visit('visit', on, n)} onUnvisit={(on) => void visit('unvisit', on)}
                invoiceHref={(id) => `/dashboard/invoice/${id}/edit`} keys={skin.visitKeys} />
            </>
          )}

          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.regels')}</p>
          <LinesEditor skin={skin} lines={lines} t={t} onChange={setLines} disabled={busy || closed} suggestions={suggestions} />
          {linesDirty && (
            <button type="button" onClick={() => void patch({ lines })} disabled={busy} style={{ ...primaryButton, marginTop: 8 }}>{busy ? t('act.bezig') : t('werk.opslaan')}</button>
          )}

          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.uren')} · {t('werk.kosten')} · {t('werk.bestanden')}</p>
          <AttachedList hours={detail.hours} costs={detail.costs} t={t}
            onDetachHours={closed ? undefined : (id) => void koppel('detach_hours', [id])}
            onDetachCost={closed ? undefined : (id) => void koppel('detach_cost', [id])} />
          <DocumentsList documents={detail.documents} t={t} onDetach={(id) => void koppel('detach_document', [id])} />
          {!closed && detail.row.status !== 'geannuleerd' && (
            <div style={{ marginTop: 8 }}>
              <HoursForm t={t} disabled={busy} onSave={(e) => void writeHours(e)} defaultRate={detail.hours.find((h) => h.hourly_rate !== null)?.hourly_rate ?? null} />
            </div>
          )}
          {/* No `capture`: with it, the phone opens the camera only, and a PDF bon from the mail can never be picked. */}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden aria-hidden="true" tabIndex={-1}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void bon(f) }} />
          {picking === null ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {!closed && (
                <button type="button" style={ghostButton} disabled={busy} onClick={() => { setPicking('hours'); setChosen(new Set()); void openDetail(detail.row.id, true, true) }}>{t('werk.urenKoppelen')}</button>
              )}
              {!closed && (
                <button type="button" style={ghostButton} disabled={busy} onClick={() => { setPicking('costs'); setChosen(new Set()); void openDetail(detail.row.id, true, true) }}>{t('werk.kostenKoppelen')}</button>
              )}
              <button type="button" style={ghostButton} disabled={busy} onClick={() => fileRef.current?.click()}>{t('werk.bon')}</button>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {picking === 'hours' ? (
                <CandidateList<AttachedHours>
                  items={detail.candidates?.hours ?? []}
                  label={(i) => `${i.worked_on} · ${i.hours} ${t('werk.uren').toLowerCase()} · ${i.description}${i.client_name ? ` · ${i.client_name}` : ''}`}
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

          {/* [STRIPPENKAART] The balance, above the margin: on a bundle this is the money question. */}
          {bundleState({ row: detail.row, hoursUsed: detail.hoursTotal }) && (
            <div style={{ margin: '16px 0 0' }}>
              <BundlePanel bundle={bundleState({ row: detail.row, hoursUsed: detail.hoursTotal })!} t={t} />
            </div>
          )}

          <div style={{ margin: '16px 0 0' }}>
            <MarginLine margin={detail.margin} hoursTotal={detail.hoursTotal} t={t} budget={hoursBudget(detail.row.fields, detail.hoursTotal)}
              estimate={overBudget(detail.row, detail.hours.filter((h) => !h.invoice_id && h.hourly_rate !== null).reduce((s, h) => s + h.hours * (h.hourly_rate ?? 0), 0))} />
          </div>

          {/* [OFFERTE-WERK] Where this work came from. The offerte is archived, so this line is the
              only place it is still named — and the number is what the customer said yes to. */}
          {detail.offerte && (
            <p style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, margin: '12px 0 0' }}>
              {t('werk.offerte.uit', { nummer: detail.offerte.invoice_number ?? '—' })}
            </p>
          )}

          {detail.history.length > 0 && (
            <>
              <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '16px 0 6px' }}>{t('werk.geschiedenis')}</p>
              <HistoryList history={detail.history} t={t} onOpen={(id) => void openDetail(id)} />
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {invoiceButtonState(detail.row, detail.invoice, amsterdamToday()) !== 'view' && (
              <ReadinessList readiness={financialReadiness({ row: detail.row, hours: detail.hours, today: amsterdamToday() })} t={t} />
            )}
            {invoiceButtonState(detail.row, detail.invoice, amsterdamToday()) === 'make' && (
              <button type="button" onClick={() => void makeInvoice()} disabled={busy || linesDirty || !financialReadiness({ row: detail.row, hours: detail.hours, today: amsterdamToday() }).ok} style={primaryButton}>
                {busy ? t('act.bezig') : contractFee(detail.row) !== null ? t('werk.periodeFactuur', { periode: periodLabelNL(periodOf(amsterdamToday())) }) : detail.row.repeat_every ? t(skin.visitKeys?.invoice ?? 'werk.beurtFactuur', { n: detail.row.visits.filter((v) => !v.invoice_id).length }) : t('werk.factuurMaken')}
              </button>
            )}
            {invoiceButtonState(detail.row, detail.invoice, amsterdamToday()) === 'view' && (
              <button type="button" onClick={() => router.push(`/dashboard/invoice/${detail.invoice?.id ?? detail.row.invoice_id}/edit`)} style={primaryButton}>{t('werk.factuurBekijken')}</button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {canDelete({ invoice_id: detail.row.invoice_id, attachedCosts: detail.costs.length, attachedHours: detail.hours.length, visits: detail.row.visits }) && (
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
