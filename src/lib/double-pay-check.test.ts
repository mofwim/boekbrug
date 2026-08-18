// [PAY-SAFE-NUMBER] Pure node test — run: npx tsx src/lib/double-pay-check.test.ts
// Locks pickPaidTwin: which already-paid invoice may stop the owner before they pay this one.
// Both directions matter and the test says so out loud —
//   · a recurring bill (own number each period) must STOP warning: the modal fired every month
//     on a boekhouder's fee and taught the owner to tap past it;
//   · a re-sent invoice (same number) and an unreadable number must KEEP warning: that is the
//     only thing between the owner and a second payment.

import {
  pickPaidTwin, buildDoublePayNotice, buildBundleDoublePayNotice,
  type PaidTwinCandidate, type DoublePayResult, type DoublePayUnchecked,
  type BundleDoublePayFinding,
} from './double-pay-check'

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// [DUBBEL-BEWIJS] The check's third answer.
//
// Everything above tests WHICH invoice is worth warning about. This tests what the owner is told
// when the check could not get that far — because for five separate reasons it produced exactly
// the screen a completed search produces, and the owner then paid a supplier twice.

const clearResult = (over: Partial<DoublePayResult> = {}): DoublePayResult => ({
  outcome: 'clear', match: null, reason: null,
  search: { candidates: 3, anchor: 'iban', days: 120, capped: false, limit: 50 },
  ...over,
})
const uncheckedResult = (reason: DoublePayUnchecked): DoublePayResult =>
  ({ outcome: 'unchecked', match: null, search: null, reason })

console.log('\n— the search is stated, not just the conclusion —')
{
  const n = buildDoublePayNotice(clearResult({ search: { candidates: 0, anchor: 'iban', days: 120, capped: false, limit: 50 } }), 'nl')
  check('no candidates → says so, and names the window', !!n && n.lead.includes('120') && n.tone === 'clear')
  check('and does not claim to have compared anything', !!n && !n.lead.includes('Nagekeken tegen'))
}
{
  const n = buildDoublePayNotice(clearResult({ search: { candidates: 1, anchor: 'iban', days: 120, capped: false, limit: 50 } }), 'nl')
  check('exactly one candidate gets the singular sentence', !!n && n.lead.includes('1 rekening ') && !n.lead.includes('rekeningen'))
}
{
  const n = buildDoublePayNotice(clearResult({ search: { candidates: 7, anchor: 'iban', days: 120, capped: false, limit: 50 } }), 'nl')
  check('seven candidates are named as seven', !!n && n.lead.includes('7 rekeningen'))
}

console.log('\n— the anchor is a claim about how well the search could work —')
{
  const iban = buildDoublePayNotice(clearResult({ search: { candidates: 2, anchor: 'iban', days: 120, capped: false, limit: 50 } }), 'nl')
  const naam = buildDoublePayNotice(clearResult({ search: { candidates: 2, anchor: 'name', days: 120, capped: false, limit: 50 } }), 'nl')
  check('iban and name do not say the same thing', !!iban && !!naam && iban.detail[0] !== naam.detail[0])
  // The name anchor is an exact escaped ilike: "Kiwi Food Market" and "Kiwi Food Market B.V." are
  // two different suppliers to this query. The owner is the only one who can catch that, and only
  // if they are told which anchor was used.
  check('the name anchor states that a different spelling is a different supplier', !!naam && naam.detail[0].includes('anders geschreven'))
}

console.log('\n— a bounded search says it was bounded —')
{
  const n = buildDoublePayNotice(clearResult({ search: { candidates: 50, anchor: 'iban', days: 120, capped: true, limit: 50 } }), 'nl')
  check('the ceiling is reported, with its number', !!n && n.detail.some((d) => d.includes('50')))
  const open = buildDoublePayNotice(clearResult({ search: { candidates: 4, anchor: 'iban', days: 120, capped: false, limit: 50 } }), 'nl')
  check('and an unbounded one does not invent a ceiling', !!open && open.detail.length === 1)
}

