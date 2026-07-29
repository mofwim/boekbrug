// src/lib/design/tokens.ts
// [DESIGN] Shared Material design tokens — single source of truth.
// Superset of the per-surface M3 palettes that were previously copy-pasted into
// each dashboard client. Values are the agreed (majority) tokens; surfaces whose
// local palette used a DIFFERENT value for a shared key keep their own local M3
// (importing this would change their color), so they are intentionally NOT migrated.
export const M3 = {
  primary: '#1A73E8',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3E3FD',
  onPrimaryContainer: '#041E49',
  surface: '#FFFFFF',
  onSurface: '#202124',
  onSurfaceVariant: '#5F6368',
  surfaceVariant: '#f1f3f4',
  outline: '#80868b',
  neutral: '#5F6368',
  outlineVariant: '#E0E0E0',
  success: '#137333',
  successContainer: '#CEEAD6',
  error: '#B3261E',
  errorContainer: '#F9DEDC',
  warning: '#7C5800',
  warningContainer: '#FEE8C4',
  track: '#f1f3f4',
  bg: '#F8F9FA',
  hairline: '#e0e0e0',
  hover: '#F1F3F4',
  vault: '#455A64',
  tertiary: '#7B1FA2',
  tertiaryContainer: '#E1BEE7',
  warn: '#B26A00',
  warnContainer: '#FEEFC3',
} as const
export const FONT = "'Roboto', -apple-system, sans-serif"
export const FONT_NUM = "'Roboto Mono', monospace"

// ── Motion ──────────────────────────────────────────────────────────────────
// [MOTION] Single source of truth for how long things take and how they ease.
// Before this existed every transition in the app was a hand-written magic
// number — 113 inline `transition:` declarations across 41 files, no two the
// same — so nothing felt like it belonged to one product. The mirror of this
// table lives in globals.css as --dur-* / --ease-* custom properties; change a
// value in BOTH or they drift. See docs/MOTION_SYSTEM.md.
//
// Durations are tuned for a financial app: quick and matter-of-fact, never
// showy. The rule of thumb is that the user should never *wait* on an
// animation — motion explains what moved where, then gets out of the way.
export const DUR = {
  /** 80ms — a press, a hover tint. Below ~100ms reads as instant. */
  instant: 80,
  /** 140ms — the default for colour/opacity on a control. */
  fast: 140,
  /** 200ms — the default for anything that moves or resizes. */
  base: 200,
  /** 280ms — a dialog or sheet arriving. */
  slow: 280,
  /** 400ms — a full-surface change; the longest we ever use. */
  slower: 400,
} as const

// Material 3 easing set. `standard` covers almost everything. `decelerate` is
// for things ENTERING the screen (fast at first, settles gently — the single
// biggest contributor to a "fluid" feel), `accelerate` for things LEAVING
// (content on its way out should not linger), `spring` adds a small overshoot
// and is reserved for a press release or a FAB — never for data.
export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  accelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  spring: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
} as const

/**
 * Build a CSS `transition` value from the tokens above.
 *
 *   transition('opacity', 'fast')                → "opacity 140ms cubic-bezier(…)"
 *   transition(['opacity', 'transform'], 'base') → both properties, same timing
 *
 * Prefer this over a literal so timings stay in step across the app. Avoid
 * `all` — it animates properties you did not mean to (notably `height`, which
 * is what makes a list feel like it is swimming).
 */
export function transition(
  property: string | readonly string[],
  duration: keyof typeof DUR = 'base',
  easing: keyof typeof EASE = 'standard',
): string {
  const props = typeof property === 'string' ? [property] : property
  return props.map((p) => `${p} ${DUR[duration]}ms ${EASE[easing]}`).join(', ')
}

// [HEADER-SYSTEM] Single source of truth for the sticky-header height.
// The shared sub-page bar (components/nav/SubPageHeader) and the home bar
// (app/dashboard/_shared DashboardHeader) both use this, and any secondary
// sticky toolbar that must sit BELOW the header offsets by it — so nobody
// hardcodes a magic `56` again. If the header height ever changes, change it
// here only. See docs/HEADER_SYSTEM.md.
export const PAGE_HEADER_HEIGHT = 56

// CSS `top:` value for a secondary sticky bar that must clear the page header,
// including the notch inset on standalone PWA. Use as:
//   position: 'sticky', top: STICKY_BELOW_HEADER
export const STICKY_BELOW_HEADER = `calc(${PAGE_HEADER_HEIGHT}px + env(safe-area-inset-top))`
