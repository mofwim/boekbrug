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

console.log('\n— het aftellen loopt lineair door over maand-, jaar- en schrikkeljaargrenzen —')
// Twee checks van de andere kant van deze merge staan hier NIET meer, en dat is een keuze, geen
// merge-ongeluk. De ene was `daysUntil(verschuif(0)) === daysUntil(today)` — verschuif(0) IS
// today, dus die regel slaagt onder elke implementatie, ook een kapotte. De andere rekende
// Date.UTC(2028, 1, 29) uit zonder daysUntil aan te roepen: die test Node, niet ons.
//
// Wat ze BEDOELDEN — maandgrens en schrikkeldag — staat er nog, maar dan door de functie zelf
// heen. Clock-free by construction: een VERSCHIL van twee daysUntil-aanroepen laat "vandaag"
// wegvallen, dus dit klopt op elk uur van elke dag.
//
// Wees precies over wat ze waard zijn. Ze vangen de historische fout NIET — die zat in de
// tijdzone-anker, en die is vastgepind waar hij echt te sturen is: format-nl.test.ts voert
// amsterdamToday() vaste momenten, waaronder "22:00 UTC in summer IS already tomorrow in
// Amsterdam" — precies het moment waarop dit bestand omviel. Ze vangen ook de zomertijd-rekenkunde
// uit de #285-tekst niet: de oude Math.round-vorm slikt een fout van ±1 uur op 24 moeiteloos en
// geeft op elk paar hieronder hetzelfde antwoord als de huidige (nagerekend door hem terug te
// zetten, met round, floor én trunc — alle drie blijven groen).
//
// Wat ze WEL vastleggen: een dag is een dag. Een herschrijving die maandlengtes optelt, 365
// hard-codeert of een schrikkeljaar mist, valt hier om en nergens anders in dit bestand — met
// naam en toenaam op twee regels.
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
