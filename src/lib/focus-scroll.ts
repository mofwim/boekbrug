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

/** Anything with a measurable box. Duck-typed so this stays testable without a DOM. */
export interface Measurable {
  getBoundingClientRect(): { bottom: number };
}

/** The attribute that marks the shared sub-page header, so any screen can measure the chrome. */
export const SUBPAGE_HEADER_SELECTOR = "[data-subpage-header]";

/**
 * Bring a deep-linked row to rest just under the sticky chrome, on its own header.
 *
 * One function rather than the same six lines on five screens: this landing was wrong in five
 * places at once precisely because each screen had written it out again. Returns false when the
 * row is not in the DOM, so a caller can tell the difference between "scrolled" and "nothing to
 * scroll to" instead of assuming the first.
 *
 * `localBar` is the screen's own sticky toolbar when it has one, and null when it does not — the
 * shared header is found here, so no screen has to know about it.
 */
export function landRowUnderChrome(
  row: HTMLElement | null | undefined,
  localBar: Measurable | null | undefined,
  fallbackChrome: number,
): boolean {
  if (!row) return false;
  const shared =
    typeof document === "undefined" ? null : document.querySelector(SUBPAGE_HEADER_SELECTOR);
  row.style.scrollMarginTop = `${focusScrollMarginTop(
    stickyChromeBottom(localBar, shared),
    fallbackChrome,
    typeof window === "undefined" ? 0 : window.innerHeight,
  )}px`;
  // block: 'start' — NEVER 'center'. See the header: an expanded card is routinely taller than
  // the viewport, and centring one puts its top, its name and its amount off the top of the screen.
  row.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

/**
 * The lower edge of everything sticky above the list, or null when nothing can be measured.
 *
 * Two bars can be stacked above a list and a screen may have either, both, or neither:
 *
 *   · the shared sub-page header — on every /dashboard sub-page, `position: sticky; top: 0`;
 *   · the page's own toolbar — search, filters, actions — offset below it.
 *
 * The LOWER of the two edges is the one that matters, so this takes the maximum rather than
 * assuming an order. Screens without their own toolbar (the verification queue, the accountant's
 * quarter view) then still land correctly, and screens with one are unaffected because their
 * toolbar is by construction the lower bar.
 *
 * Measured rather than derived from PAGE_HEADER_HEIGHT, because the shared header also carries
 * `env(safe-area-inset-top)` in standalone PWA mode. A constant is right only on a device with no
 * notch, and wrong by the height of the notch on every other one — which puts the invoice name
 * back under the bar, which is the entire defect this module exists to remove.
 */
export function stickyChromeBottom(
  ...bars: (Measurable | null | undefined)[]
): number | null {
  let lowest: number | null = null;
  for (const bar of bars) {
    const bottom = bar?.getBoundingClientRect?.().bottom;
    if (typeof bottom !== "number" || !Number.isFinite(bottom)) continue;
    if (lowest === null || bottom > lowest) lowest = bottom;
  }
  return lowest;
}
