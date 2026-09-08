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
import { displayKenteken } from '@/lib/vehicle'
import DateFieldNL from '@/components/ui/DateFieldNL'
import {
  HAND_STATUSES, statusKey, linesTotalEx, canInvoice, DEFAULT_LINE_BTW,
  type WorkSkin, type WorkStatus, type WorkLine, type FieldValues,
} from '@/lib/werk'
import type { WorkRow, AttachedHours, AttachedCost, WorkInvoiceSummary } from '@/lib/werk-rows'
import type { WorkMargin } from '@/lib/werk'

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

/** What the work charges. Editable rows; the total is arithmetic on what is typed. */
export function LinesEditor({ skin, lines, t, onChange, disabled }: { skin: WorkSkin; lines: WorkLine[]; t: T; onChange: (lines: WorkLine[]) => void; disabled?: boolean }) {
  const update = (i: number, patch: Partial<WorkLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i))
  const add = () => {
    const kind = skin.lineKinds[0]
    onChange([...lines, { kind: kind.kind, description: '', quantity: 1, unit: kind.unit, unit_price: 0, btw_rate: DEFAULT_LINE_BTW }])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, padding: 10, border: `1px solid ${M3.outlineVariant}`, borderRadius: 10 }} data-testid="work-line">
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={l.kind} disabled={disabled} aria-label={t('werk.regels')}
              onChange={(e) => { const k = skin.lineKinds.find((x) => x.kind === e.target.value); if (k) update(i, { kind: k.kind, unit: k.unit }) }}
              style={selectStyle}>
              {skin.lineKinds.map((k) => <option key={k.kind} value={k.kind}>{t(k.labelKey)}</option>)}
            </select>
            <input value={l.description} disabled={disabled} placeholder={t('werk.regel.omschrijving')} aria-label={t('werk.regel.omschrijving')}
              onChange={(e) => update(i, { description: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input inputMode="decimal" value={String(l.quantity)} disabled={disabled} aria-label={t('werk.regel.aantal')}
              onChange={(e) => update(i, { quantity: Number(e.target.value.replace(',', '.')) })} style={{ ...inputStyle, width: 72 }} />
            <span style={{ fontFamily: FONT, fontSize: 12.5, color: M3.onSurfaceVariant }}>{l.unit}</span>
            <input inputMode="decimal" value={String(l.unit_price)} disabled={disabled} aria-label={t('werk.regel.prijs')}
              onChange={(e) => update(i, { unit_price: Number(e.target.value.replace(',', '.')) })} style={{ ...inputStyle, width: 96 }} />
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

/** Revenue, attached costs, margin — or the costs alone while there is no revenue yet. */
export function MarginLine({ margin, hoursTotal, t }: { margin: WorkMargin; hoursTotal: number; t: T }) {
  return (
    <div style={{ fontFamily: FONT, fontSize: 13.5, color: M3.onSurface, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }} data-testid="work-margin">
      <span>{t('werk.totaal')}: <b>{margin.revenue === null ? '—' : formatEuroNL(margin.revenue)}</b></span>
      <span>{t('werk.kosten')}: <b>{formatEuroNL(margin.costs)}</b></span>
      <span>{t('werk.marge')}: <b>{margin.margin === null ? '—' : `${formatEuroNL(margin.margin)}${margin.share !== null ? ` (${Math.round(margin.share * 100)}%)` : ''}`}</b></span>
      {hoursTotal > 0 && <span>{t('werk.uren')}: <b>{hoursTotal.toLocaleString('nl-NL')}</b></span>}
    </div>
  )
}

export interface WorkFormValue {
  title: string
  client_name: string
  kenteken: string
  planned_on: string
  fields: Record<string, string>
  notes: string
}

export const EMPTY_FORM: WorkFormValue = { title: '', client_name: '', kenteken: '', planned_on: '', fields: {}, notes: '' }

/** The trade's form: the shared three, the plate when the trade opens on one, then the skin's fields. */
export function WorkForm({ skin, value, onChange, t, disabled }: { skin: WorkSkin; value: WorkFormValue; onChange: (v: WorkFormValue) => void; t: T; disabled?: boolean }) {
  const set = (patch: Partial<WorkFormValue>) => onChange({ ...value, ...patch })
  const setField = (key: string, v: string) => onChange({ ...value, fields: { ...value.fields, [key]: v } })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {skin.vehicle && (
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
export function WorkSheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  // [BACK-CLOSES] [BLAD-ACHTERGROND]
  useCloseOnBack(true, onClose)
  useBodyScrollLock(true)
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 3000 }}>
      <div onClick={(e) => e.stopPropagation()} data-testid={testId}
        style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 18px', paddingBottom: sheetPaddingBottom(20), width: '100%', maxWidth: 520, fontFamily: FONT, maxHeight: '90vh', overflowY: 'auto' }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 12px' }}>{title}</p>
        {children}
      </div>
    </div>
  )
}

export function invoiceButtonState(row: Pick<WorkRow, 'status' | 'invoice_id'>, invoice: WorkInvoiceSummary | null): 'make' | 'view' | 'none' {
  if (invoice || row.invoice_id) return 'view'
  return canInvoice(row) ? 'make' : 'none'
}

export function useLocalLines(initial: WorkLine[]) {
  return useState<WorkLine[]>(initial)
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
