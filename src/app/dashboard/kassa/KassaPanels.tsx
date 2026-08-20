'use client'

// src/app/dashboard/kassa/KassaPanels.tsx
// [KASSA] The presentational half of the counter. Every component here takes its rows as PROPS and
// holds no state, no fetching and no language of its own — copy arrives through the translator it
// is handed (see the [TAAL] note in AGENTS.md: one hard-coded string in a component is how a
// translation stays permanently half-finished, because the screen still looks right in Dutch).
//
// Split out from KassaClient for the render gate. tests/render only catches a crashing branch if it
// can hand the component ROWS that reach that branch — `[].map(cb)` never calls `cb`, so a screen
// whose data arrives through its own useEffect renders empty and proves nothing. These take the
// rows directly, so the gate can exercise a real ticket, a real day and a real sales history.
//
// Physical sides are never used here (`paddingInlineStart`, `textAlign: 'end'`): they are wrong in
// exactly one language, which is the one nobody checks. Direction itself travels on <html>, set by
// use-locale.ts.

import type { CSSProperties } from 'react'
import { M3 } from '@/lib/design/tokens'
import type { Translator } from '@/lib/i18n/t'
import { saleGross, type TillMethod } from '@/lib/till-day'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** One line on the ticket being built. `key` is local to the screen — nothing is stored yet. */
export interface TicketLine {
  key: string
  description: string
  quantity: number
  unit_price_incl: number
  btw_rate: number
  article_id: string | null
}

/** One stored sale, as /api/till/sale returns it. */
export interface StoredSale {
  id: string
  ticket_id: string
  description: string
  quantity: number
  unit_price_incl: number
  btw_rate: number
  method: TillMethod
}

export interface DayTotals {
  total: number
  pin: number
  cash: number
  other: number
}

/** A price-list entry as the counter shows it: the GROSS price, which is what the customer pays. */
export interface PriceListItem {
  id: string
  description: string
  gross: number
  btw_rate: number
}

// [TAAL] One key per payment method, never one sentence with the method substituted in — a noun
// inside a sentence is not a parameter (AGENTS.md).
const METHOD_LABEL = {
  pin: 'kassa.betaaldPin',
  cash: 'kassa.betaaldContant',
  other: 'kassa.betaaldOverig',
} as const

const card: CSSProperties = {
  background: M3.surface,
  border: `1px solid ${M3.outlineVariant}`,
  borderRadius: 16,
  padding: 16,
}

/** The day's takings so far, and how they were paid. The one number the owner glances at. */
export function DayTakings({ totals, t }: { totals: DayTotals; t: Translator }) {
  return (
    <section style={{ ...card, background: M3.primary, border: 'none', color: '#fff' }}>
      <div style={{ fontFamily: FONT, fontSize: 13, opacity: 0.9 }}>{t('kassa.dagtotaal')}</div>
      <div style={{ fontFamily: FONT_NUM, fontSize: 34, fontWeight: 700, marginTop: 4 }}>
        {eur.format(totals.total)}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', fontFamily: FONT, fontSize: 13 }}>
        <span>{t('kassa.splitPin')} {eur.format(totals.pin)}</span>
        <span>{t('kassa.splitContant')} {eur.format(totals.cash)}</span>
        <span>{t('kassa.splitOverig')} {eur.format(totals.other)}</span>
      </div>
    </section>
  )
}

