// [DEDUP-CORRECTED] Pure node test — run: npx tsx src/lib/possible-duplicate-collect.test.ts
// Guards the I/O glue around assessPossibleDuplicate: it now runs TWO lookups, and the second
// one (same invoice number, ANY amount) is the only reason a corrected re-issue can be seen at
// all. The pure assessor is tested in possible-duplicate.test.ts; what is at stake here is
// whether its candidates arrive — and whether they arrive exactly once.

import { collectPossibleDuplicate } from './possible-duplicate-collect'
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

  console.log('\n— best-effort: neither lookup may break an import —')
  {
    const r = await collectPossibleDuplicate(input(), none, async () => { throw new Error('db down') })
    check('a failing by-number query degrades to no flag', r === null)
  }
  {
    const r = await collectPossibleDuplicate(
      input(),
      async () => { throw new Error('db down') },
      async () => [cand()],
    )
    check('a failing by-total query short-circuits, as before', r === null)
  }
  {
    const r = await collectPossibleDuplicate(input({ totalIncBtw: null }), none, async () => [cand()])
    check('no usable total → no assessment at all', r === null)
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

run()
