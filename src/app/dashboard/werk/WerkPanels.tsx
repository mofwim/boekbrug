'use client'

// src/app/dashboard/werk/WerkPanels.tsx
// [WERK] Everything that DRAWS a piece of work: the card, the list by status, the status chips,
// the line editor, the margin line, the form, the sheet chrome. No network, no language of its
// own — every string comes through `t`, every word for a status, a field or a line kind comes
// from the skin (werk.ts). WerkClient.tsx holds the state; the render gate hands these real rows.

import { useState, type ReactNode } from 'react'
import { M3, sheetPaddingBottom } from '@/lib/design/tokens'
import { useCloseOnBack } from '@/lib/use-close-on-back'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { formatEuroNL, formatDateNL } from '@/lib/format-nl'
import { round2 } from '@/lib/invoice-totals'
import { displayKenteken } from '@/lib/vehicle'
import DateFieldNL from '@/components/ui/DateFieldNL'
import {
  HAND_STATUSES, REPEATS, REPEAT_KEYS, statusKey, linesTotalEx, canInvoice, nextVisitOn, unbilledVisits, togetherGroups, DEFAULT_LINE_BTW,
  type WorkSkin, type WorkStatus, type WorkLine, type FieldValues, type Visit,
} from '@/lib/werk'
import type { WorkRow, AttachedHours, AttachedCost, AttachedDocument, WorkHistory, WorkInvoiceSummary } from '@/lib/werk-rows'
import type { WorkMargin, Readiness } from '@/lib/werk'

export type T = (key: string, vars?: Record<string, string | number>) => string

const FONT = "'Roboto', -apple-system, sans-serif"

const STATUS_TINT: Record<WorkStatus, { bg: string; fg: string }> = {
  open: { bg: '#E8F0FE', fg: '#0B57D0' },
  bezig: { bg: '#FFF3E0', fg: '#7A4B00' },
  wacht_klant: { bg: '#FCE8E6', fg: '#B3261E' },
  wacht_onderdeel: { bg: '#FCE8E6', fg: '#B3261E' },
  klaar: { bg: '#E6F4EA', fg: '#137333' },
  gefactureerd: { bg: '#F1F3F4', fg: '#5F6368' },
  geannuleerd: { bg: '#F1F3F4', fg: '#9AA0A6' },
}

/** One field value as the card prints it: a number with Dutch decimals, a date, or the text. */
function fieldText(v: string | number | undefined): string {
  if (v === undefined) return ''
  if (typeof v === 'number') return v.toLocaleString('nl-NL')
  return v
}

export function StatusPill({ skin, status, t }: { skin: WorkSkin; status: WorkStatus; t: T }) {
  const tint = STATUS_TINT[status]
  return (
    <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: tint.bg, color: tint.fg, whiteSpace: 'nowrap' }}>
      {t(statusKey(skin, status))}
    </span>
  )
}

