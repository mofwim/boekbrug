// src/lib/design/tokens.ts
// [DESIGN] Shared Material design tokens — single source of truth.
//
// This used to be a superset that nobody imported: thirteen dashboard screens
// each declared their own `const M3 = {…}`, and the note here said surfaces
// whose local palette disagreed were "intentionally NOT migrated" because
// importing this would change their colour. Changing their colour turned out to
// be the entire point — the disagreement was not a matter of taste:
//
//   success   local #34A853 (Google green 500)  →  3.06:1 on white   FAILS AA
//             here  #137333 (Google green 800)  →  5.95:1 on white   passes
//   warning   local #E37400 (Google amber 600)  →  3.10:1 on white   FAILS AA
//             here  #7C5800 (Google amber 900)  →  6.46:1 on white   passes
//
// Six screens used the bright green and seven the bright amber, and several used
// them for TEXT: a received amount in the Kas ledger, the match confirmations in
// Bank, a button label in Inkoopfacturen. Money and status, printed below the
// legibility floor. Tellingly, the same files hardcoded '#137333' and '#7C5800'
// literally inches away, wherever the author happened to notice.
//
// So: `success` / `warning` / `error` are the TEXT-SAFE tones and are what you
// want almost always. The bright brand versions live on as *Fill — legitimate
// for a solid fill, a status dot or a progress bar, where the 3:1 non-text
// threshold applies, and never for a glyph or a word.
export const M3 = {
  primary: '#1A73E8',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3E3FD',
  onPrimaryContainer: '#041E49',
  surface: '#FFFFFF',
  onSurface: '#202124',
  onSurfaceVariant: '#5F6368',
  surfaceVariant: '#f1f3f4',
  // [A11Y-CONTRAST] An OUTLINE, never a word. 3.68:1 on white clears the 3:1 threshold for
  // a non-text boundary and fails the 4.5:1 one for text — the same split this file already
  // draws for green and amber. For quiet TEXT use `mutedText` below.
  outline: '#80868b',
  neutral: '#5F6368',
  // [A11Y-CONTRAST] The QUIETEST readable text — timestamps, breadcrumbs, captions, the
  // sub-line under a label. The screens used #9AA0A6 for this, which is 2.64:1 on white: it
  // fails the text floor AND the non-text one, so it was below every threshold WCAG defines
  // while carrying real content (a date, a section label, a breadcrumb trail).
  //
  //   mutedText  #70757a  →  4.65:1 on white   passes AA
  //
  // Deliberately NOT folded into `neutral` (#5F6368, 6.05:1): that would erase the third
  // step of the hierarchy and make every quiet line shout as loudly as the secondary one.
  // This sits between them — readable, still visibly quieter.
  mutedText: '#70757a',
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

  // ── Fill-only tones ───────────────────────────────────────────────────────
  // The bright Google brand colours. Use for a solid fill, a status dot, a bar,
  // an icon on a dark ground — anything covered by the 3:1 non-text contrast
  // rule. NEVER for text or a glyph on a light surface: they sit around 3:1,
  // which is below the 4.5:1 an ordinary word needs. Reach for `success` /
  // `warning` / `error` instead, which are the same hues taken darker.
  successFill: '#34A853',
  warningFill: '#E37400',
  errorFill: '#EA4335',
} as const

// ── Radius ──────────────────────────────────────────────────────────────────
// [DESIGN] One radius scale. Eleven files declared their own `const R`, mostly
// agreeing but not always ({sm:8,md:12,lg:16,full:9999} vs one with xl:24 vs one
// with full:999), and the accountant screens ignored the idea entirely and used
// a flat 8 everywhere while the owner screens used 16. That single difference is
// most of why the two halves of the app do not look like one product.
//
// Mirrors --radius-* in globals.css. `full` is a pill; use it for chips and
// anything capsule-shaped.
export const R = {
  /** 8px — a chip, a small inline control. */
  sm: 8,
  /** 12px — a button, a nested panel. Matches --radius-button. */
  md: 12,
  /** 16px — a card. Matches --radius-card. The app's default surface radius. */
  lg: 16,
  /** 24px — a sheet or a large modal. */
  xl: 24,
  /** 28px — a dialog. Rounder than a card on purpose, so a dialog reads as a
   *  separate object rather than a panel of the page. */
  dialog: 28,
  /** A pill. */
  full: 9999,
} as const

// ── Elevation ───────────────────────────────────────────────────────────────
// [DESIGN] Card shadows. The two sides of the app disagreed here too: the
// accountant screens drew a 1px grey border and no shadow, the owner screens a
// shadow and no border. EL1 is the shared answer — the same value as
// --shadow-card in globals.css.
export const EL1 = '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)'
export const EL2 = '0 4px 12px rgba(0,0,0,0.12)'
export const EL3 = '0 8px 32px rgba(0,0,0,0.16)'
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

// ── Page column ─────────────────────────────────────────────────────────────
// [BAR-ALIGN] The gutter every dashboard page leaves between its column and the
// screen edge. A page column is a border-box `maxWidth: N` centred with
// `margin: '0 auto'` and `padding: '… 16px'`, so the rows the reader actually
// sees are N − 2×PAGE_GUTTER wide.
export const PAGE_GUTTER = 16

