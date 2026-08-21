'use client'

// src/app/dashboard/voertuigen/VoertuigenPanels.tsx
// [VOERTUIG] The presentational half. Takes its rows as PROPS, holds no state and no language of
// its own — copy arrives through the translator it is handed (see [TAAL] in AGENTS.md).
//
// Split out for the render gate: a screen whose data arrives through its own useEffect renders
// empty under renderToStaticMarkup and proves nothing, because `[].map(cb)` never calls `cb`.

import type { CSSProperties } from 'react'
import { M3 } from '@/lib/design/tokens'
import type { Translator } from '@/lib/i18n/t'
import { displayKenteken, apkStatus, type ApkStatus } from '@/lib/vehicle'

const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', monospace"

export interface VehicleRow {
  id: string
  kenteken: string
  description: string | null
  customer_name: string | null
  customer_phone: string | null
  apk_expiry: string | null
  notes: string | null
}

// [TAAL] One key per state, never one sentence with the state substituted in — a noun inside a
// sentence is not a parameter.
const STATUS_KEY = {
  expired: 'vtg.status.expired',
  due: 'vtg.status.due',
  soon: 'vtg.status.soon',
  ok: 'vtg.status.ok',
  unknown: 'vtg.status.unknown',
} as const

// The colour carries the same information as the words, for a mechanic scanning the list at arm's
// length. `unknown` is neutral rather than green: it is not reassurance, it is a missing fact.
const STATUS_COLOR: Record<ApkStatus, string> = {
  expired: M3.error,
  due: M3.warning,
  soon: M3.onSurfaceVariant,
  ok: M3.success,
  unknown: M3.onSurfaceVariant,
}

/** The plate, printed the way it is on the car. */
export function Plate({ kenteken }: { kenteken: string }) {
  return (
    <span
      style={{
        fontFamily: FONT_NUM, fontSize: 15, fontWeight: 700, letterSpacing: '.04em',
        background: '#FFCC00', color: '#111', borderRadius: 6, padding: '4px 8px',
        border: '1px solid #C9A200', whiteSpace: 'nowrap',
      }}
    >
      {displayKenteken(kenteken)}
    </span>
  )
}

/** One car, with where its APK stands. */
export function VehicleCard({
  vehicle, today, onRemove, t,
}: {
  vehicle: VehicleRow
  today: string
  onRemove: (id: string) => void
  t: Translator
}) {
  const status = apkStatus(vehicle.apk_expiry, today)
  return (
    <li style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Plate kenteken={vehicle.kenteken} />
        {vehicle.description && (
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: M3.onSurface }}>
            {vehicle.description}
          </span>
        )}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 13, color: STATUS_COLOR[status], fontWeight: 600 }}>
        {t(STATUS_KEY[status])}
        {vehicle.apk_expiry && <span style={{ fontFamily: FONT_NUM, fontWeight: 400 }}> · {vehicle.apk_expiry}</span>}
      </div>
      {(vehicle.customer_name || vehicle.customer_phone) && (
        <div style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant }}>
          {vehicle.customer_name}
          {/* A tappable number, because the whole point of the reminder is the call it leads to. */}
          {vehicle.customer_phone && (
            <>
              {vehicle.customer_name ? ' · ' : ''}
              <a href={`tel:${vehicle.customer_phone}`} style={{ color: M3.primary }}>
                {vehicle.customer_phone}
              </a>
            </>
          )}
        </div>
      )}
      {vehicle.notes && (
        <div style={{ fontFamily: FONT, fontSize: 13, color: M3.onSurfaceVariant }}>{vehicle.notes}</div>
      )}
      <button
        type="button"
        onClick={() => onRemove(vehicle.id)}
        style={{
          alignSelf: 'start', marginTop: 2, background: 'none', border: 'none', padding: 0,
          fontFamily: FONT, fontSize: 13, color: M3.error, cursor: 'pointer',
        }}
      >
        {t('vtg.verwijderen')}
      </button>
    </li>
  )
}

/** The whole fleet, already ordered by the server (overdue first — see sortByApkUrgency). */
export function VehicleList({
  vehicles, today, onRemove, t,
}: {
  vehicles: VehicleRow[]
  today: string
  onRemove: (id: string) => void
  t: Translator
}) {
  if (vehicles.length === 0) {
    return (
      <p style={{ fontFamily: FONT, fontSize: 14, color: M3.onSurfaceVariant, margin: 0 }}>
        {t('vtg.leeg')}
      </p>
    )
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {vehicles.map((v) => (
        <VehicleCard key={v.id} vehicle={v} today={today} onRemove={onRemove} t={t} />
      ))}
    </ul>
  )
}

/**
 * The cars worth calling about today. This is the reason to open the app in the morning — the one
 * thing every garage system in this market sells, and the only one a shop gets for free, because
 * the APK is a dated legal appointment that is known months ahead.
 *
 * Renders nothing at all when there is nothing to call about: an empty "you have 0 reminders" panel
 * trains an owner to stop reading the place his reminders appear.
 */
export function ApkCallList({
  vehicles, t,
}: {
  vehicles: VehicleRow[]
  t: Translator
}) {
  if (vehicles.length === 0) return null
  return (
    <section style={{ ...card, background: M3.warningContainer, borderColor: 'transparent' }}>
      <h2 style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, margin: '0 0 8px', color: M3.warning }}>
        {t('vtg.bellen')}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vehicles.map((v) => (
          <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Plate kenteken={v.kenteken} />
            <span style={{ fontFamily: FONT, fontSize: 13, color: M3.warning }}>
              {v.customer_name ?? v.description ?? ''}
            </span>
            {v.customer_phone && (
              <a href={`tel:${v.customer_phone}`} style={{ fontFamily: FONT, fontSize: 13, color: M3.primary }}>
                {v.customer_phone}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

const card: CSSProperties = {
  background: M3.surface,
  border: `1px solid ${M3.outlineVariant}`,
  borderRadius: 16,
  padding: 14,
}