export function WorkCard({ row, skin, t, onOpen }: { row: WorkRow; skin: WorkSkin; t: T; onOpen?: (id: string) => void }) {
  const onCard = skin.fields.filter((f) => f.onCard && row.fields[f.key] !== undefined)
  const total = row.lines.length > 0 ? linesTotalEx(row.lines) : null
  // [WERK-BEURT] Repeating work says its rhythm, when the next beurt is due, and how many done
  // beurten still wait for an invoice — the three things a cleaner checks on a Monday.
  const next = row.repeat_every ? nextVisitOn(row) : null
  const openVisits = row.repeat_every ? unbilledVisits(row.visits).length : 0
  return (
    <button type="button" onClick={() => onOpen?.(row.id)} data-testid="work-card"
      style={{ width: '100%', textAlign: 'start', background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: '12px 14px', cursor: onOpen ? 'pointer' : 'default', fontFamily: FONT }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {skin.vehicle && row.kenteken ? `${displayKenteken(row.kenteken)} · ` : ''}{row.title}
          </div>
          <div style={{ fontSize: 13, color: M3.onSurfaceVariant, marginTop: 2 }}>
            {row.client_name ?? '—'}
            {row.planned_on ? ` · ${formatDateNL(row.planned_on)}` : ''}
          </div>
          {onCard.length > 0 && (
            <div style={{ fontSize: 12.5, color: M3.onSurfaceVariant, marginTop: 4 }}>
              {onCard.map((f) => `${t(f.labelKey)}: ${fieldText(row.fields[f.key])}`).join(' · ')}
            </div>
          )}
          {row.repeat_every && (
            <div style={{ fontSize: 12.5, color: M3.onSurfaceVariant, marginTop: 4 }} data-testid="work-repeat">
              {t(REPEAT_KEYS[row.repeat_every])}
              {next ? ` · ${t('werk.volgende')}: ${formatDateNL(next)}` : ''}
              {openVisits > 0 ? ` · ${t(skin.visitKeys?.open ?? 'werk.beurtenOpen', { n: openVisits })}` : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <StatusPill skin={skin} status={row.status} t={t} />
          {total !== null && <span style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface }}>{formatEuroNL(total)}</span>}
        </div>
      </div>
    </button>
  )
}

/** The list, grouped in the trade's own status order. Empty says so in the trade's plural. */
export function WorkList({ rows, skin, t, onOpen }: { rows: WorkRow[]; skin: WorkSkin; t: T; onOpen?: (id: string) => void }) {
  if (rows.length === 0) {
    return <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>{t('werk.leeg', { plural: t(skin.pluralKey) })}</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {skin.statuses.map((status) => {
        const group = rows.filter((r) => r.status === status)
        if (group.length === 0) return null
        return (
          <section key={status} aria-label={t(statusKey(skin, status))}>
            <h2 style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: M3.onSurfaceVariant, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {t(statusKey(skin, status))} · {group.length}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.map((r) => <WorkCard key={r.id} row={r} skin={skin} t={t} onOpen={onOpen} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** The statuses an owner can tap, in the trade's order; invoicing is not among them. */
export function StatusChips({ skin, current, t, onPick, disabled }: { skin: WorkSkin; current: WorkStatus; t: T; onPick: (s: WorkStatus) => void; disabled?: boolean }) {
  const choices = skin.statuses.filter((s) => HAND_STATUSES.includes(s))
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label={t('werk.status')}>
      {choices.map((s) => {
        const active = s === current
        const tint = STATUS_TINT[s]
        return (
          <button key={s} type="button" disabled={disabled || active} onClick={() => onPick(s)}
            style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, borderRadius: 999, padding: '8px 14px', border: `1px solid ${active ? tint.fg : M3.outlineVariant}`, background: active ? tint.bg : M3.surface, color: active ? tint.fg : M3.onSurface, cursor: disabled || active ? 'default' : 'pointer' }}>
            {t(statusKey(skin, s))}
          </button>
        )
      })}
    </div>
  )
}

/** A catalogue line the description box can offer: the owner's own articles and the trade's template lines. */
export interface LineSuggestion { description: string; unit_price: number | null; btw_rate: number; unit: string | null }

/**
 * What the work charges. Editable rows; the total is arithmetic on what is typed.
 *
 * The number boxes keep the TEXT the owner types. A controlled input that stores Number("47,")
 * and renders "47" back eats the comma on a phone keyboard, so € 47,50 could never be typed —
 * only pasted. The text lives here per box; the parsed number goes up on every keystroke that
 * parses, and the box is cleaned up on blur.
 */
export function LinesEditor({ skin, lines, t, onChange, disabled, suggestions = [] }: { skin: WorkSkin; lines: WorkLine[]; t: T; onChange: (lines: WorkLine[]) => void; disabled?: boolean; suggestions?: LineSuggestion[] }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const listId = 'work-line-suggestions'
  const update = (i: number, patch: Partial<WorkLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))
  const add = () => {
    const kind = skin.lineKinds[0]
    onChange([...lines, { kind: kind.kind, description: '', quantity: 1, unit: kind.unit, unit_price: 0, btw_rate: kind.btw ?? DEFAULT_LINE_BTW }])
  }
  const typed = (key: string, fallback: number) => drafts[key] ?? formatNumberNL(fallback)
  const type = (key: string, i: number, field: 'quantity' | 'unit_price', text: string) => {
    setDrafts((d) => ({ ...d, [key]: text }))
    const n = Number(text.trim().replace(',', '.'))
    if (text.trim() !== '' && Number.isFinite(n)) update(i, { [field]: n } as Partial<WorkLine>)
  }
  const settle = (key: string) => setDrafts((d) => { const next = { ...d }; delete next[key]; return next })
  const describe = (i: number, text: string) => {
    const hit = suggestions.find((a) => a.description === text)
    if (hit) update(i, { description: text, btw_rate: hit.btw_rate, ...(hit.unit_price !== null ? { unit_price: hit.unit_price } : {}) })
    else update(i, { description: text })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((a) => <option key={a.description} value={a.description} />)}</datalist>
      )}
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, padding: 10, border: `1px solid ${M3.outlineVariant}`, borderRadius: 10 }} data-testid="work-line">
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={l.kind} disabled={disabled} aria-label={t('werk.regels')}
              onChange={(e) => { const k = skin.lineKinds.find((x) => x.kind === e.target.value); if (k) update(i, { kind: k.kind, unit: k.unit, ...(k.btw !== undefined ? { btw_rate: k.btw } : {}) }) }}
              style={selectStyle}>
              {skin.lineKinds.map((k) => <option key={k.kind} value={k.kind}>{t(k.labelKey)}</option>)}
            </select>
            <input value={l.description} disabled={disabled} placeholder={t('werk.regel.omschrijving')} aria-label={t('werk.regel.omschrijving')}
              list={suggestions.length > 0 ? listId : undefined}
              onChange={(e) => describe(i, e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input inputMode="decimal" value={typed(`${i}q`, l.quantity)} disabled={disabled} aria-label={t('werk.regel.aantal')}
              onChange={(e) => type(`${i}q`, i, 'quantity', e.target.value)} onBlur={() => settle(`${i}q`)} style={{ ...inputStyle, width: 72 }} />
            <span style={{ fontFamily: FONT, fontSize: 12.5, color: M3.onSurfaceVariant }}>{l.unit}</span>
            <input inputMode="decimal" value={typed(`${i}p`, l.unit_price)} disabled={disabled} aria-label={t('werk.regel.prijs')}
              onChange={(e) => type(`${i}p`, i, 'unit_price', e.target.value)} onBlur={() => settle(`${i}p`)} style={{ ...inputStyle, width: 96 }} />
            <select value={l.btw_rate} disabled={disabled} aria-label={t('werk.regel.btw')}
              onChange={(e) => update(i, { btw_rate: Number(e.target.value) })} style={{ ...selectStyle, width: 74 }}>
              {[21, 9, 0].map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
            {!disabled && (
              <button type="button" onClick={() => remove(i)} aria-label={t('werk.verwijderen')} style={{ ...ghostButton, marginInlineStart: 'auto' }}>×</button>
            )}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {!disabled && <button type="button" onClick={add} style={ghostButton}>+ {t('werk.regelToevoegen')}</button>}
        <span style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: M3.onSurface, marginInlineStart: 'auto' }}>
          {t('werk.totaal')}: {formatEuroNL(linesTotalEx(lines.filter((l) => Number.isFinite(l.quantity) && Number.isFinite(l.unit_price))))}
        </span>
      </div>
    </div>
  )
}

/** A number the way a Dutch owner types it: comma, no thousands separator, no trailing zeros. */
function formatNumberNL(n: number): string {
  if (!Number.isFinite(n)) return ''
  return String(round2(n)).replace('.', ',')
}

/** Revenue, attached costs, margin — or the costs alone while there is no revenue yet. */
export function MarginLine({ margin, hoursTotal, t, budget, estimate }: { margin: WorkMargin; hoursTotal: number; t: T; budget?: { agreed: number; spent: number; over: boolean } | null; estimate?: { begroot: number; actual: number; over: boolean } | null }) {
  const confidenceKey = margin.confidence === 'werkelijk' ? 'werk.marge.werkelijk' : margin.confidence === 'geschat' ? 'werk.marge.geschat' : 'werk.marge.incompleet'
  return (
    <div style={{ fontFamily: FONT, fontSize: 13.5, color: M3.onSurface, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }} data-testid="work-margin">
      <span>{t('werk.totaal')}: <b>{margin.revenue === null ? '—' : formatEuroNL(margin.revenue)}</b></span>
      <span>{t('werk.kosten')}: <b>{formatEuroNL(margin.costs)}</b></span>
      <span>{t('werk.marge')}: <b>{margin.margin === null ? '—' : `${formatEuroNL(margin.margin)}${margin.share !== null ? ` (${Math.round(margin.share * 100)}%)` : ''}`}</b> <span style={{ color: M3.onSurfaceVariant }}>· {t(confidenceKey)}</span></span>
      {estimate && (
        <span style={{ color: estimate.over ? M3.error : M3.onSurface }} data-testid="work-begroot">{t('werk.begroot', { begroot: formatEuroNL(estimate.begroot), actual: formatEuroNL(estimate.actual) })}</span>
      )}
      {budget
        ? <span style={{ color: budget.over ? M3.error : M3.onSurface }} data-testid="work-budget">{t('werk.budget', { spent: budget.spent.toLocaleString('nl-NL'), agreed: budget.agreed.toLocaleString('nl-NL') })}</span>
        : hoursTotal > 0 && <span>{t('werk.uren')}: <b>{hoursTotal.toLocaleString('nl-NL')}</b></span>}
    </div>
  )
}

/**
 * [WERK-4] Financieel gereed: the list, not just the verdict. Four ticks a piece of work needs
 * before its invoice — a client, something to charge, every hour priced, the right state — and
 * the amount it would come to. The owner reads which one is missing; the button below follows.
 */
export function ReadinessList({ readiness, t }: { readiness: Readiness; t: T }) {
  const label: Record<Readiness['items'][number]['key'], string> = { client: 'werk.gereed.klant', lines: 'werk.gereed.regels', hoursRate: 'werk.gereed.urenTarief', status: 'werk.gereed.status' }
  return (
    <div style={{ fontFamily: FONT, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="work-readiness">
      <p style={{ margin: '0 0 2px', fontWeight: 700, color: readiness.ok ? '#137333' : M3.onSurfaceVariant }}>
        {readiness.ok ? t('werk.gereed.bedrag', { bedrag: formatEuroNL(readiness.amountExBtw) }) : t('werk.gereed.niet')}
      </p>
      {readiness.items.map((i) => (
        <span key={i.key} style={{ color: i.ok ? M3.onSurfaceVariant : M3.error }}>{i.ok ? '✓' : '⚠'} {t(label[i.key])}</span>
      ))}
    </div>
  )
}

/** [WERK-3] The car's earlier visits: what was done, when, and what it cost — one line each. */
export function HistoryList({ history, t, onOpen }: { history: WorkHistory[]; t: T; onOpen?: (id: string) => void }) {
  if (history.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: FONT, fontSize: 13 }} data-testid="work-history">
      {history.map((h) => (
        <button key={h.id} type="button" onClick={() => onOpen?.(h.id)} style={{ ...rowStyle, background: M3.surface, cursor: onOpen ? 'pointer' : 'default', textAlign: 'start', width: '100%' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {h.on ? `${formatDateNL(h.on)} · ` : ''}{h.title}
          </span>
          <span style={{ color: M3.onSurfaceVariant, whiteSpace: 'nowrap' }}>{h.total_ex_btw > 0 ? formatEuroNL(h.total_ex_btw) : ''}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * [WERK-3] Hours written ON the work, on site: day, hours, what, rate. One row, one tap; the
 * entry lands on /dashboard/uren with this work's id, so it is billable from here at once.
 */
export function HoursForm({ t, onSave, disabled, defaultRate }: { t: T; onSave: (entry: { worked_on: string; hours: string; description: string; hourly_rate: string }) => void; disabled?: boolean; defaultRate?: number | null }) {
  const [on, setOn] = useState('')
  const [hours, setHours] = useState('')
  const [what, setWhat] = useState('')
  const [rate, setRate] = useState(defaultRate !== null && defaultRate !== undefined ? formatNumberNL(defaultRate) : '')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="work-hours-form">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <DateFieldNL value={on} onChange={setOn} disabled={disabled} />
        <input inputMode="decimal" value={hours} disabled={disabled} placeholder={t('werk.uren.aantal')} aria-label={t('werk.uren.aantal')} onChange={(e) => setHours(e.target.value)} style={{ ...inputStyle, width: 72 }} />
        <input inputMode="decimal" value={rate} disabled={disabled} placeholder={t('werk.uren.tarief')} aria-label={t('werk.uren.tarief')} onChange={(e) => setRate(e.target.value)} style={{ ...inputStyle, width: 96 }} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={what} disabled={disabled} placeholder={t('werk.uren.omschrijving')} aria-label={t('werk.uren.omschrijving')} onChange={(e) => setWhat(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <button type="button" disabled={disabled || !hours.trim() || !what.trim()} onClick={() => { onSave({ worked_on: on, hours, description: what, hourly_rate: rate }); setHours(''); setWhat('') }} style={{ ...primaryButton, width: 'auto', padding: '10px 14px' }}>{t('werk.uren.opslaan')}</button>
      </div>
    </div>
  )
}

export interface WorkFormValue {
  title: string
  client_name: string
  kenteken: string
  planned_on: string
  fields: Record<string, string>
  /** [WERK-BEURT] '' for work that happens once; a Repeat for work that comes back. */
  repeat_every: string
  notes: string
}

export const EMPTY_FORM: WorkFormValue = { title: '', client_name: '', kenteken: '', planned_on: '', fields: {}, repeat_every: '', notes: '' }

/** The trade's form: the shared three, the plate when the trade opens on one, then the skin's fields. */
export function WorkForm({ skin, value, onChange, t, disabled, editing }: { skin: WorkSkin; value: WorkFormValue; onChange: (v: WorkFormValue) => void; t: T; disabled?: boolean; editing?: boolean }) {
  const set = (patch: Partial<WorkFormValue>) => onChange({ ...value, ...patch })
  const setField = (key: string, v: string) => onChange({ ...value, fields: { ...value.fields, [key]: v } })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {skin.vehicle && !editing && (
        <Field label={`${t('werk.kenteken')}${skin.skin === 'werkorder' ? ' *' : ''}`} value={value.kenteken} onChange={(v) => set({ kenteken: v })} placeholder="12-ABC-3" disabled={disabled} />
      )}
      <Field label={`${t('werk.klant')} *`} value={value.client_name} onChange={(v) => set({ client_name: v })} disabled={disabled} />
      <Field label={`${t('werk.omschrijving')} *`} value={value.title} onChange={(v) => set({ title: v })} disabled={disabled} />
      {skin.fields.map((f) => (
        <Field key={f.key} label={`${t(f.labelKey)}${f.required ? ' *' : ''}`} value={value.fields[f.key] ?? ''} onChange={(v) => setField(f.key, v)}
          inputMode={f.type === 'number' ? 'decimal' : undefined} disabled={disabled} />
      ))}
      <div>
        <label style={labelStyle}>{t('werk.gepland')}</label>
        <DateFieldNL value={value.planned_on} onChange={(iso) => set({ planned_on: iso })} />
      </div>
      {skin.recurring && (
        <div>
          <label style={labelStyle}>{t('werk.herhaal')}</label>
          <select value={value.repeat_every} disabled={disabled} aria-label={t('werk.herhaal')} onChange={(e) => set({ repeat_every: e.target.value })} style={{ ...selectStyle, width: '100%' }}>
            <option value="">{t('werk.herhaal.geen')}</option>
            {REPEATS.map((r) => <option key={r} value={r}>{t(REPEAT_KEYS[r])}</option>)}
          </select>
        </div>
      )}
      <Field label={t('werk.notitie')} value={value.notes} onChange={(v) => set({ notes: v })} disabled={disabled} />
    </div>
  )
}

/** The attached hours and purchases, with a detach per row. */
export function AttachedList({ hours, costs, t, onDetachHours, onDetachCost }: { hours: AttachedHours[]; costs: AttachedCost[]; t: T; onDetachHours?: (id: string) => void; onDetachCost?: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: FONT, fontSize: 13 }}>
      {hours.map((h) => (
        <div key={h.id} style={rowStyle} data-testid="work-hour">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatDateNL(h.worked_on)} · {h.hours.toLocaleString('nl-NL')} {t('werk.uren').toLowerCase()} · {h.description}
          </span>
          {h.invoice_id ? <span style={{ color: M3.onSurfaceVariant }}>{t('werk.status.gefactureerd')}</span>
            : onDetachHours && <button type="button" onClick={() => onDetachHours(h.id)} style={ghostButton}>{t('werk.los')}</button>}
        </div>
      ))}
      {costs.map((c) => (
        <div key={c.id} style={rowStyle} data-testid="work-cost">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.client_name ?? '—'}{c.invoice_number ? ` · ${c.invoice_number}` : ''} · {formatEuroNL(Math.abs(c.total_ex_btw ?? 0))}
          </span>
          {onDetachCost && <button type="button" onClick={() => onDetachCost(c.id)} style={ghostButton}>{t('werk.los')}</button>}
        </div>
      ))}
    </div>
  )
}

/** A pick-list of what could be attached: hours or purchases, each with a checkbox. */
export function CandidateList<Item extends { id: string }>({ items, label, t, chosen, onToggle }: { items: Item[]; label: (i: Item) => string; t: T; chosen: Set<string>; onToggle: (id: string) => void }) {
  if (items.length === 0) return <p style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, margin: 0 }}>{t('werk.geenKandidaten')}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((i) => (
        <label key={i.id} style={{ ...rowStyle, cursor: 'pointer', fontFamily: FONT, fontSize: 13 }}>
          <input type="checkbox" checked={chosen.has(i.id)} onChange={() => onToggle(i.id)} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(i)}</span>
        </label>
      ))}
    </div>
  )
}

