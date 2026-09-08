// [HERINNERING-NOOIT] Pure node test — run: npx tsx src/lib/reminder-original.test.ts
//
// The rule under test: a reminder is NEVER imported as an invoice. What varies is only whether the
// app can say which booked invoice it is about — and that answer must be right or absent, never
// guessed, because it lands "the supplier says this is still unpaid" on one specific invoice.
import { placeReminder, findReminderOriginal, reminderFiledReason, reminderSkipReason, type OriginalCandidate } from './reminder-original'
import { isReminderFilename, isStatementFilename } from './ai'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

// The measured case: an 8-digit number the reader read with its last digit dropped.
const ORIGINEEL: OriginalCandidate = {
  id: 'orig', invoiceNumber: '26709711', totalIncBtw: 1764.76, invoiceDate: '2026-06-19',
  clientName: 'Enka Horeca B.V.', status: 'paid', paymentDate: '2026-08-13',
}
const ANDER: OriginalCandidate = {
  id: 'ander', invoiceNumber: '26708817', totalIncBtw: 1501.82, invoiceDate: '2026-06-05',
  clientName: 'Enka Horeca B.V.', status: 'paid',
}
const BOEKEN = [ORIGINEEL, ANDER]

console.log('\n— not a reminder → the normal road —')
check('a plain invoice imports', placeReminder({ isReminder: false, invoiceNumber: '26709711' }, BOEKEN).action === 'import')
check('no flag imports', placeReminder({}, BOEKEN).action === 'import')

console.log('\n— a reminder is filed, never imported, whatever the books hold —')
for (const [naam, boeken] of [['full books', BOEKEN], ['empty books', []]] as const) {
  const p = placeReminder({ isReminder: true, reminderOfInvoiceNumber: '26709711', vendor: 'Enka Horeca', totalIncBtw: 1764.76 }, boeken)
  check(`${naam}: action is file`, p.action === 'file')
}
check('a reminder without any number is still filed, not imported',
  placeReminder({ isReminder: true }, BOEKEN).action === 'file')

console.log('\n— finding the original: the number as printed —')
check('exact number', findReminderOriginal({ reminderOfInvoiceNumber: '26709711' }, BOEKEN).match?.id === 'orig')
check('whitespace inside the number', findReminderOriginal({ reminderOfInvoiceNumber: '2670 9711' }, BOEKEN).match?.id === 'orig')
check('own number when reminder_of is missing', findReminderOriginal({ invoiceNumber: '26709711' }, BOEKEN).match?.id === 'orig')

console.log('\n— finding the original: the dropped digit (the measured case) —')
{
  const f = findReminderOriginal({ reminderOfInvoiceNumber: '2670971', vendor: 'Enka Horeca B.V.', totalIncBtw: 1764.76, invoiceDate: '2026-06-19' }, BOEKEN)
  check('prefix + same party + same cents → match', f.match?.id === 'orig')
}
{
  const f = findReminderOriginal({ reminderOfInvoiceNumber: '2670971', vendor: 'Enka', totalIncBtw: 1764.76, invoiceDate: null }, BOEKEN)
  check('prefix + party + cents, no date → still a match', f.match?.id === 'orig')
}
{
  const f = findReminderOriginal({ reminderOfInvoiceNumber: '99999999', vendor: 'Enka', totalIncBtw: 1764.76, invoiceDate: '2026-06-19' }, BOEKEN)
  check('wrong number but same party + cents + invoice date → match', f.match?.id === 'orig')
}

console.log('\n— and where it must NOT match —')
check('prefix alone (different amount) → nothing',
  findReminderOriginal({ reminderOfInvoiceNumber: '2670971', vendor: 'Enka', totalIncBtw: 1764.77 }, BOEKEN).match === null)
check('amount + date but another party → nothing',
  findReminderOriginal({ reminderOfInvoiceNumber: '1', vendor: 'Sligro', totalIncBtw: 1764.76, invoiceDate: '2026-06-19' }, BOEKEN).match === null)
check('a short prefix does not count ("2026" vs "2026-10")',
  findReminderOriginal({ reminderOfInvoiceNumber: '2026', vendor: 'Enka', totalIncBtw: 10 },
    [{ id: 'x', invoiceNumber: '2026-10', totalIncBtw: 10, invoiceDate: null, clientName: 'Enka', status: 'received' }]).match === null)
check('amount + party + no date + no number → nothing (two signals are not enough)',
  findReminderOriginal({ vendor: 'Enka', totalIncBtw: 1764.76 }, BOEKEN).match === null)
{
  const twee = [ORIGINEEL, { ...ORIGINEEL, id: 'orig2', invoiceNumber: '26709712' }]
  const f = findReminderOriginal({ reminderOfInvoiceNumber: '2670971', vendor: 'Enka', totalIncBtw: 1764.76, invoiceDate: '2026-06-19' }, twee)
  check('two fits → no match, reported as ambiguous', f.match === null && f.ambiguous === 2)
}

console.log('\n— the sentence on the panel says what happened —')
{
  const p = placeReminder({ isReminder: true, reminderOfInvoiceNumber: '2670971', vendor: 'Enka', totalIncBtw: 1764.76, invoiceDate: '2026-06-19' }, BOEKEN)
  check('found: names the booked number', p.action === 'file' && /staat al in je boekhouding/.test(p.reason) && p.reason.includes('26709711'))
  const q = placeReminder({ isReminder: true, reminderOfInvoiceNumber: '26711997', vendor: 'Enka', totalIncBtw: 1381.28 }, BOEKEN)
  check('not found: says the invoice is missing and how to book it', q.action === 'file' && /staat niet in je boekhouding/.test(q.reason) && /vanaf het bestand/.test(q.reason))
  check('ambiguous: names the count', /2 facturen/.test(reminderFiledReason({ reminderOfInvoiceNumber: '1' }, null, 2)))
  check('legacy skip reason still names the number', reminderSkipReason('2026-0041').includes('2026-0041'))
}

console.log('\n— [INCASSO-WOORDEN] the full Dutch escalation ladder is recognised by filename —')
for (const naam of [
  'betalingsherinnering.pdf', 'Herinnering.pdf', 'herinneringsnota.pdf',
  'aanmaning.pdf', 'laatste aanmaning.pdf', 'sommatie.pdf', 'Ingebrekestelling.pdf',
  'WIK-brief.pdf', '14-dagenbrief.pdf', 'aanzegging.pdf', 'incassobrief.pdf', 'laatste waarschuwing.pdf',
  'reminder.pdf', 'payment-reminder.pdf', 'final-notice.pdf', 'dunning.pdf',
]) check(`recognised: ${naam}`, isReminderFilename(naam) === true)
for (const naam of ['factuur-2026-0041.pdf', 'invoice.pdf', 'kassabon.jpg', 'verzamelfactuur.pdf', 'creditnota.pdf'])
  check(`not flagged: ${naam}`, isReminderFilename(naam) === false)

console.log('\n— statement filenames (unchanged) —')
for (const naam of ['rekeningoverzicht.pdf', 'saldo-overzicht.pdf', 'openstaande posten.pdf', 'overzicht openstaande facturen.pdf', 'debiteurenoverzicht.pdf', 'betalingsoverzicht.pdf'])
  check(`overview: ${naam}`, isStatementFilename(naam) === true)
check('verzamelfactuur is not an overview', isStatementFilename('verzamelfactuur.pdf') === false)
check('maandoverzicht deliberately not', isStatementFilename('maandoverzicht.pdf') === false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
