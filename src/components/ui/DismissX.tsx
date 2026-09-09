'use client'

// src/components/ui/DismissX.tsx
// [MELDING-WEG] The one way to take a finished notice off the screen.
//
// "Dit bestand staat al in: 2026 / Q3 / juli / Facturen" is a notice whose work is done the moment
// it is read. The upload hub kept it on screen with one exit — "Lijst opruimen", which takes every
// row with it — and the owner asked the obvious question: where is the X? The same question stood
// on the Inkomend results modal (rows, one green close for all of them) and on the bank upload's
// report card (no exit at all). This is the X, once, so that every finished notice in the app is
// taken away the same way and a new notice list cannot forget to offer it.
//
// It holds no language: the label is handed in by the screen, from the catalogue. It is a
// 40px target — the row it sits in is 46px tall, and a finger needs the room.

import type { CSSProperties } from 'react'
import { M3 } from '@/lib/design/tokens'

export function DismissX({ label, onClick, style }: { label: string; onClick: () => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pressable"
      style={{
        flexShrink: 0,
        width: 40,
        height: 40,
        padding: 0,
        borderRadius: 999,
        border: 'none',
        background: 'transparent',
        color: M3.onSurfaceVariant,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>close</span>
    </button>
  )
}