/** The price list as buttons. One tap puts a service on the ticket — the whole point of the screen. */
export function PriceList({
  items, onPick, t,
}: {
  items: PriceListItem[]
  onPick: (item: PriceListItem) => void
  t: Translator
}) {
  return (
    <section style={card}>
      <h2 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: M3.onSurface }}>
        {t('kassa.prijslijst')}
      </h2>
      {items.length === 0 ? (
        <div>
          <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: '0 0 12px' }}>
            {t('kassa.prijslijstLeeg')}
          </p>
          <a
            href="/dashboard/artikelen"
            style={{ fontFamily: FONT, fontSize: 14, color: M3.primary, fontWeight: 600 }}
          >
            {t('kassa.prijslijstBeheren')}
          </a>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item)}
              style={{
                fontFamily: FONT,
                textAlign: 'start',
                padding: '12px 14px',
                borderRadius: 12,
                border: `1px solid ${M3.outlineVariant}`,
                background: M3.surfaceVariant,
                color: M3.onSurface,
                cursor: 'pointer',
                minHeight: 64,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{item.description}</div>
              <div style={{ fontFamily: FONT_NUM, fontSize: 15, marginTop: 4 }}>{eur.format(item.gross)}</div>
              <div style={{ fontSize: 11, color: M3.onSurfaceVariant, marginTop: 2 }}>{item.btw_rate}% btw</div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** The ticket being built, its total, and the three ways it can be tendered. */
export function TicketPanel({
  lines, onQuantity, onRemove, onTender, busy, t,
}: {
  lines: TicketLine[]
  onQuantity: (key: string, delta: number) => void
  onRemove: (key: string) => void
  onTender: (method: TillMethod) => void
  busy: boolean
  t: Translator
}) {
  const total = lines.reduce((sum, l) => sum + saleGross(l), 0)

  return (
    <section style={card}>
      <h2 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: M3.onSurface }}>
        {t('kassa.bon')}
      </h2>

      {lines.length === 0 ? (
        <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>
          {t('kassa.bonLeeg')}
        </p>
      ) : (
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map((line) => (
              <li
                key={line.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 0', borderBottom: `1px solid ${M3.outlineVariant}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurface }}>{line.description}</div>
                  <div style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant }}>
                    {line.quantity} &times; {eur.format(line.unit_price_incl)} &middot; {line.btw_rate}% btw
                  </div>
                </div>
                <button
                  type="button" onClick={() => onQuantity(line.key, -1)} aria-label={t('kassa.minder')}
                  style={qtyButton}
                >
                  &minus;
                </button>
                <span style={{ fontFamily: FONT_NUM, fontSize: 14, minWidth: 24, textAlign: 'center' }}>
                  {line.quantity}
                </span>
                <button
                  type="button" onClick={() => onQuantity(line.key, 1)} aria-label={t('kassa.meer')}
                  style={qtyButton}
                >
                  +
                </button>
                <span style={{ fontFamily: FONT_NUM, fontSize: 14, minWidth: 72, textAlign: 'end' }}>
                  {eur.format(saleGross(line))}
                </span>
                <button
                  type="button" onClick={() => onRemove(line.key)} aria-label={t('kassa.regelWeg')}
                  style={{ ...qtyButton, color: M3.error, borderColor: M3.errorContainer }}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 }}>
            <span style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant }}>{t('kassa.totaal')}</span>
            <span style={{ fontFamily: FONT_NUM, fontSize: 24, fontWeight: 700, color: M3.onSurface }}>
              {eur.format(total)}
            </span>
          </div>

          <div style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant, margin: '16px 0 8px' }}>
            {t('kassa.hoeBetaald')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => onTender('pin')} style={tenderButton(M3.primary)}>
              {busy ? t('kassa.bezig') : t('kassa.pin')}
            </button>
            <button type="button" disabled={busy} onClick={() => onTender('cash')} style={tenderButton(M3.success)}>
              {busy ? t('kassa.bezig') : t('kassa.contant')}
            </button>
            <button type="button" disabled={busy} onClick={() => onTender('other')} style={tenderButton('#5F6368')}>
              {busy ? t('kassa.bezig') : t('kassa.overig')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * What was rung up today, newest first, grouped into the tickets they were sold as.
 *
 * Grouped rather than listed line by line because a ticket is what the owner remembers ("the man
 * who had a cut and a beard"), and because voiding one is all-or-nothing: a ticket is the
 * transaction, so half of one is not a thing that can be taken back.
 */
export function SalesHistory({
  sales, onVoid, t,
}: {
  sales: StoredSale[]
  onVoid: (ticketId: string) => void
  t: Translator
}) {
  // Preserve arrival order (the API hands them over newest first) while collecting each ticket's
  // lines — a Map keeps insertion order, so no re-sort can disagree with what the server sent.
  const tickets = new Map<string, StoredSale[]>()
  for (const sale of sales) {
    const existing = tickets.get(sale.ticket_id)
    if (existing) existing.push(sale)
    else tickets.set(sale.ticket_id, [sale])
  }

  return (
    <section style={card}>
      <h2 style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: M3.onSurface }}>
        {t('kassa.verkopenVandaag')}
      </h2>
      {tickets.size === 0 ? (
        <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>
          {t('kassa.geenVerkopen')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {[...tickets.entries()].map(([ticketId, lines]) => {
            const total = lines.reduce((sum, l) => sum + saleGross(l), 0)
            // A ticket is tendered as a whole, so its method is the method of its lines.
            const method = lines[0]?.method ?? 'other'
            return (
              <li
                key={ticketId}
                style={{ padding: '10px 0', borderBottom: `1px solid ${M3.outlineVariant}` }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurface }}>
                      {lines.map((l) => `${l.quantity} × ${l.description}`).join(' · ')}
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: 12, color: M3.onSurfaceVariant }}>
                      {t(METHOD_LABEL[method])}
                    </div>
                  </div>
                  <span style={{ fontFamily: FONT_NUM, fontSize: 15, color: M3.onSurface }}>
                    {eur.format(total)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onVoid(ticketId)}
                  style={{
                    marginTop: 6, background: 'none', border: 'none', padding: 0,
                    fontFamily: FONT, fontSize: 13, color: M3.error, cursor: 'pointer',
                  }}
                >
                  {t('kassa.terugdraaien')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const qtyButton: CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  border: `1px solid ${M3.outlineVariant}`, background: M3.surface,
  color: M3.onSurface, fontSize: 18, lineHeight: 1, cursor: 'pointer', flexShrink: 0,
}

function tenderButton(background: string): CSSProperties {
  return {
    fontFamily: FONT, fontSize: 15, fontWeight: 600, color: '#fff',
    background, border: 'none', borderRadius: 12, padding: '14px 8px', cursor: 'pointer',
    minHeight: 52,
  }
}
