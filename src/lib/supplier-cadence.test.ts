// [RITME] Pure node test — run: npx tsx src/lib/supplier-cadence.test.ts
//
// Deze functie mag twee soorten fouten maken, en ze zijn NIET even erg:
//   · Een gemiste melding kost de eigenaar één keer wat voorbelasting.
//   · Een ONTERECHTE melding leert hem om meldingen weg te klikken — en dan mist hij ze allemaal.
// Daarom gaat het grootste deel van deze test over wanneer de functie haar mond moet houden.
import { assessSupplierCadence, cadenceReason, formatDutchDate } from './supplier-cadence'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

// Vier maandelijkse facturen, de laatste op 1 april.
const MAANDELIJKS = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']

console.log('\n— het geval waarvoor dit bestaat —')
// 1 april + 30 dagen ritme + coulance ≈ 8 mei. Op 20 mei is er echt iets aan de hand.
const laat = assessSupplierCadence(MAANDELIJKS, '2026-05-20')
check('maandelijkse leverancier die overslaat → melding', laat !== null)
check('herkent het ritme als maandelijks', laat?.cadence === 'maandelijks')
check('noemt de laatste factuur die we zagen', laat?.lastSeen === '2026-04-01')
check('telt de dagen dat het te laat is', (laat?.daysLate ?? 0) > 0)

console.log('\n— zwijgen: nog niets aan de hand —')
check('ruim binnen het ritme → stil', assessSupplierCadence(MAANDELIJKS, '2026-04-15') === null)
// Op dag 31 is een maandelijkse factuur niet "zoek", die is onderweg. Coulance hoort erbij.
check('één dag over de tussenpoos → nog stil (coulance)', assessSupplierCadence(MAANDELIJKS, '2026-05-02') === null)

console.log('\n— zwijgen: te weinig geschiedenis (twee facturen zijn geen ritme) —')
check('drie facturen → stil', assessSupplierCadence(['2026-02-01', '2026-03-01', '2026-04-01'], '2026-05-20') === null)
check('twee facturen → stil', assessSupplierCadence(['2026-03-01', '2026-04-01'], '2026-05-20') === null)
check('één factuur → stil', assessSupplierCadence(['2026-04-01'], '2026-05-20') === null)
check('geen facturen → stil', assessSupplierCadence([], '2026-05-20') === null)

console.log('\n— zwijgen: geen ECHT ritme —')
// Een leverancier die je onregelmatig factureert kan niets "missen".
check('onregelmatige tussenpozen → stil',
  assessSupplierCadence(['2026-01-01', '2026-01-08', '2026-03-02', '2026-04-01'], '2026-06-20') === null)
// 45 dagen valt in geen enkele bucket: niet maandelijks, niet per kwartaal.
check('ritme dat in geen bucket valt → stil',
  assessSupplierCadence(['2026-01-01', '2026-02-15', '2026-04-01', '2026-05-16'], '2026-08-20') === null)

console.log('\n— zwijgen: waarschijnlijk gestopt, niet zoek —')
// Dit is regel 3. Zonder deze grens blijft de banner tot in de eeuwigheid staan bij elke
// leverancier waar de eigenaar ooit mee stopte — en dan kijkt hij er overheen.
check('meer dan één extra cyclus stil → gestopt, geen melding meer',
  assessSupplierCadence(MAANDELIJKS, '2026-07-20') === null)
check('een jaar later → allang stil', assessSupplierCadence(MAANDELIJKS, '2027-04-01') === null)

console.log('\n— andere ritmes —')
const kwartaal = ['2025-04-01', '2025-07-01', '2025-10-01', '2026-01-01']
check('per kwartaal wordt herkend',
  assessSupplierCadence(kwartaal, '2026-05-01')?.cadence === 'per kwartaal')
const wekelijks = ['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22']
check('wekelijks wordt herkend',
  assessSupplierCadence(wekelijks, '2026-05-06')?.cadence === 'wekelijks')

console.log('\n— rommelige invoer mag nooit een melding worden —')
check('onleesbare datums → stil', assessSupplierCadence(['gisteren', '', 'x'], '2026-05-20') === null)
check('onleesbare "vandaag" → stil', assessSupplierCadence(MAANDELIJKS, 'morgen') === null)
// Twee facturen op dezelfde dag zijn één moment in het ritme; als tussenpoos van nul dagen zouden
// ze de mediaan omlaag trekken en een maandelijkse leverancier "wekelijks" maken.
check('dubbele datums tellen als één moment',
  assessSupplierCadence([...MAANDELIJKS, '2026-04-01'], '2026-05-20')?.cadence === 'maandelijks')
check('volgorde maakt niet uit',
  assessSupplierCadence([...MAANDELIJKS].reverse(), '2026-05-20')?.cadence === 'maandelijks')

console.log('\n— de tekst —')
const v = assessSupplierCadence(MAANDELIJKS, '2026-05-20')!
const zin = cadenceReason('KPN B.V.', v)
check('noemt de leverancier', zin.includes('KPN B.V.'))
check('noemt het ritme', zin.includes('maandelijks'))
check('noemt wanneer we voor het laatst iets zagen', zin.includes('1 april 2026'))
// De eigenaar moet weten wat hij kan DOEN, en waarom het de moeite is.
check('zegt wat te doen', /spam/.test(zin) && /opvragen|op te vragen|vraag/.test(zin))
check('noemt het belang: btw terugvragen', /btw/.test(zin))
check('lege naam levert nog steeds een hele zin op', cadenceReason('  ', v).startsWith('Deze leverancier'))

console.log('\n— formatDutchDate —')
check('3 maart 2026', formatDutchDate('2026-03-03') === '3 maart 2026')
check('onleesbaar → ongewijzigd terug', formatDutchDate('rommel') === 'rommel')

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
