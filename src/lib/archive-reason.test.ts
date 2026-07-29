// [NEGEER-REDEN] Pure node test — run: npx tsx src/lib/archive-reason.test.ts
//
// Deze lijst staat op DRIE plekken: het keuzelijstje in het scherm, de normalisatie in de API,
// en de CHECK-constraint in invoice_archive_reason.sql. Als die uit elkaar lopen krijg je het
// ergste geval: het scherm biedt een reden aan die de database weigert, en dan mislukt het
// NEGEREN zelf — een knop die stukgaat op een notitie. Deze test bewaakt die ene bron.
import {
  ARCHIVE_REASONS,
  ARCHIVE_REASON_LABELS,
  archiveReasonLabel,
  isArchiveReason,
  normalizeArchiveReason,
} from './archive-reason'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

// Exact de waarden die in de CHECK-constraint staan. Verandert deze regel, dan MOET de migratie
// mee — daarom staat de waardenlijst hier letterlijk en niet afgeleid van ARCHIVE_REASONS.
const IN_MIGRATION = ['dubbel', 'niet_van_mij', 'geen_factuur', 'anders']

console.log('\n— de lijst is één bron (scherm ≡ API ≡ CHECK-constraint) —')
check('exact dezelfde waarden als de migratie', JSON.stringify([...ARCHIVE_REASONS]) === JSON.stringify(IN_MIGRATION))
check('elke reden heeft een label én een subtekst',
  ARCHIVE_REASONS.every((r) => !!ARCHIVE_REASON_LABELS[r]?.label && !!ARCHIVE_REASON_LABELS[r]?.hint))
check('geen twee identieke labels (anders is de keuze niet eenduidig)',
  new Set(ARCHIVE_REASONS.map((r) => ARCHIVE_REASON_LABELS[r].label)).size === ARCHIVE_REASONS.length)

console.log('\n— normalizeArchiveReason (de database mag nooit vrije tekst krijgen) —')
check('bekende reden komt er ongeschonden door', normalizeArchiveReason('dubbel') === 'dubbel')
check('onbekende reden → null', normalizeArchiveReason('verzonnen_reden') === null)
check('leeg → null', normalizeArchiveReason('') === null)
check('ontbrekend → null', normalizeArchiveReason(undefined) === null && normalizeArchiveReason(null) === null)
check('niet-string → null', normalizeArchiveReason(42) === null && normalizeArchiveReason({}) === null)
// Zonder deze grens zou een geknutselde client een reden kunnen sturen die de CHECK weigert,
// en dan sneuvelt de archivering op de notitie in plaats van dat de notitie wegvalt.
check('SQL-achtige rommel → null', normalizeArchiveReason("dubbel'; drop table invoices--") === null)

console.log('\n— isArchiveReason —')
check('herkent alle vier', ARCHIVE_REASONS.every((r) => isArchiveReason(r)))
check('wijst de rest af', !isArchiveReason('Dubbel') && !isArchiveReason('DUBBEL'))

console.log('\n— archiveReasonLabel (wat het Genegeerd-tabblad toont) —')
check('bekende reden → label', archiveReasonLabel('geen_factuur') === ARCHIVE_REASON_LABELS.geen_factuur.label)
// Liever geen chip dan een verzonnen chip: een oude rij weet het echt niet meer.
check('ontbrekend → null (geen chip)', archiveReasonLabel(null) === null && archiveReasonLabel(undefined) === null)
check('onbekend → null (nooit een rauwe code tonen)', archiveReasonLabel('iets_anders') === null)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