console.log('\n— THE ONE THIS EXISTS FOR: "could not look" never renders as "looked and found nothing" —')
{
  const reasons: DoublePayUnchecked[] = ['invoice_unreadable', 'candidates_unreadable', 'no_amount', 'no_vendor', 'network']
  const clear = buildDoublePayNotice(clearResult(), 'nl')
  const notices = reasons.map((r) => buildDoublePayNotice(uncheckedResult(r), 'nl'))
  check('every reason produces a notice', notices.every((n) => !!n))
  // Null-safe on purpose: when a regression makes only SOME reasons go quiet, the suite has to
  // survive long enough to say which. An earlier draft crashed on the first null and hid four.
  check('none of them is toned as a clean check', notices.every((n) => n?.tone === 'unknown'))
  check('none of them reads like the clean sentence', notices.every((n) => n?.lead !== clear!.lead))
  // Five distinct causes, five distinct sentences — a shared "er ging iets mis" would tell the
  // owner nothing they could act on, and two of these five are fixable by them (the document has
  // no amount / no supplier on it).
  check('the five reasons are five different sentences', new Set(notices.map((n) => n?.lead ?? '')).size === 5)
  check('each one says what to do instead', notices.every((n) => (n?.detail.length ?? 0) > 0))
}
{
  // The two that need no database at all, and are the sharpest: an invoice with no readable
  // amount or vendor is the document most likely to have been uploaded twice, and the check
  // switched itself off hardest exactly there.
  const geenBedrag = buildDoublePayNotice(uncheckedResult('no_amount'), 'nl')
  const geenLev = buildDoublePayNotice(uncheckedResult('no_vendor'), 'nl')
  check('no amount names the amount as the missing thing', !!geenBedrag && geenBedrag.lead.includes('bedrag'))
  check('no vendor names the supplier and the iban', !!geenLev && geenLev.lead.includes('leverancier') && geenLev.lead.includes('IBAN'))
}

console.log('\n— a found twin still states its search —')
{
  const n = buildDoublePayNotice(clearResult({ outcome: 'twin', search: { candidates: 9, anchor: 'name', days: 120, capped: false, limit: 50 } }), 'nl')
  check('a twin is toned as an alarm', !!n && n.tone === 'alarm')
  check('and the set it came out of is named', !!n && n.lead.includes('9'))
}

console.log('\n— nothing to report is not the same as a report of nothing —')
{
  check('no result at all → no line', buildDoublePayNotice(null, 'nl') === null)
  check('undefined → no line', buildDoublePayNotice(undefined, 'nl') === null)
  // A response from before this shape existed: a conclusion with no search behind it. The line has
  // nothing to add, so it adds nothing — rather than inventing a search that never happened.
  check('a concluded result with no search states no search',
    buildDoublePayNotice({ outcome: 'clear', match: null, search: null, reason: null }, 'nl') === null)
  // An unchecked result with no reason must still speak: going quiet there would restore exactly
  // the silence this whole section is about.
  const n = buildDoublePayNotice({ outcome: 'unchecked', match: null, search: null, reason: null }, 'nl')
  check('an unchecked result with no reason still says it was not checked', !!n && n.tone === 'unknown')
}

