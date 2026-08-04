// [BACK-CLOSES] Pure node test — run: npx tsx --test src/lib/use-close-on-back.test.ts
//
// The hook is a React hook, but everything that can go WRONG with it is in the stack discipline
// and in the decision to pop or not to pop — and neither of those needs React to be exercised.
// So the test drives the same module through a fake window: a real history array, a real popstate
// listener, and the same push/cleanup pairs a mount and unmount would produce.
//
// What is being held is an ORDER and a REFUSAL:
//   · back closes the TOP overlay, not all of them (a confirm over a sheet must not take the
//     sheet with it);
//   · closing by the ✕ removes the entry again, so the next back press is not silently eaten;
//   · and the entry is NOT popped when the overlay went away because the app navigated — which
//     would bounce the owner straight back off the page they just asked for.
//
// The last one is the reason this file exists. It is invisible in a browser until the day someone
// taps "Bekijk in bestanden →" from inside a sheet and lands back where they started.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── A window with a real history stack ────────────────────────────────────────
type Entry = Record<string, unknown> | null

class FakeHistory {
  stack: Entry[] = [null]      // the page the owner arrived on
  i = 0
  onPop: (() => void) | null = null
  get state(): Entry { return this.stack[this.i] }
  pushState(s: Entry) { this.stack = this.stack.slice(0, this.i + 1); this.stack.push(s); this.i++ }
  back() {
    if (this.i === 0) return
    this.i--
    this.onPop?.()
  }
}

function install(): FakeHistory {
  const h = new FakeHistory()
  ;(globalThis as { window?: unknown }).window = {
    history: h,
    addEventListener: (ev: string, fn: () => void) => { if (ev === 'popstate') h.onPop = fn },
    removeEventListener: () => {},
  }
  return h
}

/**
 * Re-import the module fresh, because its stack and its "listener installed" flag are module
 * state — which is the right design (one listener for the app) and would otherwise leak between
 * tests as a stale overlay that eats the next back press.
 */
async function freshModule() {
  return await import(`./use-close-on-back?t=${Math.random()}`) as typeof import('./use-close-on-back')
}

/** Mount one overlay exactly the way the hook's effect does. */
function mount(mod: Awaited<ReturnType<typeof freshModule>>, onClose: () => void) {
  return mod.openOverlay(onClose)
}

test('[BACK-CLOSES] back closes the TOP overlay, and only that one', async () => {
  const h = install()
  const mod = await freshModule()
  const closed: string[] = []

  const sheet = mount(mod, () => closed.push('sheet'))
  const confirmOnTop = mount(mod, () => closed.push('confirm'))
  assert.equal(h.stack.length, 3, 'the page plus two overlays')
  assert.deepEqual(mod.overlayStackIds().length, 2)

  h.back()
  assert.deepEqual(closed, ['confirm'], 'a confirm over a sheet must not take the sheet with it')
  confirmOnTop.unmount()          // the component unmounts in response to its own onClose
  assert.equal(mod.overlayStackIds().length, 1, 'and the sheet is still open')

  h.back()
  assert.deepEqual(closed, ['confirm', 'sheet'], 'the second press closes the sheet')
  sheet.unmount()
  assert.equal(mod.overlayStackIds().length, 0)
  assert.equal(h.i, 0, 'and we are back on the page we started from — no dead entries left')
})

test('[BACK-CLOSES] closing with the ✕ takes the entry back out', async () => {
  // The failure this prevents: the owner taps ✕, then presses back to leave the page, and nothing
  // happens — because their press was eaten by an entry belonging to an overlay that is gone.
  const h = install()
  const mod = await freshModule()
  const o = mount(mod, () => { throw new Error('back was never pressed') })
  assert.equal(h.stack.length, 2)

  o.unmount()                     // closed by the ✕ / backdrop / a finished action
  assert.equal(h.i, 0, 'the entry was popped again')
  assert.equal(mod.overlayStackIds().length, 0, 'and the overlay left the stack')

  // A back press now belongs to the page, exactly as it did before the overlay ever opened.
  let stray = false
  h.onPop = () => { stray = true }
  h.back()
  assert.equal(stray, false, 'there is nothing left to pop')
})