/** The bottom sheet every work dialog sits in: takes the back button, stills the page behind. */
export function WorkSheet({ title, onClose, children, testId, error }: { title: string; onClose: () => void; children: ReactNode; testId?: string; error?: string }) {
  // [BACK-CLOSES] [BLAD-ACHTERGROND]
  useCloseOnBack(true, onClose)
  useBodyScrollLock(true)
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}>
      <div onClick={(e) => e.stopPropagation()} data-testid={testId}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 18px', paddingBottom: sheetPaddingBottom(20), width: '100%', maxWidth: 520, fontFamily: FONT, maxHeight: '90vh', overflowY: 'auto' }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 12px' }}>{title}</p>
        {/* A refusal from the server belongs INSIDE the sheet: the page behind it is covered. */}
        {error && <div role="alert" style={{ fontSize: 14, color: M3.error, background: M3.errorContainer, borderRadius: 12, padding: 12, marginBottom: 12 }}>{error}</div>}
        {children}
      </div>
    </div>
  )
}

export function invoiceButtonState(row: Pick<WorkRow, 'status' | 'invoice_id'> & Partial<Pick<WorkRow, 'repeat_every' | 'visits'>>, invoice: WorkInvoiceSummary | null): 'make' | 'view' | 'none' {
  // Repeating work never closes on one invoice: its beurten carry theirs (VisitsPanel links them).
  if (row.repeat_every) return canInvoice(row) ? 'make' : 'none'
  if (invoice || row.invoice_id) return 'view'
  return canInvoice(row) ? 'make' : 'none'
}

