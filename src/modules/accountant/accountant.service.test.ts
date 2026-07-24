// [AANGIFTE-AGENDA] Pure node test — run: npx tsx src/modules/accountant/accountant.service.test.ts
// Pins the BTW filing-deadline logic (Belastingdienst = last day of the month
// AFTER the quarter) and the previous-quarter wrap. These feed the agenda's
// countdown, so a wrong date would mislead an accountant about a real deadline.

import {
  getAangifteDeadline,
  getPreviousQuarter,
  daysUntil,
} from './accountant.service'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

console.log('\n— BTW deadline = last day of the month after the quarter —')
check('Q1 → 30 apr', getAangifteDeadline(2026, 1) === '2026-04-30')
check('Q2 → 31 jul', getAangifteDeadline(2026, 2) === '2026-07-31')
check('Q3 → 31 okt', getAangifteDeadline(2026, 3) === '2026-10-31')
check('Q4 → 31 jan (next year)', getAangifteDeadline(2026, 4) === '2027-01-31')

console.log('\n— previous quarter wraps the year at Q1 —')
check('prev(2026,Q1) = 2025 Q4', (() => { const p = getPreviousQuarter(2026, 1); return p.year === 2025 && p.quarter === 4 })())
check('prev(2026,Q3) = 2026 Q2', (() => { const p = getPreviousQuarter(2026, 3); return p.year === 2026 && p.quarter === 2 })())

console.log('\n— daysUntil is inclusive-of-today and signed —')
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
check('today → 0', daysUntil(today) === 0)
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
const tomorrowIso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
check('tomorrow → 1', daysUntil(tomorrowIso) === 1)
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
const yesterdayIso = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`
check('yesterday → -1 (overdue)', daysUntil(yesterdayIso) === -1)

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
