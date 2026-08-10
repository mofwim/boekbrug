// [FOCUS-KOP] Pure node test — run: npx tsx --test src/lib/focus-scroll.test.ts
//
// The property: a deep-linked row comes to rest BELOW the sticky chrome, and every way the
// measurement can fail lands it too low rather than behind a bar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { focusScrollMarginTop, FOCUS_GAP, MAX_CHROME_FRACTION } from "./focus-scroll";

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