/**
 * [WERK-BEURT] The beurten of repeating work: each one done, with its day and whether it is on an
 * invoice yet, and the one tap that ticks today's off. A billed beurt links to its invoice and
 * cannot be removed; an unbilled one can, in case of a slip.
 */
export function VisitsPanel({ visits, t, onVisit, onUnvisit, disabled, invoiceHref, keys }: { visits: Visit[]; t: T; onVisit?: (on: string, note: string) => void; onUnvisit?: (on: string) => void; disabled?: boolean; invoiceHref?: (invoiceId: string) => string; keys?: WorkSkin['visitKeys'] }) {
  const [on, setOn] = useState('')
  const [note, setNote] = useState('')
  const sorted = [...visits].sort((a, b) => b.on.localeCompare(a.on))
  const open = unbilledVisits(visits).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: FONT, fontSize: 13 }} data-testid="work-visits">
      {onVisit && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <DateFieldNL value={on} onChange={setOn} disabled={disabled} />
          <input value={note} disabled={disabled} placeholder={t('werk.beurtNotitie')} aria-label={t('werk.beurtNotitie')} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
          <button type="button" disabled={disabled} onClick={() => { onVisit(on, note); setOn(''); setNote('') }} style={{ ...primaryButton, width: 'auto', padding: '10px 14px' }}>{t(keys?.done ?? 'werk.beurtGedaan')}</button>
        </div>
      )}
      {sorted.length === 0 && <p style={{ color: M3.onSurfaceVariant, margin: 0 }}>{t('werk.geenBeurten')}</p>}
      {sorted.map((v, i) => (
        <div key={`${v.on}-${i}`} style={rowStyle} data-testid="work-visit">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatDateNL(v.on)}{v.note ? ` · ${v.note}` : ''}
          </span>
          {v.invoice_id
            ? (invoiceHref
              ? <a href={invoiceHref(v.invoice_id)} style={{ color: M3.primary, fontWeight: 600, textDecoration: 'none' }}>{t('werk.status.gefactureerd')}</a>
              : <span style={{ color: M3.onSurfaceVariant }}>{t('werk.status.gefactureerd')}</span>)
            : onUnvisit && <button type="button" onClick={() => onUnvisit(v.on)} disabled={disabled} aria-label={t('werk.verwijderen')} style={ghostButton}>×</button>}
        </div>
      ))}
      {open > 0 && <p style={{ margin: '4px 0 0', color: M3.onSurface, fontWeight: 600 }}>{t(keys?.open ?? 'werk.beurtenOpen', { n: open })}</p>}
    </div>
  )
}

