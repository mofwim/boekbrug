'use client'

// src/components/intake/PageTray.tsx
// [PAGINA-VOLGORDE] The pages of ONE paper invoice, in the order they will be bound.
//
// Two screens collect these pages — /dashboard/incoming and /dashboard/upload — and both used to
// render their own tray. Both trays showed the same thing: a filename and a cross. `IMG_4821.jpg`
// tells the owner nothing about which page it is, and there was no way to move a page, so the
// order the browser happened to hand over became the order of a document kept for seven years.
//
// One tray for both, so the control exists once. What it adds over the two it replaces:
//
//   · a THUMBNAIL, because that is the only thing that lets an owner recognise a page at all;
//   · ↑ and ↓, because the order has to be correctable, not merely visible. Buttons rather than
//     drag-and-drop: drag is unreliable on touch, invisible to a screen reader, and would put a
//     library between the owner and the order of a legal document;
//   · a sentence when the app itself rearranged the pages ([PAGINA-VOLGORDE] rule 2 in
//     page-order.ts) — a rearrangement nobody was told about is indistinguishable from a bug.
//
// The component holds no language of its own: every word comes from the catalogue.

import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [PAGINA-VOLGORDE] The tray's state — pages, previews and what the last add did — is owned by
// usePageTray, so both screens behave identically and this component only draws.
import type { TrayNotice, TrayPage } from '@/lib/use-page-tray'

const FONT = "'Roboto', -apple-system, sans-serif"


export default function PageTray({
  pages,
  notice,
  accent,
  disabled = false,
  onMove,
  onRemove,
}: {
  pages: TrayPage[]
  notice: TrayNotice | null
  /** The surface's own colour — iOS blue on Inkomend, Material blue on Uploaden. */
  accent: string
  disabled?: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (index: number) => void
}) {
  const t = translator(useLocale())

  if (pages.length === 0) return null

  const step = (index: number, direction: -1 | 1) => {
    if (disabled) return
    onMove(index, direction)
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>
        {t('mp.volgorde.titel')}
      </div>
      <div style={{ fontSize: 12, color: '#5f6368', marginBottom: 8, lineHeight: 1.4 }}>
        {t('mp.volgorde.uitleg')}
      </div>

      {/* What the last add did. Assertive, because it reports a change the owner did not make. */}
      {notice?.sorted && (
        <div role="status" style={{ fontSize: 12, color: '#8a5a00', background: '#fff8e1', border: '1px solid #ffe0a3', borderRadius: 10, padding: '7px 10px', marginBottom: 8, lineHeight: 1.4 }}>
          {t('mp.volgorde.gesorteerd')}
        </div>
      )}
      {!!notice?.duplicates && (
        <div role="status" style={{ fontSize: 12, color: '#5f6368', marginBottom: 8, lineHeight: 1.4 }}>
          {notice.duplicates === 1 ? t('mp.dubbelEen') : t('mp.dubbelMeer', { n: notice.duplicates })}
        </div>
      )}
      {/* [GEEN-STILLE-KAP] Pages that did not fit are NAMED. Silently short a document is how the
          shortage is found by whoever reads it a year later. */}
      {!!notice?.overflow && (
        <div role="status" style={{ fontSize: 12, color: '#b3261e', marginBottom: 8, lineHeight: 1.4 }}>
          {notice.overflow === 1
            ? t('mp.overflowEen', { max: notice.max })
            : t('mp.overflowMeer', { n: notice.overflow, max: notice.max })}
        </div>
      )}

      <ol style={{ display: 'flex', flexDirection: 'column', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
        {pages.map(({ file, preview }, i) => (
          <li
            key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', background: '#fff', borderRadius: 10, border: '1px solid #e5e5ea' }}
          >
            {preview
              // eslint-disable-next-line @next/next/no-img-element -- a blob: preview of a file the
              // owner just picked; next/image cannot take an objectURL and would not optimise it.
              ? <img src={preview} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 7, border: '1px solid #e5e5ea', flexShrink: 0, background: '#f1f3f4' }} />
              : <span style={{ width: 38, height: 38, borderRadius: 7, background: '#f1f3f4', flexShrink: 0 }} />}
            <span style={{ fontSize: 12, fontWeight: 700, color: accent, flexShrink: 0 }}>
              {t('mp.pagina.nr', { n: i + 1 })}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#5f6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.name}
            </span>
            <button
              type="button" onClick={() => step(i, -1)}
              disabled={disabled || i === 0}
              aria-label={t('mp.pagina.omhoog', { n: i + 1 })}
              style={{ border: 'none', background: 'transparent', color: i === 0 ? '#c7c7cc' : '#5f6368', fontSize: 16, lineHeight: 1, padding: '2px 4px', cursor: disabled || i === 0 ? 'default' : 'pointer', fontFamily: FONT }}
            >↑</button>
            <button
              type="button" onClick={() => step(i, 1)}
              disabled={disabled || i === pages.length - 1}
              aria-label={t('mp.pagina.omlaag', { n: i + 1 })}
              style={{ border: 'none', background: 'transparent', color: i === pages.length - 1 ? '#c7c7cc' : '#5f6368', fontSize: 16, lineHeight: 1, padding: '2px 4px', cursor: disabled || i === pages.length - 1 ? 'default' : 'pointer', fontFamily: FONT }}
            >↓</button>
            <button
              type="button" onClick={() => !disabled && onRemove(i)}
              disabled={disabled}
              aria-label={t('mp.pagina.verwijderen', { n: i + 1 })}
              style={{ border: 'none', background: 'transparent', color: '#70757a', fontSize: 18, lineHeight: 1, padding: '2px 4px', cursor: disabled ? 'default' : 'pointer', fontFamily: FONT }}
            >×</button>
          </li>
        ))}
      </ol>
    </div>
  )
}
