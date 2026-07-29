// [AFZENDERREGEL] Pure node test — run: npx tsx src/lib/sender-rules.test.ts
//
// Dit is het enige mechanisme in de app dat facturen ONGEZIEN wegneemt. De gevaarlijke fout is
// niet "te weinig overslaan" — dat merk je meteen. Het is "te veel overslaan": een echte factuur
// die nooit in de wachtrij verschijnt, waarvan je pas bij de aangifte merkt dat de voorbelasting
// mist. Vandaar dat elke test hier één kant op streng is: liever geen match dan een verkeerde.
import {
  normalizeSenderEmail,
  senderIsBlocked,
  mayOfferSenderRule,
  blockedSenderSkipReason,
} from './sender-rules'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

console.log('\n— normalizeSenderEmail (opslaan en matchen moeten dezelfde vorm gebruiken) —')
check('haalt het adres uit een From-kop',
  normalizeSenderEmail('"KPN Zakelijk" <noreply@kpn.com>') === 'noreply@kpn.com')
check('hoofdletters weg — anders matcht dezelfde afzender morgen niet',
  normalizeSenderEmail('<NoReply@KPN.com>') === 'noreply@kpn.com')
check('kaal adres mag ook', normalizeSenderEmail('  noreply@kpn.com  ') === 'noreply@kpn.com')
check('naam zonder punthaken en zonder adres → null',
  normalizeSenderEmail('KPN Zakelijk') === null)
check('rommel → null', normalizeSenderEmail('geen adres hier') === null)
check('leeg/ontbrekend → null',
  normalizeSenderEmail('') === null && normalizeSenderEmail(null) === null && normalizeSenderEmail(undefined) === null)
// Zonder punt in het domein is het geen adres; een regel daarop zou onvoorspelbaar matchen.
check('adres zonder domeinpunt → null', normalizeSenderEmail('<baas@localhost>') === null)

console.log('\n— senderIsBlocked (per ADRES, nooit per domein) —')
const blocked = new Set(['reclame@kpn.com'])
check('geblokkeerd adres matcht ongeacht opmaak',
  senderIsBlocked('"KPN" <Reclame@KPN.com>', blocked) === true)
// Dit is de belangrijkste test van het bestand: een domeinregel zou de reclamemail én de echte
// telefoonrekening treffen, en dan verdwijnt er geld uit de aangifte.
check('ander adres op HETZELFDE domein wordt NIET geblokkeerd',
  senderIsBlocked('<facturen@kpn.com>', blocked) === false)
check('onbekende afzender wordt niet geblokkeerd',
  senderIsBlocked('<iemand@anders.nl>', blocked) === false)
check('onleesbare afzender wordt niet geblokkeerd (bij twijfel: importeren)',
  senderIsBlocked('Onbekend', blocked) === false)
check('lege regelset blokkeert niets',
  senderIsBlocked('<reclame@kpn.com>', new Set()) === false)

console.log('\n— mayOfferSenderRule (alleen wat over de AFZENDER gaat) —')
check('"geen factuur" mag een regel voorstellen',
  mayOfferSenderRule('geen_factuur', '<reclame@kpn.com>') === true)
// 'dubbel' en 'niet_van_mij' zijn eigenschappen van DEZE factuur. Daar een blijvende regel van
// maken zou toekomstige echte facturen van hetzelfde adres laten verdwijnen.
check('"dubbel" niet — dat gaat over deze ene factuur',
  mayOfferSenderRule('dubbel', '<facturen@kpn.com>') === false)
check('"niet van mij" niet', mayOfferSenderRule('niet_van_mij', '<facturen@kpn.com>') === false)
check('"anders" niet — te vaag om op te bouwen', mayOfferSenderRule('anders', '<x@y.nl>') === false)
check('geen reden gekozen → geen aanbod',
  mayOfferSenderRule(null, '<x@y.nl>') === false && mayOfferSenderRule(undefined, '<x@y.nl>') === false)
check('geen bruikbaar adres → geen aanbod, ook niet bij "geen factuur"',
  mayOfferSenderRule('geen_factuur', 'Onbekende afzender') === false)

console.log('\n— blockedSenderSkipReason (overslaan is nooit onzichtbaar) —')
const why = blockedSenderSkipReason('reclame@kpn.com')
check('noemt het adres', why.includes('reclame@kpn.com'))
check('zegt dat het je EIGEN regel was', /eigen regel/.test(why))
check('wijst de weg terug', /opheffen/.test(why))

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
