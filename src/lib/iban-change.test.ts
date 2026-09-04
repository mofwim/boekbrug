// [IBAN-WISSEL] Pure node test — run: npx tsx src/lib/iban-change.test.ts
//
// Deze poort mag maar twee dingen fout doen, en allebei kosten geld:
//   · ZWIJGEN bij een echte wissel → de eigenaar tikt het nummer van een fraudeur over.
//   · SCHREEUWEN bij een niet-wissel → de waarschuwing wordt ruis en dan negeert hij ook de echte.
// Vandaar dat "eerste IBAN voor een bekende leverancier" expliciet GEEN wissel is.
import { assessIbanChange, formatIban, ibanChangeReason, detectIbanChange, knownIbanForVendor } from './iban-change'
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

console.log('\n— [IBAN-CHECK-HONEST] een controle die NIET kon draaien mag nooit als schoon lezen —')
{
  // Dit is de enige controle die tussen de eigenaar en een omgeleide betaling staat: bij
  // factuurfraude klopt al het andere op het papier, en het gewijzigde rekeningnummer is het enige
  // signaal dat er is. Een stil overgeslagen controle IS dus de hele blootstelling.
  //
  // De twee `if (error) throw` regels in knownIbanForVendor stonden er al — en een
  // `catch { return null }` om de hele body ving ze drie regels verderop weer op en gaf precies de
  // null terug die ze moesten voorkomen. Geen enkele test keek naar een MISLUKTE lees, dus alles
  // bleef groen. Deze stub kijkt er wel naar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (res: any) => { const o: any = { select: () => o, eq: () => o, not: () => o, order: () => o, limit: () => o, maybeSingle: async () => res }; return o }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = (res: any): any => ({ from: () => q(res) })
  const kapot = stub({ data: null, error: { message: 'connection reset' } })
  const leeg = stub({ data: null, error: null })
  const bekend = stub({ data: { iban: 'NL91ABNA0417164300' }, error: null })
  const vendor = { name: 'Dutch Sweets Company B.V.', kvk: '76895009', iban: 'NL02RABO0123456789' }

  // Geen top-level await in dit bestand (cjs-uitvoer), dus de samenvatting hangt aan deze keten.
  void (async () => {
    const mislukt = await detectIbanChange(kapot, 'u1', vendor)
    check('mislukte lees → status unavailable, niet "geen wissel"', mislukt.status === 'unavailable')

    // De andere kant: null moet nog steeds ÉÉN ding betekenen — we hebben gekeken en er staat niets.
    const eerste = await detectIbanChange(leeg, 'u1', vendor)
    check('geen nummer bekend → een uitgevoerde controle zonder melding',
      eerste.status === 'ok' && eerste.change === null)

    const wissel = await detectIbanChange(bekend, 'u1', vendor)
    check('een echte wissel wordt nog steeds gemeld met beide nummers',
      wissel.status === 'ok' && wissel.change?.from === 'NL91ABNA0417164300' && wissel.change?.to === 'NL02RABO0123456789')

    // Geen IBAN op het papier is een volledig uitgevoerde controle met een lege uitkomst — geen
    // mislukking. Anders zou elke factuur zonder rekeningnummer een fraudevlag krijgen.
    const geenNummer = await detectIbanChange(kapot, 'u1', { ...vendor, iban: null })
    check('geen IBAN op de factuur → niets te vergelijken, geen vlag',
      geenNummer.status === 'ok' && geenNummer.change === null)

    // En de bron van de waarheid: de lookup zelf moet GOOIEN, want dat is wat detectIbanChange
    // vertaalt. Vangt iemand hem ooit weer af, dan valt deze om.
    let gooide = false
    try { await knownIbanForVendor(kapot, 'u1', vendor) } catch { gooide = true }
    check('knownIbanForVendor gooit bij een mislukte lees (geen catch die hem opslokt)', gooide)

    // ── [LES-TELT-MEE] De les van de eigenaar telt mee in DEZE controle ──────────────────────
    //
    // Gemeten op productie: deze eigenaar heeft de app drie misleeswijzen geleerd — "Silifke /
    // Hocaoglu" is oz & er food b.v, "CHUR MARKT BV" en "CHLIQI MARKT BV" zijn omur MARKT BV. Geen
    // ervan sleutelt op naam naar iets, dus deze controle keek naar een leverancier die hij zelf
    // niet herkende, vond geen rekeningnummer, en meldde niets. Op precies de facturen waarvan de
    // app al WIST dat hij de afzender verkeerd leest.
    //
    // Een stub die per TABEL én per KOLOM antwoordt. De eerste versie hiervan keek alleen naar de
    // tabel, en beide lagen lezen `suppliers` — dus de naamsleutellaag gaf hetzelfde antwoord als
    // de aliaslaag en vier van deze vijf controles waren leeg: ze bleven groen met de hele
    // aliaslaag eruit gesloopt. Nu vindt alléén de aliasweg (`.eq('id', …)`) een rekeningnummer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perKolom = (byTable: Record<string, any>): any => ({
      from: (t: string) => {
        const kolommen: string[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const o: any = {
          select: () => o, not: () => o, order: () => o, limit: () => o,
          eq: (col: string) => { kolommen.push(col); return o },
          maybeSingle: async () => {
            const spec = byTable[t]
            if (!spec) return { data: null, error: null }
            return typeof spec === 'function' ? spec(kolommen) : spec
          },
        }
        return o
      },
    })
    const geleerd = {
      supplier_aliases: { data: { supplier_id: 'sup-ozer' }, error: null },
      // Alleen wie de rij bij ID opvraagt — de aliasweg — krijgt een nummer terug. De
      // naamsleutelweg kent deze misgelezen naam niet, want dat is precies de bug.
      suppliers: (cols: string[]) =>
        cols.includes('id')
          ? { data: { iban: 'NL20ABNA0458266515' }, error: null }
          : { data: null, error: null },
    }
    const misgelezen = { name: 'Silifke / Hocaoglu', kvk: null, iban: 'NL02RABO0123456789' }

    const viaLes = await detectIbanChange(perKolom(geleerd), 'u1', misgelezen)
    check('een geleerde misleeswijze vindt het rekeningnummer van de ECHTE leverancier',
      viaLes.status === 'ok' && viaLes.change?.from === 'NL20ABNA0458266515'
        && viaLes.change?.to === 'NL02RABO0123456789')

    // De tegenproef: zonder de les kent de controle deze naam niet, en zwijgt hij — dat was de bug.
    const zonderLes = await detectIbanChange(
      perKolom({ supplier_aliases: { data: null, error: null }, suppliers: { data: null, error: null } }),
      'u1', misgelezen)
    check('zonder les valt er niets te melden — dat is de toestand die dit repareert',
      zonderLes.status === 'ok' && zonderLes.change === null)

    // Een gewoon woord is nog geen placeholder: "ketel" is precies de half getypte naam waarvoor
    // deze les bestaat, en die moet hem gewoon halen.
    const kortMaarEcht = await detectIbanChange(perKolom(geleerd), 'u1', { name: 'ketel', kvk: null, iban: 'NL02RABO0123456789' })
    check('een korte maar echte naam vindt de les gewoon',
      kortMaarEcht.status === 'ok' && kortMaarEcht.change?.from === 'NL20ABNA0458266515')

    // En de grens die deze les NIET mag overschrijden. "Onbekende afzender" is wat /api/intake
    // schrijft als de lezer geen afzender vond — dat mislukt op een slechte foto, niet op een
    // bepaalde leverancier. Zou die sleutel meetellen, dan kreeg elke onleesbare factuur in het
    // boek het rekeningnummer van één bedrijf, en dus ook zijn plek in de crediteurenstand.
    const placeholder = await detectIbanChange(
      perKolom(geleerd), 'u1', { name: 'Onbekende afzender', kvk: null, iban: 'NL02RABO0123456789' })
    check('een placeholder-naam haalt de les NIET op — anders erft elke onleesbare factuur hem',
      placeholder.status === 'ok' && placeholder.change === null)

    // En de regel van dit hele bestand: een MISLUKTE aliaslees is geen "niets geleerd".
    const aliasKapot = perKolom({ supplier_aliases: { data: null, error: { message: 'connection reset' } } })
    check('een mislukte aliaslees → unavailable, nooit een stil groen',
      (await detectIbanChange(aliasKapot, 'u1', misgelezen)).status === 'unavailable')

    // De tabel bestaat nog niet (42P01) is wél "niets geleerd": zo stond elke database erbij
    // voordat supplier_aliases.sql werd toegepast, en dat is geen mislukte lees.
    const geenTabel = perKolom({
      supplier_aliases: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
      // Hier moet juist de NAAMSLEUTELweg antwoorden: de aliastabel bestaat niet.
      suppliers: (cols: string[]) =>
        cols.includes('name_key')
          ? { data: { iban: 'NL91ABNA0417164300' }, error: null }
          : { data: null, error: null },
    })
    const zonderTabel = await detectIbanChange(geenTabel, 'u1',
      { name: 'Dutch Sweets Company B.V.', kvk: null, iban: 'NL02RABO0123456789' })
    check('een ontbrekende aliastabel valt door naar de naamsleutel, en meldt gewoon',
      zonderTabel.status === 'ok' && zonderTabel.change?.from === 'NL91ABNA0417164300')


    // ── [EERSTE-KEER] "Er valt niets te vergelijken" is een eigen antwoord ────────────────────
    //
    // change === null betekende twee dingen tegelijk: "vergeleken en gelijk" en "we hadden niets om
    // mee te vergelijken". Downstream werd dat één leeg safecore, en dus een groen vinkje met
    // "ongewijzigd ten opzichte van eerdere facturen" op de eerste factuur van een leverancier —
    // over eerdere facturen die niet bestaan. Gemeten: 72 facturen, € 63.128,41.
    const nieuweLeverancier = await detectIbanChange(leeg, 'u1', vendor)
    check('een leverancier zonder nummer op de plank → eerste keer, geen schone vergelijking',
      nieuweLeverancier.status === 'ok' && nieuweLeverancier.change === null
        && nieuweLeverancier.firstSeen === true)

    const bekendeLeverancier = await detectIbanChange(
      bekend, 'u1', { ...vendor, iban: 'NL91ABNA0417164300' })
    check('een leverancier die we al betaalden op DIT nummer → echt vergeleken, niet de eerste keer',
      bekendeLeverancier.status === 'ok' && bekendeLeverancier.change === null
        && bekendeLeverancier.firstSeen === false)

    // Geen nummer op het papier is niets om de eerste van te zijn: de rij erboven zegt al dat er
    // geen rekeningnummer op deze factuur staat.
    const geenNummerOpPapier = await detectIbanChange(leeg, 'u1', { ...vendor, iban: null })
    check('geen nummer op de factuur is geen eerste waarneming',
      geenNummerOpPapier.status === 'ok' && geenNummerOpPapier.firstSeen === false)

    console.log(`\n${passed} passed, ${failed} failed\n`)
    process.exit(failed === 0 ? 0 : 1)
  })()
}
