'use client'

// src/lib/use-body-scroll-lock.ts
// [BLAD-ACHTERGROND] While a sheet is open, the page behind it does not move.
//
// ── WHAT WAS MEASURED ──
//
// Three overlays in this app cover the whole screen. Two of them stop the page behind from
// scrolling and one does not:
//
//   Dialog.tsx        document.body.style.overflow = 'hidden'   ✓
//   SearchBar.tsx     document.body.style.overflow = 'hidden'   ✓
//   InvoiceDocumentSheet.tsx                          nothing   ✗
//
// The odd one out is the sheet that shows an invoice and its PDF — the one screen where the panel
// is nearly full height and a finger is on it the whole time.
//
// `overscroll-behavior: contain` on the sheet is NOT the same guarantee, and the difference is
// exactly where the complaint comes from. It stops a gesture that reaches the END of the sheet's
// own scroller from chaining onward. It does nothing for a gesture that never entered that
// scroller: the fixed head with the supplier's name, the two buttons pinned at the foot, the strip
// of backdrop above the panel. A drag on any of those scrolls the LIST BEHIND, and what the owner
// sees is the invoice card sliding around underneath the sheet they just opened.
//
// It shows up after the PDF loads for a plain reason: the embedded viewer takes over most of the
// panel, so the places left to put a finger are precisely the ones that were never covered.
//
// ── WHY A COUNTER ──
//
// Overlays nest — a confirm dialog opens over this sheet. Each one saving and restoring the
// previous value works only if they unwind in order; the inner one restoring `''` while the outer
// one is still open un-freezes the page underneath an overlay that is still there. A count has no
// such order dependency: the last lock to leave is the one that restores, whoever it is.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──
//
// No `position: fixed` on the body, no scroll-position save and restore. That technique also
// defeats iOS Safari's rubber-band, and it costs the page's scroll position on every open — a
// visible jump on the list the owner came from. This app's other two overlays have used plain
// `overflow: hidden` for their whole life without a complaint about either; matching them keeps
// one behaviour instead of two, and this file is where that decision can be revisited once.

import { useEffect } from 'react'

/** How many overlays currently want the page frozen. Module scope: one count per document. */
let locks = 0
/** What `body.style.overflow` was before the FIRST lock. Restored when the last one leaves. */
let restore = ''

/**
 * Freeze the page and hand back the release.
 *
 * A plain function and not only a hook, because the behaviour worth testing is the NESTING — two
 * overlays unwinding in either order — and that is arithmetic on the counter above, not anything a
 * render can show. A hook can only be exercised inside a renderer; this can be called twice in a
 * row by a test and asserted between the calls.
 */
export function acquireBodyScrollLock(): () => void {
  if (typeof document === "undefined") return () => {};
  if (locks === 0) restore = document.body.style.overflow;
  locks += 1;
  document.body.style.overflow = "hidden";

  // Guarded so a double release cannot drive the count negative. If it could, the NEXT sheet would
  // find the count at zero on the way IN, take `restore` from an already-frozen body, and leave the
  // page locked after it closed — a page that never scrolls again until a reload.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks <= 0) {
      locks = 0;
      document.body.style.overflow = restore;
    }
  };
}

/**
 * Freeze the page behind an overlay while `active` is true.
 *
 * Safe to call unconditionally with a boolean — that is the point of the parameter. A hook that
 * has to be called conditionally is a hook that gets called wrong.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireBodyScrollLock();
  }, [active]);
}

/** Test seam: the current lock depth. Not for production code — nothing should need to ask. */
export function __lockDepthForTests(): number {
  return locks;
}
