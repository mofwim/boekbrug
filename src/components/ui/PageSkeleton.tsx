// src/components/ui/PageSkeleton.tsx
// [INSTANT] The building blocks every route's loading.tsx composes from.
//
// Why this exists: the app had error boundaries everywhere and loading states
// nowhere — zero loading.tsx files against forty dashboard routes, and most of
// those routes are `force-dynamic`. So every tap held the OLD page on screen,
// motionless, until the server came back with the new one. Nothing said "heard
// you". That single gap did more damage to how fast the app feels than any
// amount of actual latency.
//
// A skeleton is a promise about what is coming, so it has to keep that promise:
// the shape here must match the shape of the real page, at the same container
// width and roughly the same block heights. A skeleton that guesses wrong just
// moves the jank later, into a layout shift the moment data lands.
//
// These are Server Components (no "use client") — they ship as HTML with no
// JavaScript, which is the point: the fallback must be able to paint before
// anything hydrates.

import type { CSSProperties, ReactNode } from 'react'
import { COLUMN } from '@/lib/design/tokens'

// The shimmer sweep, in inline styles so a skeleton needs no Tailwind classes
// and no client JS. Keyframes live in globals.css (`bb-shimmer`).
const shimmer: CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, #eceff1 25%, #f5f6f7 37%, #eceff1 63%)',
  backgroundSize: '400% 100%',
  animation: 'bb-shimmer 1.4s ease-in-out infinite',
}

/** A single grey bar. `w` accepts any CSS width (number → px). */
export function SkeletonLine({
  w = '100%',
  h = 12,
  radius = 999,
  style,
}: {
  w?: number | string
  h?: number
  radius?: number
  style?: CSSProperties
}) {
  return <div style={{ ...shimmer, width: w, height: h, borderRadius: radius, ...style }} />
}

/** A card-shaped block — same 16px radius and elevation as a real `.card`. */
export function SkeletonCard({
  h,
  children,
  style,
}: {
  h?: number
  children?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        height: h,
        padding: children ? 16 : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * A list of rows inside one card — the single most common dashboard shape
 * (facturen, klanten, inkomend, bank, berichten).
 *
 * `rowHeight` defaults to 72, which is what a real invoice row measures; keep
 * it in step with the list you are standing in for, or the content jumps when
 * it arrives.
 */
export function SkeletonList({
  rows = 5,
  rowHeight = 72,
  header = true,
}: {
  rows?: number
  rowHeight?: number
  header?: boolean
}) {
  return (
    <SkeletonCard style={{ overflow: 'hidden' }}>
      {header && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f3f4' }}>
          <SkeletonLine w={120} h={14} />
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            height: rowHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '0 20px',
            borderBottom: i === rows - 1 ? 'none' : '1px solid #f5f5f5',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
            <SkeletonLine w={`${58 - (i % 3) * 9}%`} h={13} />
            <SkeletonLine w={`${38 - (i % 2) * 7}%`} h={11} />
          </div>
          <SkeletonLine w={64} h={13} style={{ flexShrink: 0 }} />
        </div>
      ))}
    </SkeletonCard>
  )
}

/** A row of stat tiles, as on Vandaag / Resultaat. */
export function SkeletonStats({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SkeletonLine w={56} h={10} />
            <SkeletonLine w={80} h={22} radius={6} />
          </div>
        </SkeletonCard>
      ))}
    </div>
  )
}

/**
 * The page frame. `maxWidth` MUST match the real page's container, otherwise
 * the content slides sideways the moment it replaces the skeleton.
 *
 * [COLUMN-LADDER] "MUST" was doing no work while both sides were hand-written
 * numbers: /incoming drew a 720 skeleton over a 430 page and /quarterly a 768
 * one over an 896 page, and each of them jumped on every load. Pass a step of
 * the ladder — `COLUMN.work`, or `COLUMN.hub` for a home — and the page reads
 * the same constant, so the two cannot disagree again.
 *
 * `aria-busy` + a visually-hidden label is how a screen reader learns that
 * something is on its way; a silent grey page tells it nothing at all.
 */
export function SkeletonPage({
  maxWidth = COLUMN.work,
  children,
}: {
  maxWidth?: number
  children: ReactNode
}) {
  return (
    <div
      aria-busy="true"
      style={{ maxWidth, margin: '0 auto', padding: '20px 16px 80px' }}
    >
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        Bezig met laden…
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  )
}
