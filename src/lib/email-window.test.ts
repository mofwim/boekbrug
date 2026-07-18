// [BIG-MAILBOX] Pure test — run: npx tsx src/lib/email-window.test.ts
// Locks narrowOldestWindow: the binary search that picks an oldest-anchored listing window so a
// mailbox with more matching messages than one sync can page still makes progress oldest-first
// (instead of re-listing the newest ~cap forever and freezing the watermark at the floor).
import { narrowOldestWindow } from './email-integration'

let passed = 0, failed = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : '') }
}

// A synthetic mailbox = sorted message timestamps. `list(before)` returns messages in [after, before)
// (before=null ⇒ up to `now`); if a window holds more than `cap`, the provider can only return the
// NEWEST `cap` and reports the listing INCOMPLETE — exactly the real Gmail/Graph behaviour.
function makeMailbox(times: number[], cap: number, now: number) {
  let calls = 0
  const list = async (after: number, before: number | null) => {
    calls++
    const hi = before ?? now
    const inWindow = times.filter((t) => t >= after && t < hi).sort((a, b) => a - b)
    if (inWindow.length > cap) {
      // provider returns only the newest `cap`, listing incomplete
      return { items: inWindow.slice(inWindow.length - cap).map((t) => ({ t })), complete: false }
    }
    return { items: inWindow.map((t) => ({ t })), complete: true }
  }
  return { list, calls: () => calls }
}

const MIN = 60 * 60         // 1h
const ITERS = 20
const NOW = 1_000_000_000   // arbitrary fixed "now" (no Date.now — deterministic)

async function run() {
  // ── 1. Small mailbox (≤ cap): first full listing completes → NOT narrowed, all messages, no ceiling.
  {
    const after = 0
    const times = Array.from({ length: 50 }, (_, i) => 100 + i * 1000)
    const mb = makeMailbox(times, 4000, NOW)
    const r = await narrowOldestWindow<{ t: number }>({
      after, now: NOW, minWindow: MIN, maxIters: ITERS,
      list: (before) => mb.list(after, before),
    })
    check('small mailbox: not narrowed', r.narrowed === false)
    check('small mailbox: complete', r.complete === true)
    check('small mailbox: all 50 returned', r.items.length === 50)
    check('small mailbox: ceiling null (window = now)', r.ceiling === null)
    check('small mailbox: only one list call', mb.calls() === 1)
  }

  // ── 2. Big mailbox spread evenly over its lifetime (> cap): narrows to a COMPLETE, non-empty
  //       oldest slice; every returned message is older than the newest, count ≤ cap, > 0.
  {
    const after = 0
    // 9000 messages evenly from t=1000 to t=900000
    const times = Array.from({ length: 9000 }, (_, i) => 1000 + i * 100)
    const cap = 4000
    const mb = makeMailbox(times, cap, NOW)
    const r = await narrowOldestWindow<{ t: number }>({
      after, now: NOW, minWindow: MIN, maxIters: ITERS,
      list: (before) => mb.list(after, before),
    })
    check('spread backlog: narrowed', r.narrowed === true)
    check('spread backlog: complete slice', r.complete === true)
    check('spread backlog: non-empty', r.items.length > 0)
    check('spread backlog: within cap', r.items.length <= cap)
    check('spread backlog: contains the OLDEST message (anchored at after)',
      r.items.some((m) => m.t === 1000))
    check('spread backlog: ceiling set below now', r.ceiling !== null && r.ceiling! < NOW)
  }

  // ── 3. Gap + recent burst (the Finding-3 shape): a long empty gap above the floor, then a dense
  //       burst of > cap near now. Must CROSS the gap (raise the ceiling) and return the oldest of
  //       the burst — never stall on the empty slice.
  {
    const after = 0
    // empty 0..500000, then 6000 messages packed in [500000, 560000]
    const times = Array.from({ length: 6000 }, (_, i) => 500000 + i * 10)
    const cap = 4000
    const mb = makeMailbox(times, cap, NOW)
    const r = await narrowOldestWindow<{ t: number }>({
      after, now: NOW, minWindow: MIN, maxIters: ITERS,
      list: (before) => mb.list(after, before),
    })
    check('gap+burst: narrowed', r.narrowed === true)
    check('gap+burst: complete (did not stall on the empty gap)', r.complete === true)
    check('gap+burst: non-empty', r.items.length > 0)
    check('gap+burst: within cap', r.items.length <= cap)
    check('gap+burst: contains the OLDEST burst message (500000)',
      r.items.some((m) => m.t === 500000), r.items.length)
  }

  // ── 4. Pathological density: no window wider than MIN_WINDOW can hold ≤ cap messages (the mail is
  //       denser than cap-per-minWindow). No complete non-empty slice exists above the floor → returns
  //       complete=false so the caller HOLDS the mark (no false "complete", no data loss). Never
  //       infinite-loops. (Modelled with a small cap so integer-second timestamps can be dense enough.)
  {
    const after = 0
    const cap = 100
    // 5000 messages at 1/sec: any window above MIN_WINDOW (3600s) holds > 3600 ≫ cap messages, and a
    // ≤cap window is narrower than MIN_WINDOW → the search can never isolate a complete slice.
    const times = Array.from({ length: 5000 }, (_, i) => 1 + i)
    const mb = makeMailbox(times, cap, NOW)
    const r = await narrowOldestWindow<{ t: number }>({
      after, now: NOW, minWindow: MIN, maxIters: ITERS,
      list: (before) => mb.list(after, before),
    })
    check('pathological: not marked complete (mark holds)', r.complete === false, r)
    check('pathological: still flagged narrowed', r.narrowed === true)
    check('pathological: terminated within maxIters (bounded calls)', mb.calls() <= ITERS + 2, mb.calls())
  }

  // ── 5. Exactly-at-cap mailbox lists completely in one shot (boundary): not narrowed.
  {
    const after = 0
    const times = Array.from({ length: 4000 }, (_, i) => 100 + i * 100)
    const mb = makeMailbox(times, 4000, NOW)
    const r = await narrowOldestWindow<{ t: number }>({
      after, now: NOW, minWindow: MIN, maxIters: ITERS,
      list: (before) => mb.list(after, before),
    })
    check('exactly cap: not narrowed', r.narrowed === false && r.complete === true)
    check('exactly cap: all 4000 returned', r.items.length === 4000)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run()