/** The files attached to a piece of work: the bon photographed at the parts counter, the delivery photo. */
export function DocumentsList({ documents, t, onDetach }: { documents: AttachedDocument[]; t: T; onDetach?: (id: string) => void }) {
  if (documents.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: FONT, fontSize: 13 }}>
      {documents.map((d) => (
        <div key={d.id} style={rowStyle} data-testid="work-document">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name ?? '—'}</span>
          {onDetach && <button type="button" onClick={() => onDetach(d.id)} style={ghostButton}>{t('werk.los')}</button>}
        </div>
      ))}
    </div>
  )
}

/**
 * [WERK-VERZAMEL] The offer, above the list: for every client with two or more finished pieces of
 * work that have no invoice yet, one button that puts them on one verzamelfactuur. Nothing is
 * offered for a client with one — that is the ordinary "Maak factuur" on the work itself.
 */
export function TogetherOffer({ rows, t, onTogether, disabled }: { rows: WorkRow[]; t: T; onTogether?: (ids: string[], clientName: string) => void; disabled?: boolean }) {
  const groups = togetherGroups(rows)
  if (groups.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="work-together">
      {groups.map((g) => (
        <button key={g.client_name} type="button" disabled={disabled} onClick={() => onTogether?.(g.rows.map((r) => r.id), g.client_name)}
          style={{ ...ghostButton, padding: '10px 14px', textAlign: 'start' }}>
          {t('werk.verzamelKnop', { client: g.client_name, n: g.rows.length })}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, value, onChange, placeholder, inputMode, disabled }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'decimal'; disabled?: boolean }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} inputMode={inputMode} disabled={disabled} style={inputStyle} />
    </div>
  )
}

const labelStyle = { display: 'block', fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 5 } as const
const inputStyle = { width: '100%', fontFamily: FONT, fontSize: 15, padding: '10px 12px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface, boxSizing: 'border-box' as const }
const selectStyle = { fontFamily: FONT, fontSize: 14, padding: '9px 8px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.onSurface }
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${M3.outlineVariant}`, borderRadius: 10 } as const
export const primaryButton = { width: '100%', fontFamily: FONT, fontSize: 15, fontWeight: 600, borderRadius: 12, padding: '14px 8px', border: 'none', background: M3.primary, color: '#fff', cursor: 'pointer' } as const
export const ghostButton = { fontFamily: FONT, fontSize: 13, fontWeight: 600, borderRadius: 999, padding: '6px 12px', border: `1px solid ${M3.outlineVariant}`, background: M3.surface, color: M3.primary, cursor: 'pointer' } as const
export type { FieldValues }
