// src/lib/focus-scroll.ts
// [FOCUS-KOP] Where a deep-linked row has to come to rest. Pure, no DOM.
// Run: npx tsx --test src/lib/focus-scroll.test.ts
//
// WHAT WAS MEASURED
// Tapping an invoice under "DIT HEEFT JE AANDACHT NODIG" on the dashboard routes to
// /dashboard/incoming/manage?focus={id}. That worked — the row was found, expanded and
// highlighted — and the owner still landed nowhere near it. Reported as "far below".
//
// The deep-link effect does two things in order: it EXPANDS the focused row, then calls
//
//     row.scrollIntoView({ behavior: 'smooth', block: 'center' })
//
// An expanded incoming-invoice card carries a 273-line detail panel. Measured in Chromium at
// 390x844 the card is 695px tall — taller than the 586px of viewport left under the sticky
// chrome. `block: 'center'` centres the card's MIDDLE, and for a card taller than the viewport
// that puts its TOP off the top of the screen:
//
//     block:'center', expanded    card 695px   supplier name at y=74   → behind the chrome
//     block:'center', collapsed   card  62px   supplier name at y=391  → fine
//
// So the bug only appears BECAUSE the row was expanded first, which is why it looks like the
// focus feature does nothing: the owner arrives in the middle of the detail body, past the
// supplier name and past the highlight ring that was drawn for them.
//
// `block: 'start'` alone does not fix it either. The screen has two stacked sticky elements —
// the shared sub-page header (56px) and the Inkoopfacturen toolbar (190-246px depending on
// width) — and scrollIntoView knows nothing about them:
//
//     block:'start', no margin    supplier name at y=0    → behind the chrome
//     block:'start', margin       supplier name at y=266  → visible, just under the toolbar
//
// Hence a scroll margin, and hence this module: the margin is not a constant. The toolbar wraps,
// so its height is a function of viewport width, and it must be MEASURED at scroll time rather
// than assumed. What is worth testing is the arithmetic around that measurement — what happens
// when the bar cannot be measured, or measures to something absurd.

/** The breathing space between the sticky chrome and the top of the focused row. */
export const FOCUS_GAP = 8;

/**
 * The largest chrome height worth honouring, as a fraction of the viewport.
 *
 * A measurement can go wrong in a way that is worse than no measurement: if the bar reports a
 * height near the full viewport, the row would be pushed entirely below the fold and the owner
 * would land on empty space, having asked to be taken to an invoice. Past this fraction the
 * measurement is not believed.
 */
export const MAX_CHROME_FRACTION = 0.6;

/**
 * How far below the top of the page a focused row must start, in px.
 *
 * `chromeBottom` is the sticky toolbar's `getBoundingClientRect().bottom` — its lower edge in
 * viewport coordinates, which already includes the page header stacked above it. `fallbackChrome`
 * is what to assume when that cannot be read: the height of the page header alone, which is the
 * one piece of chrome that is always there.
 *
 * Fails toward "slightly too far down" rather than "hidden behind a bar". A row that starts a few
 * pixels lower than necessary is a cosmetic imperfection; a row whose supplier name sits under an
 * opaque toolbar is the defect this whole module exists to remove.
 */
export function focusScrollMarginTop(
  chromeBottom: number | null | undefined,
  fallbackChrome: number,
  viewportHeight = 0,
): number {
  const fallback = safe(fallbackChrome, 0);
  const measured = safe(chromeBottom, NaN);

  // Unreadable, zero or negative: the bar is not laid out yet (or the ref never attached). Assume
  // the header, which is the chrome that exists on every render of this screen.
  if (!Number.isFinite(measured) || measured <= 0) return fallback + FOCUS_GAP;

  // Implausibly large: believe the fallback instead of scrolling the row off the bottom.
  const ceiling = viewportHeight > 0 ? viewportHeight * MAX_CHROME_FRACTION : Infinity;
  if (measured > ceiling) return fallback + FOCUS_GAP;

  return Math.round(measured) + FOCUS_GAP;
}

function safe(n: number | null | undefined, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}
