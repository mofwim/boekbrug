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
// [TZ] Dezelfde klok als daysUntil — zie het blok verderop.
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
// [TZ] "Vandaag" komt uit amsterdamToday(), dezelfde bron die daysUntil zelf gebruikt.
//
// Deze drie regels bouwden hun eigen `today` uit de LOKALE klok van de machine. Op een UTC-server
// is dat tussen 22:00 en 24:00 UTC in de zomertijd nog gisteren, terwijl daysUntil al morgen telt
// — en dan is deze suite twee uur per nacht rood, elke nacht, zonder dat er iets stuk is.
//
// Dat is precies de fout waar de functie zelf tegen beschermt: de kop van daysUntil beschrijft
// hem woordelijk ("op een UTC-server was `today` tussen middernacht en 01:00/02:00 Amsterdam nog
// gisteren"). De test maakte hem daarna zelf. Een suite die 's nachts rood staat is een suite die
// mensen leren wegklikken, en dan glipt de echte rode er een keer doorheen.
const pad = (n: number) => String(n).padStart(2, '0')
const today = amsterdamToday()
check('today → 0', daysUntil(today) === 0)
const [jaar, maand, dag] = today.split('-').map(Number)
// Rekenen in UTC, niet lokaal: new Date(y, m, d+1) is 23 of 25 uur op een zomertijdgrens en kan
// dan op dezelfde kalenderdag uitkomen.
const verschuif = (n: number) => {
  const t = new Date(Date.UTC(jaar, maand - 1, dag + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
const tomorrowIso = verschuif(1)
check('tomorrow → 1', daysUntil(tomorrowIso) === 1)
const yesterdayIso = verschuif(-1)
check('yesterday → -1 (overdue)', daysUntil(yesterdayIso) === -1)

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
