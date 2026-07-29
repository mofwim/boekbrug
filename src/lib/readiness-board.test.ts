// [CI] Verplaatst uit src/modules/accountant/. Het project draait alleen `src/lib/*.test.ts`
// (vlak), dus alles wat deze twee bestanden vastpinden werd NOOIT uitgevoerd — inclusief
// de kwartaalregels waar het werkbord op leunt. Beide zijn puur; alleen de importpaden
// zijn aangepast.
// [KLAAR-OVERZICHT] Pure node test — run: npx tsx src/modules/accountant/readiness-board.test.ts
// Pins the board aggregation: every row lands in exactly one bucket, and the
// "Actie nodig" filter never hides an unknown-status client.

import { summarizeBoard, needsAction, type BoardRow } from "../modules/accountant/readiness-board"

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

const rows: BoardRow[] = [
  { id: 'a', name: 'A', state: 'ok', status: 'ready', score: 100, missingCount: 0, riskCount: 0 },
  { id: 'b', name: 'B', state: 'ok', status: 'almost', score: 80, missingCount: 2, riskCount: 1 },
  { id: 'c', name: 'C', state: 'ok', status: 'attention', score: 40, missingCount: 5, riskCount: 0 },
  { id: 'd', name: 'D', state: 'ok', status: 'attention', score: 30, missingCount: 6, riskCount: 2 },
  { id: 'e', name: 'E', state: 'loading' },
  { id: 'f', name: 'F', state: 'error' },
]

console.log('\n— every row lands in exactly one bucket —')
const s = summarizeBoard(rows)
check('total = 6', s.total === 6)
check('ready = 1', s.ready === 1)
check('almost = 1', s.almost === 1)
check('attention = 2', s.attention === 2)
check('loading = 1', s.loading === 1)
check('error = 1', s.error === 1)
check('buckets sum to total', s.ready + s.almost + s.attention + s.loading + s.error === s.total)

console.log('\n— actionNeeded counts loaded-not-ready only —')
check('actionNeeded = 3 (almost + 2×attention)', s.actionNeeded === 3)

console.log('\n— needsAction: ready is done, everything else stays visible —')
check('ready → false', needsAction(rows[0]) === false)
check('almost → true', needsAction(rows[1]) === true)
check('attention → true', needsAction(rows[2]) === true)
check('loading → true (status unknown, never hidden)', needsAction(rows[4]) === true)
check('error → true (status unknown, never hidden)', needsAction(rows[5]) === true)

console.log('\n— empty board —')
const empty = summarizeBoard([])
check('empty total = 0', empty.total === 0)
check('empty actionNeeded = 0', empty.actionNeeded === 0)

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
