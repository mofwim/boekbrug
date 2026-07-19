'use client'

// [SHABSHAB] On-screen touch pad. Each button is an independent pointer target
// so multi-touch works (move + jump + throw at once). The throw button is
// press-and-hold: holding charges a heavier shot, releasing throws — matching
// the `charging`/release logic in engine/sim.ts. Writes straight into a shared
// Input ref (no React state per frame → no re-render churn during play).

import React, { useCallback, useRef, useState } from 'react'
import type { Input } from '../engine/types'

type Key = keyof Input
type Layout = 'full' | 'left' | 'right'

function PadButton({
  onSet,
  k,
  label,
  big,
}: {
  onSet: (k: Key, v: boolean) => void
  k: Key
  label: string
  big?: boolean
}) {
  const [active, setActive] = useState(false)
  const size = big ? 104 : 62
  const release = () => {
    setActive(false)
    onSet(k, false)
  }
  return (
    <button
      aria-label={k}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        setActive(true)
        onSet(k, true)
      }}
      onPointerUp={(e) => {
        e.preventDefault()
        release()
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      style={{
        width: size,
        height: size,
        borderRadius: big ? '50%' : 16,
        border: 'none',
        fontSize: big ? 40 : 26,
        fontWeight: 800,
        color: '#fff',
        background: active
          ? 'rgba(255,255,255,0.42)'
          : big
            ? 'rgba(255,90,90,0.55)'
            : 'rgba(20,20,30,0.42)',
        backdropFilter: 'blur(4px)',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        transition: 'background 0.05s',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {label}
    </button>
  )
}

export default function TouchControls({
  inputRef,
  layout = 'full',
  onFirstTouch,
}: {
  inputRef: React.MutableRefObject<Input>
  layout?: Layout
  onFirstTouch?: () => void
}) {
  const firedFirst = useRef(false)

  const set = useCallback(
    (k: Key, v: boolean) => {
      inputRef.current[k] = v
      if (v && !firedFirst.current) {
        firedFirst.current = true
        onFirstTouch?.()
      }
    },
    [inputRef, onFirstTouch]
  )

  const wrap: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 5,
  }
  const cluster: React.CSSProperties = { position: 'absolute', bottom: 20, pointerEvents: 'auto' }

  if (layout === 'full') {
    return (
      <div style={wrap}>
        {/* movement — bottom left */}
        <div style={{ ...cluster, left: 18, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          <PadButton onSet={set} k="left" label="◀" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <PadButton onSet={set} k="jump" label="▲" />
            <PadButton onSet={set} k="crouch" label="▼" />
          </div>
          <PadButton onSet={set} k="right" label="▶" />
        </div>
        {/* throw — bottom right */}
        <div style={{ ...cluster, right: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              pointerEvents: 'none',
              color: 'rgba(255,255,255,0.85)',
              fontSize: 12,
              fontWeight: 700,
              textShadow: '0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            امسك للشحن
          </span>
          <PadButton onSet={set} k="attack" label="🩴" big />
        </div>
      </div>
    )
  }

  // Compact vertical stack for local 2-player on one device.
  const anchor = layout === 'left' ? { left: 14 } : { right: 14 }
  return (
    <div style={wrap}>
      <div style={{ ...cluster, ...anchor, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <PadButton onSet={set} k="jump" label="▲" />
        <div style={{ display: 'flex', gap: 8 }}>
          <PadButton onSet={set} k="left" label="◀" />
          <PadButton onSet={set} k="right" label="▶" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <PadButton onSet={set} k="crouch" label="▼" />
          <PadButton onSet={set} k="attack" label="🩴" />
        </div>
      </div>
    </div>
  )
}
