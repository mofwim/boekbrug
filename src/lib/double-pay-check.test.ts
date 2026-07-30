// [PAY-SAFE-NUMBER] Pure node test — run: npx tsx src/lib/double-pay-check.test.ts
// Locks pickPaidTwin: which already-paid invoice may stop the owner before they pay this one.
// Both directions matter and the test says so out loud —
//   · a recurring bill (own number each period) must STOP warning: the modal fired every month
//     on a boekhouder's fee and taught the owner to tap past it;
//   · a re-sent invoice (same number) and an unreadable number must KEEP warning: that is the
//     only thing between the owner and a second payment.

import { pickPaidTwin, type PaidTwinCandidate } from './double-pay-check'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

const paid = (o: Partial<PaidTwinCandidate> = {}): PaidTwinCandidate => ({
  id: 'paid-1', invoice_number: '20260219', client_name: 'AFDAL Advies & Boekhouding',
  total_inc_btw: 323.68, payment_date: '2026-04-17', ...o,
})

console.log('\n— the real-world false alarm: a monthly fee, same amount, own number —')
{
  // AFDAL Advies & Boekhouding, € 323,68 every month. Factuur 20260457 is not 20260219.
  const r = pickPaidTwin('20260457', [paid({ invoice_number: '20260219' })])
  check('different real numbers → no warning', r === null)
}
{
  // Same shape, many periods already paid — still not a warning.
  const r = pickPaidTwin('20260457', [
    paid({ id: 'p1', invoice_number: '20260219' }),
    paid({ id: 'p2', invoice_number: '20260101' }),
    paid({ id: 'p3', invoice_number: '20259874' }),
  ])
  check('a whole running account → still no warning', r === null)
}

console.log('\n— what the check is FOR: the vendor re-sent the same invoice —')
{
  const r = pickPaidTwin('20260219', [paid({ invoice_number: '20260219' })])
  check('same number → warned', r?.id === 'paid-1')
}
{
  // Number normalization applies: a re-rendered PDF printing "2026 0219" is the same document.
  const r = pickPaidTwin('2026 0219', [paid({ invoice_number: '20260219' })])
  check('spacing variant of the number still warns', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin('20260219', [paid({ invoice_number: '20260219x'.toUpperCase() })])
  check('a genuinely different number is not folded into a match', r === null)
}
{
  // The same-number twin must be the one SHOWN, whatever order the database returned it in.
  const r = pickPaidTwin('20260219', [
    paid({ id: 'stranger', invoice_number: null }),
    paid({ id: 'twin', invoice_number: '20260219' }),
  ])
  check('a same-number twin outranks an unreadable-number candidate', r?.id === 'twin')
}

console.log('\n— where the number cannot decide, the old signal stands —')
{
  // A placeholder means we never read a number off the document. Two of those are two failed
  // reads, not two different numbers — this is exactly where the warning earns its keep.
  const r = pickPaidTwin('UPLOAD-17', [paid({ invoice_number: 'UPLOAD-4' })])
  check('two placeholders → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin('20260457', [paid({ invoice_number: 'EMAIL-903' })])
  check('real number vs placeholder → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin('CAMERA-8', [paid({ invoice_number: '20260219' })])
  check('placeholder vs real number → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin(null, [paid({ invoice_number: null })])
  check('no numbers at all → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin('   ', [paid({ invoice_number: '' })])
  check('blank counts as unreadable, not as a match', r?.id === 'paid-1')
}

console.log('\n— nothing to weigh —')
{
  check('no candidates → null', pickPaidTwin('20260457', []) === null)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
