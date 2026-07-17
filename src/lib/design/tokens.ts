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