test('[BACK-CLOSES] a navigation while open is NOT undone', async () => {
  // The one that would be worse than the bug it fixes. An overlay routes somewhere and unmounts
  // because the page changed; popping "our" entry here would bounce the owner straight back off
  // the page they just asked for.
  const h = install()
  const mod = await freshModule()
  const o = mount(mod, () => {})
  assert.equal(h.stack.length, 2)

  h.pushState({ __next: '/dashboard/bestanden' })   // the router navigates
  assert.equal(h.i, 2)

  o.unmount()                                        // the overlay goes with the old page
  assert.equal(h.i, 2, 'the navigation stands — our entry is no longer the current state')
  assert.deepEqual(h.state, { __next: '/dashboard/bestanden' })
})

test('[BACK-CLOSES] an ordinary back press with nothing open is left alone', async () => {
  const h = install()
  const mod = await freshModule()
  // Install the listener the way the first overlay would, then close it again.
  mount(mod, () => {}).unmount()
  assert.equal(mod.overlayStackIds().length, 0)

  // With an empty stack the listener must do nothing at all — leaving the page is the correct
  // behaviour when no overlay is open, and swallowing it would trap the owner on the screen.
  h.back()
  assert.equal(mod.overlayStackIds().length, 0)
})

// ─── The gate: a new overlay must not be able to forget this ──────────────────
//
// Every overlay in the app was wired in one pass. The next one written will not be, unless
// something says so — and the symptom is not a crash or a wrong number, it is an owner pressing
// back and losing their place, which no test in this repo would ever notice.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every .tsx under src/. */
function tsxFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) out.push(p)
    }
  }
  walk('src')
  return out
}

/**
 * Overlays that deliberately do NOT close on back, each for a stated reason.
 *
 * The list is short and every entry is a case where dismissing would tell the owner something
 * untrue. A progress overlay is not a thing you close — the work behind it keeps running, so
 * hiding it would leave the app looking idle while it verifies fifty invoices.
 */
const NOT_DISMISSIBLE = [
  'bulkRunning',          // "Bezig met verifiëren…" — the run continues; hiding it would lie
  'bulkIgnoreRunning',    // idem
  'reimportAllRunning',   // idem
]

test('[BACK-CLOSES] every dismissible overlay in the app is on the back stack', () => {
  const offenders: string[] = []

  for (const f of tsxFiles()) {
    const src = readFileSync(f, 'utf8')
    const lines = src.split('\n')
    const wired = src.includes('useCloseOnBack')

    for (let i = 0; i < lines.length; i++) {
      if (!/position: *['"]fixed['"]/.test(lines[i])) continue
      const around = lines.slice(Math.max(0, i - 12), i + 6).join('\n')
      if (!/inset: *0/.test(around)) continue          // a fixed bar, not a full-screen overlay
      // The gate for this overlay, when it has one — used to allow the running-progress panels.
      const gate = lines.slice(Math.max(0, i - 14), i + 1).reverse()
        .map((l) => /\{(\w+) (?:&&|\?) \(/.exec(l)?.[1]).find(Boolean)
      if (gate && NOT_DISMISSIBLE.includes(gate)) continue
      if (!wired) offenders.push(`${f}:${i + 1}${gate ? ` (${gate})` : ''}`)
    }
  }

  assert.deepEqual(
    [...new Set(offenders)], [],
    'these full-screen overlays do not close on the system back button, so pressing back leaves ' +
      'the page behind them instead — losing the screen AND the scroll position:\n' +
      [...new Set(offenders)].map((o) => `  · ${o}`).join('\n') +
      '\n\nAdd useCloseOnBack(open, close) from @/lib/use-close-on-back, or — if it genuinely must ' +
      'not be dismissible, like a progress panel whose work keeps running — name its gate in ' +
      'NOT_DISMISSIBLE above with the reason.',
  )
})
