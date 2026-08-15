// [FOCUS-KOP] Pure node test — run: npx tsx --test src/lib/focus-scroll.test.ts
//
// The property: a deep-linked row comes to rest BELOW the sticky chrome, and every way the
// measurement can fail lands it too low rather than behind a bar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { focusScrollMarginTop, stickyChromeBottom, FOCUS_GAP, MAX_CHROME_FRACTION,
  focusLandingOff,
  FOCUS_TOLERANCE,
  FOCUS_SETTLE_MS,
} from "./focus-scroll";

const HEADER = 56;      // PAGE_HEADER_HEIGHT — the chrome that is always there
const VIEWPORT = 844;

test("[FOCUS-KOP] a measured toolbar decides the margin", () => {
  // 258 is the real measurement at 390px: 56px page header + 202px toolbar.
  assert.equal(focusScrollMarginTop(258, HEADER, VIEWPORT), 258 + FOCUS_GAP);
  // …and the toolbar wraps, so the number genuinely differs per width. 246px of toolbar at 320px.
  assert.equal(focusScrollMarginTop(302, HEADER, VIEWPORT), 302 + FOCUS_GAP);
  // Above the breakpoint it shrinks again.
  assert.equal(focusScrollMarginTop(246, HEADER, VIEWPORT), 246 + FOCUS_GAP);
});

test("[FOCUS-KOP] a sub-pixel rect does not produce a fractional margin", () => {
  assert.equal(focusScrollMarginTop(257.6, HEADER, VIEWPORT), 258 + FOCUS_GAP);
});

test("[FOCUS-KOP] an unreadable bar falls back to the header, never to zero", () => {
  // Zero is the dangerous answer: it is exactly `block: 'start'` with no margin, which measured
  // the supplier name at y=0 — behind the chrome, which is the reported bug.
  for (const bad of [null, undefined, NaN, 0, -1, -940]) {
    const m = focusScrollMarginTop(bad as number, HEADER, VIEWPORT);
    assert.equal(m, HEADER + FOCUS_GAP, `${String(bad)} must fall back to the header`);
    assert.ok(m > 0, "a zero margin puts the row back under the sticky bar");
  }
});

test("[FOCUS-KOP] an absurd measurement is not believed", () => {
  // The failure that would be WORSE than the original: a bar reporting most of the viewport pushes
  // the row below the fold, so the owner asked to be taken to an invoice and arrives at blank space.
  const absurd = VIEWPORT * MAX_CHROME_FRACTION + 1;
  assert.equal(focusScrollMarginTop(absurd, HEADER, VIEWPORT), HEADER + FOCUS_GAP);
  assert.equal(focusScrollMarginTop(VIEWPORT, HEADER, VIEWPORT), HEADER + FOCUS_GAP);
  // …but a large-and-plausible bar on a short viewport is still honoured.
  assert.equal(focusScrollMarginTop(300, HEADER, 844), 300 + FOCUS_GAP);
});

test("[FOCUS-KOP] with no viewport known, any positive measurement is honoured", () => {
  // Server render or a test with no layout: there is nothing to judge 'absurd' against, and
  // refusing every measurement would be its own bug.
  assert.equal(focusScrollMarginTop(258, HEADER), 258 + FOCUS_GAP);
  assert.equal(focusScrollMarginTop(5000, HEADER), 5000 + FOCUS_GAP);
});

test("[FOCUS-KOP] a broken fallback still yields a usable number", () => {
  // Both inputs wrong at once must not produce NaN — an NaN scroll-margin is silently dropped by
  // the browser, which lands the row behind the bar again with nothing to show for it.
  const m = focusScrollMarginTop(null, NaN as number, VIEWPORT);
  assert.ok(Number.isFinite(m), "a NaN margin is ignored by the browser — back to the original bug");
  assert.equal(m, FOCUS_GAP);
});

// ── stickyChromeBottom: which bar is actually in the way ──────────────────────────────────────

const bar = (bottom: number) => ({ getBoundingClientRect: () => ({ bottom }) });

test("[FOCUS-KOP] the LOWER of the stacked bars decides, whatever order they come in", () => {
  // A page toolbar sits below the shared header, so it is normally the lower edge — but the
  // argument order must not be what decides that.
  assert.equal(stickyChromeBottom(bar(258), bar(56)), 258);
  assert.equal(stickyChromeBottom(bar(56), bar(258)), 258);
});

