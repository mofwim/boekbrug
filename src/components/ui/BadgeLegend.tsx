'use client'

// src/components/ui/BadgeLegend.tsx
// [AUTO-UITLEG] What a badge the app awarded on its own judgement means — said on screen, once.
//
// "Automatisch", "Bon · al afgerekend", "Cijfers van de leverancier": each of those is the app
// saying it decided something by itself — booked an invoice, marked a receipt paid, declared a row
// beyond checking. Each was explained in a title attribute, which a phone never shows and a desktop
// shows only to someone who already knows to hover. The owner asked for the sentence above the
// list, and this is that sentence, for every such badge, only while a row carrying it is on screen:
// a legend for a badge nobody sees is noise, and one that is missing for a badge in view is a claim
// left unexplained.
//
// It holds no language. The screen hands in each badge's label AS WRITTEN ON THE BADGE (the same
// catalogue key the badge uses, so the two cannot drift apart in any language) and the explanation,
// in the owner's words.

import { M3, FONT } from '@/lib/design/tokens'

export interface LegendItem {
  id: string
  /** Material Symbols name of the badge's own glyph, so the line is recognisable at a glance. */
  icon: string
  /** The badge's label, exactly as the badge prints it. */
  badge: string
  /** What it means — in the owner's language, from the catalogue. */
  text: string
}

export function BadgeLegend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null
  return (
    <ul
      style={{
        listStyle: 'none', margin: '0 0 8px', padding: '8px 10px',
        background: '#E8F0FE', borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 6,
        fontSize: 12.5, lineHeight: 1.45, color: '#174EA6', fontFamily: FONT, textAlign: 'start',
      }}
    >
      {items.map((it) => (
        <li key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1, color: M3.primary }} aria-hidden>{it.icon}</span>
          <span>
            <strong>{it.badge}</strong> — {it.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
