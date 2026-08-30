// [CI] Verplaatst uit src/modules/accountant/. Het project draait alleen `src/lib/*.test.ts`
// (vlak), dus alles wat deze twee bestanden vastpinden werd NOOIT uitgevoerd — inclusief
// de kwartaalregels waar het werkbord op leunt. Beide zijn puur; alleen de importpaden
// zijn aangepast.
// [AANGIFTE-AGENDA] Pure node test — run: npx tsx src/modules/accountant/accountant.service.test.ts
// Pins the BTW filing-deadline logic (Belastingdienst = last day of the month
// AFTER the quarter) and the previous-quarter wrap. These feed the agenda's
// countdown, so a wrong date would mislead an accountant about a real deadline.

import {
  getAangifteDeadline,
  getPreviousQuarter,
  daysUntil,
} from "../modules/accountant/accountant.service"
import { amsterdamToday } from "./format-nl"

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
// [TZ] "Today" here must be the OWNER's day, exactly as daysUntil defines it. This block used to
// build it from `new Date()` — the SERVER's day — and #285 then moved the implementation onto
// Europe/Amsterdam without moving the test with it. The two agree for 22 hours a day and disagree
// for the other two: between 22:00 UTC (23:00 in winter) and midnight, Amsterdam is already
// tomorrow, so all three checks below were off by one and the whole gate set went red. A test that
// only fails at night is worse than no test — it teaches whoever meets it that gates are noise.
//
// Anchoring on amsterdamToday() is not the test marking its own homework: what is being asserted
// is the SHAPE of the answer (0 today, +1 tomorrow, -1 yesterday, signed), and the shape is what
// the countdown in front of a verzuimboete depends on.
const todayNl = amsterdamToday()
const shiftDays = (iso: string, delta: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}
check('today → 0', daysUntil(todayNl) === 0)
check('tomorrow → 1', daysUntil(shiftDays(todayNl, 1)) === 1)
check('yesterday → -1 (overdue)', daysUntil(shiftDays(todayNl, -1)) === -1)

console.log('\n— het aftellen loopt lineair door over maand-, jaar- en schrikkeljaargrenzen —')
// Clock-free by construction: a DIFFERENCE of two daysUntil calls cancels "today", so these hold
// at any hour of any day.
//
// Be precise about what they are worth. They do NOT catch the historical bug — that one was the
// timezone anchor, and it is pinned where it can actually be controlled: format-nl.test.ts feeds
// amsterdamToday() fixed instants, including "22:00 UTC in summer IS already tomorrow in
// Amsterdam", which is the exact instant that made this file fail. Nor do they catch the DST
// arithmetic the #285 message mentions: the old Math.round form absorbs a ±1h error out of 24
// perfectly well, and returns the same answer as the current one on every pair below (checked by
// substituting it back, with round, floor and trunc — all three still pass).
//
// What they DO pin is that a day is a day: a rewrite that sums month lengths, hard-codes 365, or
// gets a leap year wrong fails here and nowhere else in this file.
const span = (from: string, to: string) => daysUntil(to) - daysUntil(from)
check('over de jaarwisseling heen: 31 dec → 1 jan is één dag', span('2026-12-31', '2027-01-01') === 1)
check('een heel schrikkeljaar telt 366 dagen', span('2028-01-01', '2029-01-01') === 366)
check('en een gewoon jaar 365', span('2027-01-01', '2028-01-01') === 365)
check('februari in een schrikkeljaar heeft 29 dagen', span('2028-02-01', '2028-03-01') === 29)

console.log('\n— [KWARTAAL] bord en landingspagina moeten hetzelfde kwartaal bedoelen —')
// De regressie die dit bestand had moeten tegenhouden en niet kon, omdat het buiten de
// CI-glob stond. De boekhouders-landingspagina gebruikte getCurrentQuarter (het LOPENDE
// kwartaal) terwijl de agenda getActiveAangifte gebruikt (het AANGIFTE-kwartaal). Op
// 26 juli beschreef de landingspagina dus Q3 — 26 dagen oud en zo goed als leeg — terwijl
// de deadline-hero aftelde naar de Q2-aangifte van 31 juli.

check(
  'op 26 juli (Q3) is het aan te geven kwartaal Q2',
  JSON.stringify(getPreviousQuarter(2026, 3)) === JSON.stringify({ year: 2026, quarter: 2 })
)
check(
  'en de deadline daarvan is 31 juli — waar de hero naar aftelt',
  getAangifteDeadline(2026, 2) === '2026-07-31'
)
check(
  'in januari is het aan te geven kwartaal Q4 van het VORIGE jaar',
  JSON.stringify(getPreviousQuarter(2026, 1)) === JSON.stringify({ year: 2025, quarter: 4 })
)
check(
  'en die deadline valt in het nieuwe jaar: 31 januari',
  getAangifteDeadline(2025, 4) === '2026-01-31'
)

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