/**
 * [COLUMN-LADDER] How wide a dashboard page is allowed to be. Two steps, and
 * the two-ness is the point: this replaced ELEVEN different widths (430, 480,
 * 560, 600, 640, 672, 680, 720, 768, 800, 896), which is simply what "pick a
 * number that looks right" produces once thirty screens have been written by
 * hand. Two of those eleven had already drifted away from their own loading
 * skeleton — /incoming rendered a 430 column behind a 720 skeleton and
 * /quarterly an 896 one behind a 768 — so the page visibly jumped as it loaded.
 * A page and its skeleton now read the same constant, which is what makes that
 * class of bug impossible rather than merely fixed.
 *
 * `work` is 680 because that is the narrowest column every piece of content in
 * this app fits inside — measured in Chromium, not estimated:
 *
 *   the densest money row (supplier + 3 chips + 3 dates + amount + 2 buttons)
 *     stops truncating a 51-character name at 528px of content   → 560 column
 *   the widest table in the app (dagomzet: date + 5 money columns)
 *     is 628px at its natural width                              → 660 column
 *   everything else (2–4 column grids, forms, the chat, quarter buttons)
 *     needs under 600px                                          → < 640 column
 *
 * Nothing needs more, so nothing gets more — and the ceiling matters as much as
 * the floor here. In a money list the label sits left and the amount right; the
 * wider the row, the further the eye travels between them and the easier it is
 * to read the amount off the wrong line. Ledgers answer that with zebra stripes
 * or leader dots; this app is Material 3 cards and has neither, so the honest
 * limit is roughly 650px of row. 680 lands there, and it is also what Mijn
 * facturen, Mijn klanten and Inkoopfacturen — the three densest lists, the ones
 * that would have complained first — had already settled on independently.
 *
 * Note that 640 was the more POPULAR width (nine pages) and would still have
 * been the wrong pick: dagomzet's table needs 628 and a 640 column offers 608,
 * which is why the only screen in the app with genuinely wide content was also
 * the one scrolling sideways on a desktop monitor.
 *
 * Below 640px — the app's phone breakpoint, where the bottom nav takes over —
 * no column binds and nothing here changes at all. This ladder is a desktop
 * concern from top to bottom.
 */
export const COLUMN = {
  /**
   * 480 — a hub. The two home screens and Mijn werkplek: a menu of
   * destinations with a small snapshot on top, not a screen of data. Kept
   * narrow deliberately — the tiles are full-width rows, and the snapshot puts
   * "Te betalen" next to "€ 62.305,96" instead of a hand-span apart. If a home
   * ever feels lost on a large monitor, the answer is a two-column tile grid
   * above ~1024px, not a wider single column.
   */
  hub: 480,
  /** 680 — every other dashboard screen: lists, forms, details, settings,
   *  tables, and the accountant's screens. See the note above for why 680. */
  work: 680,
} as const

/**
 * How wide a sticky/fixed bar's INNER row must be to line up with the page
 * column underneath it.
 *
 * A bar spans the viewport on purpose — its blur, its fill and its hairline
 * should run edge to edge. Its CONTENT must not: a search field, a filter
 * dropdown or an action row that stretches the full width of a 1900px screen
 * sits above a 680px list it has no visual relationship with, and the controls
 * end up hundreds of pixels away from the rows they act on. Cap the inner row
 * at `columnInner(column)` and centre it inside the bar's own PAGE_GUTTER
 * padding, and the two edges meet exactly:
 *
 *   <div style={{ position: 'sticky', top: STICKY_BELOW_HEADER, padding: '12px 16px' }}>
 *     <div style={{ maxWidth: columnInner(COLUMN), margin: '0 auto' }}>…</div>
 *   </div>
 *   <main style={{ maxWidth: COLUMN, margin: '0 auto', padding: '12px 16px' }}>…</main>
 *
 * Below `column + 2×PAGE_GUTTER` the cap does not bind, so a phone is untouched.
 * See docs/HEADER_SYSTEM.md, "Where things sit in the bar".
 */
export const columnInner = (column: number) => column - 2 * PAGE_GUTTER

/**
 * [SHEET-BOTTOM] The bottom padding every panel pinned to the bottom EDGE of the screen needs.
 *
 * A bottom sheet renders at `inset: 0` with `alignItems: 'flex-end'`, so its last row sits exactly
 * where the fixed bottom navigation is — and the nav wins, because it is painted over the sheet.
 * On a phone that hides 64px plus the home-indicator inset: enough to swallow a whole button.
 *
 * It did. The "Betalen" sheet on Inkoopfacturen ended in two buttons, "Ja, ik heb betaald" and
 * "Nog niet"; only the first was reachable. The second was behind the bar with no way to scroll to
 * it, because the sheet had already reached the bottom of its own scroll box. The owner's only exit
 * from a payment sheet was to confirm a payment they had not made, or to tap the backdrop and hope.
 *
 * --bottom-nav-h is 0 above the breakpoint, where no bar is rendered, so this is unconditionally
 * correct at both sizes and needs no media query of its own (globals.css says the same).
 *
 * @param base the padding the panel would have had on its own, in px.
 */
export const sheetPaddingBottom = (base: number): string =>
  `calc(${base}px + var(--bottom-nav-h) + env(safe-area-inset-bottom))`