console.log('\n— [TAAL] Dutch is the source and the fallback; direction travels with the words —')
{
  const nl = buildDoublePayNotice(uncheckedResult('candidates_unreadable'), 'nl')
  const onbekend = buildDoublePayNotice(uncheckedResult('candidates_unreadable'), 'zz')
  check('an unknown locale falls back to Dutch, never to a key', !!onbekend && onbekend.lead === nl!.lead)
  check('and never to a blank', !!onbekend && onbekend.lead.trim().length > 0)
  const ar = buildDoublePayNotice(uncheckedResult('candidates_unreadable'), 'ar')
  check('Arabic carries rtl on the same object as its words', !!ar && ar.dir === 'rtl' && ar.lead !== nl!.lead)
  check('Dutch carries ltr', !!nl && nl.dir === 'ltr')
  const en = buildDoublePayNotice(clearResult(), 'en')
  check('English is translated too', !!en && en.lead !== buildDoublePayNotice(clearResult(), 'nl')!.lead)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// [DUBBEL-BUNDEL] The same three answers, for a whole set.
//
// executeBundlePay wrote N pay-toggles and never asked the question once — the path that pays the
// most invoices in one tap was the path with no check on it.

const row = (n: string | null, outcome: DoublePayResult['outcome'], reason: DoublePayUnchecked | null = null): BundleDoublePayFinding => ({
  invoiceNumber: n,
  result: {
    outcome, match: null, reason,
    search: outcome === 'unchecked' ? null : { candidates: 2, anchor: 'iban', days: 120, capped: false, limit: 50 },
  },
})

console.log('\n— a set that was checked, and one that was not —')
{
  const n = buildBundleDoublePayNotice([row('A', 'clear'), row('B', 'clear'), row('C', 'clear')], 3, 'nl')
  check('all clear → clear, and the number checked is named', !!n && n.tone === 'clear' && n.lead.includes('3'))
}
{
  const n = buildBundleDoublePayNotice(null, 4, 'nl')
  check('still sweeping → a line, not a blank', !!n && n.tone === 'unknown')
  // The confirm button is live while the sweep runs. A blank there is the same silence as before,
  // just briefer — and permanent if a fetch never settles.
  check('…and it does not claim anything was checked', !!n && !n.lead.includes('4'))
}
{
  check('no bundle at all → no line', buildBundleDoublePayNotice([], 0, 'nl') === null)
}

console.log('\n— THE PRECEDENCE RULE: an unreachable row is never absorbed into a clean count —')
{
  const n = buildBundleDoublePayNotice(
    [row('A', 'clear'), row('B', 'unchecked', 'candidates_unreadable'), row('C', 'clear')], 3, 'nl')
  check('one unreadable row makes the whole set unknown', !!n && n.tone === 'unknown')
  const clean = buildBundleDoublePayNotice([row('A', 'clear'), row('B', 'clear'), row('C', 'clear')], 3, 'nl')
  check('…and it does not read like the all-clear', !!n && n.lead !== clean!.lead)
  check('…and never says "alle 3 nagekeken"', !!n && !n.lead.includes('Alle'))
}
{
  // Both present. The twin is the louder fact and leads; the unreachable row still has to appear,
  // because "1 lijkt al betaald" quietly implies the other four were cleared.
  const n = buildBundleDoublePayNotice(
    [row('2026-014', 'twin'), row('B', 'unchecked', 'network'), row('C', 'clear')], 3, 'nl')
  check('a twin leads', !!n && n.tone === 'alarm' && n.lead.includes('2026-014'))
  check('…and the unreachable row is still named underneath',
    !!n && n.detail.some((d) => d.includes('1 rekening') || d.includes('Van 1')))
}

console.log('\n— the twins are named, and named as many —')
{
  const one = buildBundleDoublePayNotice([row('2026-014', 'twin'), row('B', 'clear')], 2, 'nl')
  check('one twin, named', !!one && one.lead.includes('2026-014') && one.tone === 'alarm')
  const two = buildBundleDoublePayNotice([row('2026-014', 'twin'), row('2026-015', 'twin')], 2, 'nl')
  check('two twins, both named', !!two && two.lead.includes('2026-014') && two.lead.includes('2026-015'))
  check('…and counted', !!two && two.lead.includes('2'))
  // A set whose documents carry no readable number cannot be named, and says so instead of
  // trailing off after a colon.
  const anon = buildBundleDoublePayNotice([row(null, 'twin'), row('', 'twin')], 2, 'nl')
  check('unnamed twins are counted, not printed as an empty list',
    !!anon && anon.tone === 'alarm' && !anon.lead.trim().endsWith(':') && !anon.lead.includes(': .'))
}

console.log('\n— a bounded sweep says what it did not reach —')
{
  // 30 selected, 25 swept. The five it never looked at may not be silently clean.
  const swept = Array.from({ length: 25 }, (_, i) => row(`A${i}`, 'clear'))
  const n = buildBundleDoublePayNotice(swept, 30, 'nl')
  check('the bound makes the whole set unknown, not clear', !!n && n.tone === 'unknown')
  check('…and names both numbers', !!n && n.lead.includes('25') && n.lead.includes('30'))
  const whole = buildBundleDoublePayNotice(swept, 25, 'nl')
  check('an unbounded sweep of the same rows IS clear', !!whole && whole.tone === 'clear')
}

console.log('\n— [TAAL] the bundle sentences translate and carry their direction too —')
{
  const nl = buildBundleDoublePayNotice([row('A', 'clear'), row('B', 'clear')], 2, 'nl')
  const ar = buildBundleDoublePayNotice([row('A', 'clear'), row('B', 'clear')], 2, 'ar')
  check('Arabic differs and is rtl', !!ar && ar.dir === 'rtl' && ar.lead !== nl!.lead)
  const zz = buildBundleDoublePayNotice([row('A', 'clear'), row('B', 'clear')], 2, 'zz')
  check('an unknown locale falls back to Dutch', !!zz && zz.lead === nl!.lead)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
