// [DEDUP-CORRECTED] Pure node test — run: npx tsx src/lib/possible-duplicate-collect.test.ts
// Guards the I/O glue around assessPossibleDuplicate: it now runs TWO lookups, and the second
// one (same invoice number, ANY amount) is the only reason a corrected re-issue can be seen at
// all. The pure assessor is tested in possible-duplicate.test.ts; what is at stake here is
// whether its candidates arrive — and whether they arrive exactly once.

import { collectPossibleDuplicate, mergePossibleDuplicate, clearPossibleDuplicate, markDuplicateCheckUnavailable } from './possible-duplicate-collect'
import { classifyImportHealth } from './import-health'
import type { PossibleDupCandidate, SemanticDedupInput } from './safecore'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

const input = (o: Partial<SemanticDedupInput> = {}): SemanticDedupInput => ({
  invoiceNumber: '26302050', vendor: 'Atapack B.V.', totalIncBtw: 5900, invoiceDate: '2026-05-11', ...o,
})
const cand = (o: Partial<PossibleDupCandidate> = {}): PossibleDupCandidate => ({
  id: 'inv-1', invoice_number: '26302050', client_name: 'Atapack', invoice_date: '2026-05-07', total_inc_btw: 6662.8, ...o,
})
const none = async () => []

async function run() {
  console.log('\n— the by-number lookup is what makes a corrected re-issue visible —')
  {
    // The by-total query cannot return it by construction: a correction is the one case where the
    // amounts differ. Without the second lookup there is nothing to assess.
    const r = await collectPossibleDuplicate(input(), none)
    check('by-total alone finds nothing', r === null)

    const r2 = await collectPossibleDuplicate(input(), none, async () => [cand()])
    check('by-number lookup surfaces it', !!r2 && r2.match.id === 'inv-1')
  }

  console.log('\n— the second lookup is asked for the RIGHT number —')
  {
    let asked: string | null = null
    await collectPossibleDuplicate(input({ invoiceNumber: '  26302050 ' }), none, async (n) => { asked = n; return [] })
    check('trimmed before it reaches the query', asked === '26302050')
  }
  {
    let called = false
    await collectPossibleDuplicate(input({ invoiceNumber: '' }), none, async () => { called = true; return [] })
    check('no number → the query is never run', called === false)
  }

  console.log('\n— a candidate returned by BOTH lookups is counted once —')
  {
    // The overlap is real: an invoice with the same number AND the same total satisfies both
    // queries. Passing it twice would give looksLikeRecurringSeries a phantom extra moment and
    // could suppress a genuine flag — the dangerous direction.
    const both = cand({ id: 'same', total_inc_btw: 5900 })
    const r = await collectPossibleDuplicate(input(), async () => [both], async () => [both])
    check('de-duplicated by id, still flagged once', r?.match.id === 'same')
  }

  console.log('\n— best-effort, ASKED FOR BY NAME: neither lookup may break a queued import —')
  {
    const r = await collectPossibleDuplicate(
      input(), none, async () => { throw new Error('db down') }, { bestEffort: true })
    check('a failing by-number query degrades to no flag', r === null)
  }
  {
    const r = await collectPossibleDuplicate(
      input(),
      async () => { throw new Error('db down') },
      async () => [cand()],
      { bestEffort: true },
    )
    check('a failing by-total query short-circuits', r === null)
  }
  {
    const r = await collectPossibleDuplicate(input({ totalIncBtw: null }), none, async () => [cand()])
    check('no usable total → no assessment at all', r === null)
  }

  console.log('\n— and WITHOUT it, a failed read is not an answer —')
  {
    // The failure this closes. /api/bank/attach-invoice books straight to 'paid': no verify queue
    // behind it, no later moment where anyone looks. So it throws inside its callbacks and wraps
    // the call in a try/catch that answers 503 "we konden nu niet nakijken". That catch could never
    // fire — the throw died one frame in, here, and null reads as "no look-alike found", so the
    // route carried on and booked the payment. A second copy of a bill, paid, silently.
    let threw = false
    try {
      await collectPossibleDuplicate(input(), async () => { throw new Error('db down') }, async () => [])
    } catch { threw = true }
    check('a failing by-total read propagates when best-effort was NOT asked for', threw)

    let threw2 = false
    try {
      await collectPossibleDuplicate(input(), none, async () => { throw new Error('db down') })
    } catch { threw2 = true }
    check('…and so does the by-number read, which feeds the corrected-re-issue tier alone', threw2)

    // The direction that matters: forgetting the option must fail the import, never book a
    // duplicate. That is why the default is to throw and the swallow is opt-in.
    check('the swallow is opt-in, so forgetting it fails CLOSED', threw && threw2)
  }
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // [SUPERSEDE] mergePossibleDuplicate writes the keys the queue reads. The id among them is what
  // the "Deze vervangt factuur X" button acts on, and it is the one key that CANNOT be recovered
  // from anything else on the row — `_of` falls back to a vendor name and an invoice number is
  // not unique across suppliers, so neither can select a row. Every ingestion path must go
  // through this helper; the e-mail sync once wrote these keys by hand and silently missed the id.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n— the stored flag carries an ACTIONABLE target —')
  {
    const merged = mergePossibleDuplicate(null, {
      match: { id: 'inv-42', invoice_number: '26302050', client_name: 'Atapack' },
      reason: 'zelfde factuurnummer, ander bedrag — mogelijk een gecorrigeerde versie',
    }) as { _safecore?: Record<string, unknown> }
    const s = merged._safecore ?? {}
    check('possible_duplicate is set', s.possible_duplicate === true)
    check('the id is stored — the button has something exact to act on', s.possible_duplicate_id === 'inv-42')
    check('the display label is the number', s.possible_duplicate_of === '26302050')
    check('the reason survives', typeof s.possible_duplicate_reason === 'string')
  }
  {
    // A match with NO invoice number: the label falls back to the vendor, but the id must still
    // be the id — that fallback is exactly why the button may never resolve by label.
    const merged = mergePossibleDuplicate(null, {
      match: { id: 'inv-7', invoice_number: null, client_name: 'Atapack B.V.' },
      reason: 'zelfde bedrag en datum',
    }) as { _safecore?: Record<string, unknown> }
    const s = merged._safecore ?? {}
    check('label falls back to the vendor name', s.possible_duplicate_of === 'Atapack B.V.')
    check('the id does NOT fall back to anything', s.possible_duplicate_id === 'inv-7')
  }
  {
    // Existing _safecore content (the arithmetic verdict) must survive the merge untouched.
    const merged = mergePossibleDuplicate(
      { _safecore: { arithmetic_ok: false, reason: 'excl + btw ≠ incl' }, vendor: 0.9 },
      { match: { id: 'inv-9', invoice_number: 'F-1', client_name: 'X' }, reason: 'r' },
    ) as { _safecore?: Record<string, unknown>; vendor?: number }
    check('sibling _safecore keys survive', merged._safecore?.arithmetic_ok === false)
    check('flat AI confidences survive', merged.vendor === 0.9)
  }
  {
    check('no match → nothing invented', mergePossibleDuplicate(null, null) === null)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // [SUPERSEDE] clearPossibleDuplicate is the inverse, and the destructive direction: it edits a
  // jsonb blob that also holds the arithmetic verdict, an IBAN change and a reminder marker. None
  // of those is answered by an answer about duplication, so dropping one would silently take a
  // real warning off an invoice nobody looks at again.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n— clearing the flag removes the signal and NOTHING else —')
  {
    const flagged = mergePossibleDuplicate(
      { _safecore: { arithmetic_ok: false, reason: 'excl + btw != incl', held_at: 'x', iban_changed: true, reminder: true }, vendor: 0.9 },
      { match: { id: 'inv-42', invoice_number: 'F-1', client_name: 'V' }, reason: 'r' },
    )
    const cleared = clearPossibleDuplicate(flagged) as { _safecore?: Record<string, unknown>; vendor?: number }
    const sc = cleared?._safecore ?? {}
    check('possible_duplicate is gone', !('possible_duplicate' in sc))
    check('the actionable id is gone', !('possible_duplicate_id' in sc))
    check('the label is gone', !('possible_duplicate_of' in sc))
    check('the reason is gone', !('possible_duplicate_reason' in sc))
    check('the arithmetic verdict SURVIVES', sc.arithmetic_ok === false && sc.reason === 'excl + btw != incl')
    check('held_at survives', sc.held_at === 'x')
    check('an IBAN change survives', sc.iban_changed === true)
    check('a reminder marker survives', sc.reminder === true)
    check('flat AI confidences survive', cleared?.vendor === 0.9)
  }
  {
    // Round trip: writing then clearing must land back on the untouched original.
    const before = { _safecore: { arithmetic_ok: true }, vendor: 0.5 }
    const flagged = mergePossibleDuplicate(before, { match: { id: 'i', invoice_number: 'n', client_name: 'c' }, reason: 'r' })
    check('write-then-clear is a round trip', JSON.stringify(clearPossibleDuplicate(flagged)) === JSON.stringify(before))
  }
  {
    check('nothing to clear -> null, not a fake success', clearPossibleDuplicate(null) === null)
    check('a non-object is not treated as a blob', clearPossibleDuplicate('nope') === null)
    check('an array is not treated as a blob', clearPossibleDuplicate([1, 2]) === null)
  }
  {
    // A row with no _safecore at all must not gain junk, and must not throw.
    const cleared = clearPossibleDuplicate({ vendor: 0.7 }) as { _safecore?: Record<string, unknown>; vendor?: number }
    check('a blob without _safecore survives intact', cleared?.vendor === 0.7 && Object.keys(cleared?._safecore ?? {}).length === 0)
  }
  {
    // Clearing twice is a no-op, so a retried request cannot do extra damage.
    const once = clearPossibleDuplicate({ _safecore: { possible_duplicate: true, arithmetic_ok: true } })
    check('clearing is idempotent', JSON.stringify(clearPossibleDuplicate(once)) === JSON.stringify(once))
  }

  // ── [DEDUP-READ-HONEST] a duplicate check that could not RUN ──
  // `data ?? []` turned a failed read into "there is nothing there", and a second copy of a bill
  // entered the books with its cost and its voorbelasting counted twice.
  console.log('\n— a failed duplicate check is not a clean one —')
  {
    const fc = markDuplicateCheckUnavailable({ vendor: 0.9 }) as Record<string, unknown>
    const sc = fc._safecore as Record<string, unknown>
    check('the invoice is held for a human glance', sc.possible_duplicate === true)
    check('and says why, in words the owner reads', /dubbelcheck/.test(String(sc.possible_duplicate_reason)))
    // There was no match, so there is no invoice to name and no id to act on.
    check('it names no invoice it never found', sc.possible_duplicate_of === undefined && sc.possible_duplicate_id === undefined)
    check('the rest of field_confidence survives', fc.vendor === 0.9)

    // collectPossibleDuplicate runs TWO probes. If the first FOUND a look-alike and the second then
    // failed, the named reason is strictly more useful than "we could not check".
    const found = { _safecore: { possible_duplicate: true, possible_duplicate_of: 'F-2001', possible_duplicate_reason: 'zelfde bedrag en datum' } }
    const after = markDuplicateCheckUnavailable(found) as Record<string, unknown>
    const asc = after._safecore as Record<string, unknown>
    check('a real find is never overwritten', asc.possible_duplicate_of === 'F-2001' && asc.possible_duplicate_reason === 'zelfde bedrag en datum')

    let allShapes = true
    for (const bad of [null, undefined, 'nonsense', 42, []]) {
      const out = markDuplicateCheckUnavailable(bad) as Record<string, unknown>
      if ((out._safecore as Record<string, unknown>)?.possible_duplicate !== true) allShapes = false
    }
    check('it copes with whatever field_confidence happens to be', allShapes)

    // The point of the flag is the CONSEQUENCE: needs-review, so "Selecteer klaar" skips it.
    const health = classifyImportHealth({
      total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
      invoice_number: 'RE1', invoice_date: '2026-03-01',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      field_confidence: markDuplicateCheckUnavailable(null) as any,
    })
    check('it reaches the health verdict the queue reads', health.level === 'needs-review' && health.flags.possibleDuplicate === true)
    check('and the card explains the risk', /dubbele boeking/.test(health.reasons.join(' · ')))
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

run()