test("[FOCUS-KOP] a screen with no toolbar of its own still measures the shared header", () => {
  // The verification queue and the accountant's quarter view have no toolbar. Before this they
  // would have fallen back to a constant, which is wrong by the height of a notch on any device
  // that has one — the header carries env(safe-area-inset-top).
  assert.equal(stickyChromeBottom(null, bar(56)), 56);
  assert.equal(stickyChromeBottom(undefined, bar(103)), 103, "56 + a 47px notch");
});

test("[FOCUS-KOP] nothing measurable is null, so the caller can fall back deliberately", () => {
  // Null, not 0. Zero would read as "no chrome" and land the row at the very top of the page —
  // behind whatever is actually there.
  assert.equal(stickyChromeBottom(null, undefined), null);
  assert.equal(stickyChromeBottom(), null);
  assert.equal(stickyChromeBottom({} as never), null, "an element without the method");
  assert.equal(stickyChromeBottom(bar(NaN)), null, "an unlaid-out element measures NaN");
});

test("[FOCUS-KOP] a null chrome flows into the documented fallback", () => {
  // The two functions have to compose: nothing measurable must still produce a usable margin.
  assert.equal(focusScrollMarginTop(stickyChromeBottom(null, null), HEADER, VIEWPORT), HEADER + FOCUS_GAP);
});

// ─── [FOCUS-NAZICHT] Aiming once is not landing ────────────────────────────────────────────────
//
// Reported after the margin was already in place: tapping an invoice on /vandaag still lands
// several rows past it. Measured in Chromium at 390x844, on a page built to that screen's shape:
//
//     nothing changes during the animation      row top y=244, chrome bottom y=236   correct
//     a 120px notice above the list disappears  row top y=124                        112px above
//     the sticky toolbar itself re-wraps        still correct
//
// The window is exactly the animation. A shift AFTER it lands is absorbed by the browser's own
// scroll anchoring; a shift DURING it is not, because scrollIntoView({behavior:'smooth'}) computes
// its destination once and animates to that number whatever happens to the element.

test("[FOCUS-NAZICHT] a landing that is off by more than the rounding is corrected", () => {
  // Both numbers are viewport y. `wanted` is the scroll margin the row was aimed with — the chrome
  // bottom plus the gap — which is exactly where a correct landing puts the row's top: measured
  // 244, against a chrome bottom of 236.
  assert.equal(focusLandingOff(244, 244), false, "the measured correct landing is not a miss");
  // And the measured miss: the row at 124 after a 120px notice vanished mid-animation.
  assert.equal(focusLandingOff(124, 244), true);
  assert.equal(244 - 124, 120, "the error is the height of whatever moved — not a near miss");
});

test("[FOCUS-NAZICHT] rounding noise is not a miss", () => {
  // Too tight and every landing re-scrolls on a sub-pixel difference, which is a visible twitch on
  // a screen the owner just arrived at.
  for (const off of [0, 1, -1, 5.9, -5.9]) {
    assert.equal(focusLandingOff(244 + off, 244), false, `${off}px must not trigger a correction`);
  }
  assert.equal(focusLandingOff(244 + 6.1, 244), true, "just past the tolerance does");
  assert.equal(FOCUS_TOLERANCE, 6);
});

test("[FOCUS-NAZICHT] an unmeasurable position corrects nothing", () => {
  // The row is gone, or the browser answered with something that is not a number. Doing nothing is
  // the only safe answer: a correction computed from NaN would scroll somewhere arbitrary.
  assert.equal(focusLandingOff(null, 244), false);
  assert.equal(focusLandingOff(undefined, 244), false);
  assert.equal(focusLandingOff(NaN, 244), false);
  assert.equal(focusLandingOff(124, NaN), false);
});

test("[FOCUS-NAZICHT] the checks sit past the end of a smooth scroll", () => {
  // A correction fired mid-animation would cancel the animation the owner is watching. Chrome's
  // smooth scroll runs roughly 300-500ms; the first look is at 700.
  assert.ok(FOCUS_SETTLE_MS.length >= 2, "one look cannot catch a shift that arrives late");
  assert.ok(FOCUS_SETTLE_MS[0] >= 600, `first check at ${FOCUS_SETTLE_MS[0]}ms would fight the animation`);
  assert.deepEqual([...FOCUS_SETTLE_MS].sort((a, b) => a - b), [...FOCUS_SETTLE_MS], "in order");
});
