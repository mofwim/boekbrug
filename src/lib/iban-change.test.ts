// [IBAN-WISSEL] Pure node test — run: npx tsx src/lib/iban-change.test.ts
//
// Deze poort mag maar twee dingen fout doen, en allebei kosten geld:
//   · ZWIJGEN bij een echte wissel → de eigenaar tikt het nummer van een fraudeur over.
//   · SCHREEUWEN bij een niet-wissel → de waarschuwing wordt ruis en dan negeert hij ook de echte.
// Vandaar dat "eerste IBAN voor een bekende leverancier" expliciet GEEN wissel is.
import { assessIbanChange, formatIban, ibanChangeReason } from './iban-change'
import { classifyImportHealth } from './import-health'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

const GOOD = 'NL01GOOD0123456789'
const EVIL = 'NL99EVIL9876543210'

console.log('\n— assessIbanChange (alleen een ECHTE wissel telt) —')
check('ander nummer → wissel, met beide kanten',
  JSON.stringify(assessIbanChange(EVIL, GOOD)) === JSON.stringify({ from: GOOD, to: EVIL }))
check('zelfde nummer → geen wissel', assessIbanChange(GOOD, GOOD) === null)
check('zelfde nummer, andere opmaak/spaties/kleine letters → geen wissel',
  assessIbanChange('nl01 good 0123 4567 89', GOOD) === null)
check('nog geen bekend IBAN → geen wissel (registratie wordt rijker, geen alarm)',
  assessIbanChange(EVIL, null) === null)
check('geen IBAN op de factuur → geen wissel (niets om mee te vergelijken)',
  assessIbanChange(null, GOOD) === null)
check('allebei leeg → geen wissel', assessIbanChange('', '  ') === null)

console.log('\n— formatIban (leesbaar naast elkaar zetten) —')
check('blokken van vier', formatIban('NL01GOOD0123456789') === 'NL01 GOOD 0123 4567 89')

console.log('\n— ibanChangeReason (de zin moet de eigenaar redden) —')
const reason = ibanChangeReason({ from: GOOD, to: EVIL })
check('noemt BEIDE nummers, zodat vergelijken mogelijk is',
  reason.includes(formatIban(GOOD)) && reason.includes(formatIban(EVIL)))
check('zegt: controleer vóór je betaalt', /vóór je betaalt/.test(reason))
// Het gevaarlijkste advies is "bel de leverancier" zonder erbij te zeggen wélk nummer — dan belt
// hij het nummer op de vervalste factuur en krijgt hij de fraudeur aan de lijn.
check('waarschuwt expliciet tegen het telefoonnummer op DEZE factuur',
  /zelf opzoekt/.test(reason) && /niet het nummer op deze factuur/.test(reason))

console.log('\n— health: een gewisseld IBAN is nooit "clean" —')
const base = {
  total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
  invoice_date: '2026-03-01', invoice_number: '2026-0041', invoice_type: 'factuur',
}
const cleanRow = classifyImportHealth({ ...base, field_confidence: null })
check('controle: dezelfde factuur ZONDER wissel is clean', cleanRow.level === 'clean')

const switched = classifyImportHealth({
  ...base,
  field_confidence: { _safecore: { iban_changed: true, iban_changed_from: GOOD, iban_changed_to: EVIL } },
})
check('met wissel → needs-review', switched.level === 'needs-review')
check('vlag staat aan', switched.flags.ibanChanged === true)
check('reden noemt beide nummers', switched.reasons.some((r) => r.includes(formatIban(GOOD)) && r.includes(formatIban(EVIL))))
// Alles klopt behalve het rekeningnummer — dat is precies de vorm van factuurfraude, en de reden
// dat deze as bestaat: zonder hem geeft élke andere poort groen.
check('geen enkele ANDERE vlag staat aan (de rekensom klopt juist wél)',
  !switched.flags.arithmetic && !switched.flags.vendor &&
  !switched.flags.invoiceNumber && !switched.flags.invoiceDate)

const noNumbers = classifyImportHealth({ ...base, field_confidence: { _safecore: { iban_changed: true } } })
check('wissel zonder bewaarde nummers → nog steeds needs-review met bruikbare tekst',
  noNumbers.level === 'needs-review' && noNumbers.reasons.some((r) => /rekeningnummer/.test(r) && /zelf opzoekt/.test(r)))

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
