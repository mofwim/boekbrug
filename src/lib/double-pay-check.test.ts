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
  invoice_date: '2026-04-15', total_inc_btw: 323.68, payment_date: '2026-04-17', ...o,
})

console.log('\n— the real-world false alarm: a monthly fee, same amount, own number —')
{
  // AFDAL Advies & Boekhouding, € 323,68 every month. Factuur 20260457 is not 20260219.
  const r = pickPaidTwin({ invoice_number: '20260457', invoice_date: '2026-07-15' }, [paid({ invoice_number: '20260219' })])
  check('different real numbers → no warning', r === null)
}
{
  // Same shape, many periods already paid — still not a warning.
  const r = pickPaidTwin({ invoice_number: '20260457', invoice_date: '2026-07-15' }, [
    paid({ id: 'p1', invoice_number: '20260219' }),
    paid({ id: 'p2', invoice_number: '20260101' }),
    paid({ id: 'p3', invoice_number: '20259874' }),
  ])
  check('a whole running account → still no warning', r === null)
}

console.log('\n— what the check is FOR: the vendor re-sent the same invoice —')
{
  const r = pickPaidTwin({ invoice_number: '20260219', invoice_date: '2026-07-15' }, [paid({ invoice_number: '20260219' })])
  check('same number → warned', r?.id === 'paid-1')
}
{
  // Number normalization applies: a re-rendered PDF printing "2026 0219" is the same document.
  const r = pickPaidTwin({ invoice_number: '2026 0219', invoice_date: '2026-07-15' }, [paid({ invoice_number: '20260219' })])
  check('spacing variant of the number still warns', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin({ invoice_number: '20260219', invoice_date: '2026-07-15' }, [paid({ invoice_number: '20260219x'.toUpperCase() })])
  check('a genuinely different number is not folded into a match', r === null)
}
{
  // The same-number twin must be the one SHOWN, whatever order the database returned it in.
  const r = pickPaidTwin({ invoice_number: '20260219', invoice_date: '2026-07-15' }, [
    paid({ id: 'stranger', invoice_number: null }),
    paid({ id: 'twin', invoice_number: '20260219' }),
  ])
  check('a same-number twin outranks an unreadable-number candidate', r?.id === 'twin')
}

console.log('\n— where the number cannot decide, the old signal stands —')
{
  // A placeholder means we never read a number off the document. Two of those are two failed
  // reads, not two different numbers — this is exactly where the warning earns its keep.
  const r = pickPaidTwin({ invoice_number: 'UPLOAD-17', invoice_date: '2026-07-15' }, [paid({ invoice_number: 'UPLOAD-4' })])
  check('two placeholders → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin({ invoice_number: '20260457', invoice_date: '2026-07-15' }, [paid({ invoice_number: 'EMAIL-903' })])
  check('real number vs placeholder → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin({ invoice_number: 'CAMERA-8', invoice_date: '2026-07-15' }, [paid({ invoice_number: '20260219' })])
  check('placeholder vs real number → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin({ invoice_number: null, invoice_date: '2026-07-15' }, [paid({ invoice_number: null })])
  check('no numbers at all → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin({ invoice_number: '   ', invoice_date: '2026-07-15' }, [paid({ invoice_number: '' })])
  check('blank counts as unreadable, not as a match', r?.id === 'paid-1')
}

console.log('\n— the date fence: two numbers on ONE day is one document, read twice —')
{
  // Same supplier, same amount, same invoice DATE, but the numbers differ — that is the shape of
  // an OCR digit misread on one copy, not of two bills. A running account does not invoice the
  // same amount twice on the same day; a misread does. Going silent here would be the exact
  // silent failure the number rule is meant to avoid.
  const r = pickPaidTwin(
    { invoice_number: '20260Z19', invoice_date: '2026-04-15' },
    [paid({ invoice_number: '20260219', invoice_date: '2026-04-15' })],
  )
  check('different numbers, SAME invoice date → still warned', r?.id === 'paid-1')
}
{
  // Different day → a genuine running account. This is the AFDAL case and it stays quiet.
  const r = pickPaidTwin(
    { invoice_number: '20260457', invoice_date: '2026-07-15' },
    [paid({ invoice_number: '20260219', invoice_date: '2026-04-15' })],
  )
  check('different numbers, different dates → no warning', r === null)
}
{
  // [DECIDED] A supplier who bills the same work twice BY MISTAKE, with two numbers of its own a
  // few days apart (#100 on 1 May, #101 on 8 May, both EUR 500). This is silent now — a decision
  // that was taken, not a case that was forgotten. From our data it cannot be told apart from an
  // ordinary second bill: different number, different date, same amount. Any warning here is a
  // coin flip, and a warning that cries wolf that often teaches the owner to tap past it — including
  // the time it is right. To anyone reading this later as a bug: it is not one. Reverting it brings
  // back the monthly false alarm.
  const r = pickPaidTwin(
    { invoice_number: '101', invoice_date: '2026-05-08' },
    [paid({ invoice_number: '100', invoice_date: '2026-05-01', total_inc_btw: 500 })],
  )
  check('supplier double-bills by mistake, own numbers → deliberately silent', r === null)
}
{
  // A date we could not read cannot clear anything — absence of evidence is not evidence.
  const r = pickPaidTwin(
    { invoice_number: '20260457', invoice_date: null },
    [paid({ invoice_number: '20260219', invoice_date: '2026-04-15' })],
  )
  check('missing date on the new invoice → still warned', r?.id === 'paid-1')
}
{
  const r = pickPaidTwin(
    { invoice_number: '20260457', invoice_date: '2026-07-15' },
    [paid({ invoice_number: '20260219', invoice_date: null })],
  )
  check('missing date on the paid invoice → still warned', r?.id === 'paid-1')
}
{
  // Timestamp form must compare by DAY, not by string identity.
  const r = pickPaidTwin(
    { invoice_number: '20260Z19', invoice_date: '2026-04-15T09:12:00Z' },
    [paid({ invoice_number: '20260219', invoice_date: '2026-04-15' })],
  )
  check('same day expressed as a timestamp still counts as the same day', r?.id === 'paid-1')
}

console.log('\n— nothing to weigh —')
{
  check('no candidates → null', pickPaidTwin({ invoice_number: '20260457', invoice_date: '2026-07-15' }, []) === null)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
