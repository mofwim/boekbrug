// [HERINNERING-ORIGINEEL] Pure node test — run: npx tsx src/lib/reminder-original.test.ts
//
// Twee fouten, en ze zijn NIET even erg:
//   · Een herinnering die tóch in de wachtrij landt kost één beoordeling.
//   · Een herinnering die ONTERECHT wordt overgeslagen kan het enige bewijs van een aftrekbare
//     kost zijn — want een Nederlandse betalingsherinnering herhaalt de hele factuur, en als de
//     originele mail in de spam belandde is dit alles wat de eigenaar heeft.
// Daarom: overslaan mag ALLEEN als we het origineel echt in de boeken zien staan.
import { decideReminder, reminderSkipReason } from './reminder-original'
import { isReminderFilename, isStatementFilename } from './ai'
import { normalizeInvoiceNumber } from './safecore'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

// De set wordt door de aanroeper gevuld met normalizeInvoiceNumber over de OPGESLAGEN nummers —
// hier op precies dezelfde manier opgebouwd, zodat deze test de echte situatie nabootst en niet
// een verzonnen sleutel.
const OPGESLAGEN = '2026-0041'
const HEEFT = new Set([normalizeInvoiceNumber(OPGESLAGEN)])
const LEEG: Set<string> = new Set()

console.log('\n— geen herinnering → gewoon de normale weg —')
check('niet-herinnering importeert normaal',
  decideReminder({ isReminder: false, reminderOfInvoiceNumber: '2026-0041' }, HEEFT).action === 'import')
check('ontbrekende vlag importeert normaal',
  decideReminder({}, HEEFT).action === 'import')

console.log('\n— herinnering waarvan het origineel AL geboekt is → overslaan —')
const skip = decideReminder({ isReminder: true, reminderOfInvoiceNumber: OPGESLAGEN }, HEEFT)
check('overslaan', skip.action === 'skip')
check('noemt het originele nummer', skip.action === 'skip' && skip.originalNumber === OPGESLAGEN)
check('reden legt uit waarom hij niet is geïmporteerd',
  skip.action === 'skip' && /staat al in je boekhouding/.test(skip.reason))

console.log('\n— herinnering waarvan het origineel NIET in de boeken staat → importeren, gevlagd —')
// Dit is het geval waarvoor de hele functie bestaat in plaats van "gooi herinneringen weg".
check('onbekend origineel → import-flagged',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: '2026-9999' }, HEEFT).action === 'import-flagged')
check('lege boeken → import-flagged',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: OPGESLAGEN }, LEEG).action === 'import-flagged')

console.log('\n— bij twijfel nooit overslaan —')
check('herinnering zonder nummer → import-flagged',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: null }, HEEFT).action === 'import-flagged')
check('herinnering met leeg nummer → import-flagged',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: '   ' }, HEEFT).action === 'import-flagged')

console.log('\n— nummer-opmaak: wat normalizeInvoiceNumber wél en niet gelijkmaakt —')
// Een herinnering drukt het nummer opnieuw af, soms met andere spatiëring. Dat wordt gelijkgemaakt.
check('extra witruimte rond het nummer matcht',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: '  2026-0041  ' }, HEEFT).action === 'skip')
check('witruimte BINNEN het nummer matcht ("2026 - 0041")',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: '2026 - 0041' }, HEEFT).action === 'skip')
// GRENS, bewust zo: normalizeInvoiceNumber haalt alleen witruimte weg, geen scheidingstekens. Ook
// streepjes strippen zou "2026-1" en "20261" laten samenvallen, en dat zou in het HOOFD-dedup-pad
// echte, verschillende facturen kunnen blokkeren. Een herinnering herhaalt in de praktijk hetzelfde
// gedrukte nummer, dus deze grens kost niets — en de uitkomst is de veilige kant: importeren.
check('een ANDERE scheidingsvorm matcht niet → import-flagged, niet overslaan',
  decideReminder({ isReminder: true, reminderOfInvoiceNumber: '20260041' }, HEEFT).action === 'import-flagged')

console.log('\n— reminderSkipReason —')
const why = reminderSkipReason('2026-0041')
check('noemt het nummer', why.includes('2026-0041'))
check('zegt dat het niet als tweede kost is geïmporteerd', /tweede kost/.test(why))

console.log('\n— [INCASSO-WOORDEN] de volledige Nederlandse escalatieladder —')
// Nagelopen tegen deurwaarders-/incassobronnen. Alleen de eerste twee treden stonden erin, dus
// een "sommatie.pdf" gleed langs deze backstop en kon als gewone factuur landen.
for (const naam of [
  'betalingsherinnering.pdf', 'Herinnering.pdf', 'herinneringsnota.pdf',
  'aanmaning.pdf', 'laatste aanmaning.pdf',
  'sommatie.pdf', 'Ingebrekestelling.pdf',
  'WIK-brief.pdf', '14-dagenbrief.pdf', 'aanzegging.pdf', 'incassobrief.pdf',
  'laatste waarschuwing.pdf',
  'reminder.pdf', 'payment-reminder.pdf', 'final-notice.pdf', 'dunning.pdf',
]) {
  check(`herkend: ${naam}`, isReminderFilename(naam) === true)
}

console.log('\n— en wat GEEN herinnering is, blijft dat —')
// Een gewone factuur mag deze backstop nooit raken; dan zou élke factuur gevlagd worden.
for (const naam of ['factuur-2026-0041.pdf', 'invoice.pdf', 'kassabon.jpg', 'verzamelfactuur.pdf', 'creditnota.pdf']) {
  check(`niet gevlagd: ${naam}`, isReminderFilename(naam) === false)
}

console.log('\n— statement-lijst: de overzichtsvormen —')
for (const naam of ['rekeningoverzicht.pdf', 'saldo-overzicht.pdf', 'openstaande posten.pdf',
  'overzicht openstaande facturen.pdf', 'debiteurenoverzicht.pdf', 'betalingsoverzicht.pdf']) {
  check(`herkend als overzicht: ${naam}`, isStatementFilename(naam) === true)
}
// Een verzamelfactuur is ÉÉN factuur over meerdere regels en IS boekbaar — die mag hier nooit in.
check('verzamelfactuur is geen overzicht', isStatementFilename('verzamelfactuur.pdf') === false)
check('maandoverzicht bewust NIET (vaak juist een verzamelfactuur)',
  isStatementFilename('maandoverzicht.pdf') === false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
