'use client'

// src/components/invoice/DoublePayNotice.tsx
// [DUBBEL-BEWIJS] What the no-double-pay check did, under the button that spends the money.
//
// The check had two visible states — a warning, or nothing — and "nothing" was doing two jobs at
// once: "we searched and you have not paid this before", and "we could not search". Five separate
// paths produced the second while looking exactly like the first. See double-pay-check.ts for the
// list and for why the two that need no database (no amount, no vendor) are the sharpest of them.
//
// This renders the third state, and gives the other two the search behind them. It never blocks:
// the buttons around it are untouched, and an owner who knows the check could not run is better
// placed to decide than one who was shown a blank space (SAFECORE ⑤ — warn, don't block).
//
// The component holds no language and no direction of its own: both travel on the notice object
// built by double-pay-check.ts. It holds the COLOUR, because a colour is not language — but it
// takes the tone from the object rather than deciding from the words.

import type React from 'react'

import { M3 } from '@/lib/design/tokens'
import type { DoublePayNotice as Notice } from '@/lib/double-pay-check'

/** One colour per tone. 'unknown' is deliberately not the alarm colour — see below. */
const TONE_COLOR: Record<Notice['tone'], string> = {
  // A twin was found. The dialog around this is already the warning; this line only qualifies it.
  alarm: M3.warning,
  clear: M3.neutral,
  // "We could not look" is not an error the owner caused and not a duplicate we found. Painting it
  // red would put the same weight on a database hiccup as on a real second payment, and an owner
  // who learns to dismiss red learns to dismiss both.
  unknown: M3.warning,
}

export default function DoublePayNotice({ notice }: { notice: Notice | null | undefined }) {
  if (!notice) return null
  const color = TONE_COLOR[notice.tone]
  const base: React.CSSProperties = {
    display: 'block', whiteSpace: 'normal', lineHeight: 1.45, fontSize: 12,
    textAlign: 'start', color: M3.neutral,
  }
  return (
    <div
      dir={notice.dir}
      style={{
        marginTop: 10, padding: '8px 12px', borderRadius: 10,
        background: notice.tone === 'clear' ? '#F8F9FA' : '#FFF8E1',
        // Physical sides are wrong in exactly one language, which is the one nobody checks.
        borderInlineStart: `3px solid ${color}`,
      }}
    >
      <span style={{ ...base, color: notice.tone === 'clear' ? M3.neutral : '#202124', fontWeight: notice.tone === 'clear' ? 400 : 600 }}>
        {notice.lead}
      </span>
      {notice.detail.map((line, i) => (
        <span key={i} style={{ ...base, marginTop: 3 }}>{line}</span>
      ))}
    </div>
  )
}
