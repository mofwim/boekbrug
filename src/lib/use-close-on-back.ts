'use client'

// src/lib/use-close-on-back.ts
// [BACK-CLOSES] On a phone, the back button closes what is open — it does not leave the page.
//
// ── THE BUG ──
// A sheet is open over Inkoopfacturen. The owner presses the system back button, which on Android
// is the universal "undo the last thing" gesture, and the app navigates to the dashboard. The sheet
// they were reading is gone AND so is the screen behind it, along with their scroll position in a
// list of hundreds. Every overlay in this app did that, because none of them were on the history
// stack at all: back had nothing to undo except the navigation that brought them to the page.
//
// It is not a small annoyance. Back is the most-pressed control on an Android phone, and this app
// is used one-handed while standing at a counter. An owner who has learned that back throws away
// their place stops using back — and then every dismissal costs a deliberate reach for a small ✕ in
// a corner.
//
// ── HOW IT WORKS ──
// Opening an overlay pushes a history entry that points at nothing (same URL, a marked state). Back
// then pops THAT entry instead of leaving the page, and the popstate closes the overlay. Closing by
// any other means (the ✕, the backdrop, finishing the action) removes the entry again, so the next
// back press still does what it always did.
//
// ── THE THREE THINGS THAT MAKE THIS HARD, AND WHAT IS DONE ABOUT THEM ──
//
// 1. NESTED OVERLAYS. A sheet can open a confirm on top of itself. If every overlay listened to
//    popstate independently, one back press would close BOTH — and the owner would lose the sheet
//    they were half-way through because they dismissed a confirm. So there is one listener and a
//    stack: back closes exactly the top one.
//
// 2. A NAVIGATION WHILE OPEN. An overlay that routes somewhere ("Bekijk in bestanden →") unmounts
//    because the page changed. A naive cleanup would then call history.back() and UNDO that
//    navigation — the app would bounce straight back off the page the owner just asked for. So the
//    entry carries a unique id, and the cleanup only pops when that id is still the current state.
//    After a router.push it is not, so nothing is popped.
//
// 3. DOUBLE-INVOKED EFFECTS in React's development StrictMode. The push/cleanup pair is symmetric —
//    push then pop then push — so a double invoke settles on exactly one entry rather than two.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──
// It does not change the URL. An overlay is not a page: deep-linking one would mean every sheet in
// the app needs a route, a server read and a shareable state, and the ones here are all "look at
// the thing you already have on screen". The entry is a bookmark in the session, nothing more.

import { useEffect, useRef } from 'react'

/** Marker on the pushed history entry. The value is the instance id — see reason 2 above. */
const STATE_KEY = '__overlay'

/** Every open overlay, oldest first. Back closes the last one. */
const stack: { id: string; close: () => void }[] = []

let listening = false
let counter = 0

/**
 * The single popstate listener.
 *
 * Registered once for the whole app rather than once per overlay, because "which overlay does this
 * back press belong to" is a question about the stack and not about any one component. With a
 * listener each, a single pop would reach all of them.
 */
function ensureListener() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('popstate', () => {
    const top = stack.pop()
    // No overlay open → this is an ordinary navigation and none of our business.
    if (top) top.close()
  })
}

/**
 * Make the system back button close this overlay instead of leaving the page.
 *
 * @param open     whether the overlay is on screen right now
 * @param onClose  the same close the ✕ and the backdrop call — one way out, not a second one
 *
 * The handler is held in a ref, so passing an inline arrow (which every call site does) does not
 * re-push a history entry on every render.
 */
export function useCloseOnBack(open: boolean, onClose: () => void): void {
  // Held in a ref so that passing an inline arrow — which every call site does — does not re-push
  // a history entry on every render. Written in an effect rather than during render: a render is
  // allowed to be thrown away and re-run, and mutating a ref there is exactly what React's
  // "cannot access refs during render" rule is about. An effect is also early enough, because a
  // popstate cannot arrive before the browser has painted.
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const o = openOverlay(() => closeRef.current())
    return o.unmount
  }, [open])
}

/**
 * Put one overlay on the back stack, and hand back its teardown.
 *
 * Separated from the hook so the behaviour can be tested without React: everything that can go
 * wrong here is stack discipline and the decision to pop or not to pop, and neither needs a
 * renderer. The hook is then just "call this while open".
 */
export function openOverlay(onClose: () => void): { id: string; unmount: () => void } {
  ensureListener()
  const w = window as unknown as { history: History }

  const id = `ov${++counter}`
  let closedByBack = false

  stack.push({ id, close: () => { closedByBack = true; onClose() } })
  w.history.pushState({ [STATE_KEY]: id }, '')

  return {
    id,
    unmount: () => {
      // Leave the stack whichever way this ended — a stale entry would swallow a later back press.
      const at = stack.findIndex((e) => e.id === id)
      if (at >= 0) stack.splice(at, 1)

      if (closedByBack) return // the entry is already gone; popping again would leave the page

      // Closed by the ✕, the backdrop, or a finished action. Our entry is still on the history
      // stack and has to go, or the owner's next back press is silently eaten by a dead entry.
      //
      // …but ONLY if it is still the current one. If the overlay unmounted because the app
      // navigated, the current state belongs to that navigation, and popping here would bounce the
      // owner straight back off the page they just asked for.
      const state = w.history.state as Record<string, unknown> | null
      if (state && state[STATE_KEY] === id) w.history.back()
    },
  }
}

/**
 * For tests: the ids currently on the stack, oldest first.
 *
 * Exported because the thing that has to hold is an ORDER — back closes the top one — and order is
 * not visible from any single component.
 */
export function overlayStackIds(): string[] {
  return stack.map((e) => e.id)
}
