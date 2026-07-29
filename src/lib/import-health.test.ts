// [IMPORT-MONITOR] Pure node test — run: npx tsx src/lib/import-health.test.ts
// Locks the money-truth honesty: a missing/€0 total and a low amount-confidence are
// never presented as "clean", while a genuinely clean invoice stays calm (no alarm).
import { classifyImportHealth, type HealthInput } from './import-health'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

function inv(p: Partial<HealthInput>): HealthInput {
  return {
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
    invoice_date: '2026-03-10', invoice_number: '2026-014',
    invoice_type: 'factuur', field_confidence: null, ...p,
  }
}

console.log('\n— a genuinely clean invoice stays calm (no false alarm) —')
{
  const h = classifyImportHealth(inv({}))
  check('clean → level clean, no reasons', h.level === 'clean' && h.reasons.length === 0)
  const h2 = classifyImportHealth(inv({ field_confidence: { vendor: 0.98, invoice_number: 0.95, invoice_date: 0.99, amount: 0.97 } }))
  check('clean + high confidences → still clean', h2.level === 'clean')
}

console.log('\n— a fabricated/missing invoice number is NEVER clean —')
{
  const placeholder = classifyImportHealth(inv({ invoice_number: `EMAIL-${1700000000000}` }))
  check('EMAIL-<ts> placeholder → needs-review', placeholder.level === 'needs-review')
  check('placeholder → invoiceNumber flag + reason', placeholder.flags.invoiceNumber && placeholder.reasons.some((r) => /factuurnummer/i.test(r)))
  const empty = classifyImportHealth(inv({ invoice_number: '' }))
  check('empty number → needs-review', empty.level === 'needs-review' && empty.flags.invoiceNumber)
  const nul = classifyImportHealth(inv({ invoice_number: null }))
  check('null number → needs-review', nul.level === 'needs-review' && nul.flags.invoiceNumber)
  // Backward-compat: a caller that doesn't pass the field is NOT flagged on it.
  const legacy = classifyImportHealth({
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
    invoice_date: '2026-03-10', invoice_type: 'factuur', field_confidence: null,
  })
  check('invoice_number undefined (legacy caller) → not flagged, stays clean', legacy.level === 'clean')
  const real = classifyImportHealth(inv({ invoice_number: '2026-014' }))
  check('a real number → clean', real.level === 'clean')
}

console.log('\n— missing / €0 total is NEVER clean (was a silent €0 booking) —')
{
  const missing = classifyImportHealth(inv({ total_ex_btw: 0, btw_amount: 0, total_inc_btw: null }))
  check('null total → needs-review', missing.level === 'needs-review')
  check('null total → arithmetic flag + a "ontbreekt/€0" reason', missing.flags.arithmetic && missing.reasons.some((r) => /ontbreekt|€ ?0/i.test(r)))
  const zero = classifyImportHealth(inv({ total_ex_btw: 0, btw_amount: 0, total_inc_btw: 0 }))
  check('€0 total → needs-review', zero.level === 'needs-review')
}

console.log('\n— the amounts get their OWN confidence channel —')
{
  const lowAmt = classifyImportHealth(inv({ field_confidence: { amount: 0.4 } }))
  check('low amount-confidence → needs-review', lowAmt.level === 'needs-review' && lowAmt.reasons.some((r) => /onzeker/.test(r)))
  const lowTotalKey = classifyImportHealth(inv({ field_confidence: { total_inc_btw: 0.5 } }))
  check('low total_inc_btw-confidence → needs-review', lowTotalKey.level === 'needs-review')
  const highAmt = classifyImportHealth(inv({ field_confidence: { amount: 0.95 } }))
  check('high amount-confidence + good numbers → clean', highAmt.level === 'clean')
  // Under-claim: no amount score present → we do NOT fabricate doubt about the amount.
  const noAmt = classifyImportHealth(inv({ field_confidence: { vendor: 0.99 } }))
  check('no amount score present → no fabricated amount doubt', noAmt.level === 'clean')
}

console.log('\n— [TRUST-DATE] a missing invoice date is flagged (server refuses it) —')
{
  const noDate = classifyImportHealth(inv({ invoice_date: null }))
  check('null date → needs-review', noDate.level === 'needs-review' && noDate.flags.invoiceDate)
  check("null date → 'ontbreekt' reason", noDate.reasons.some((r) => /factuurdatum ontbreekt/.test(r)))
  check('blank date → needs-review', classifyImportHealth(inv({ invoice_date: '  ' })).level === 'needs-review')
  check('a present date is not flagged', classifyImportHealth(inv({ invoice_date: '2026-03-10' })).flags.invoiceDate === false)
}

console.log('\n— existing guards still hold —')
{
  const mismatch = classifyImportHealth(inv({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 100 }))
  check('excl+BTW≠incl → needs-review (arithmetic)', mismatch.level === 'needs-review' && mismatch.flags.arithmetic)
  const lowVendor = classifyImportHealth(inv({ field_confidence: { vendor: 0.3 } }))
  check('low vendor confidence → needs-review (vendor)', lowVendor.level === 'needs-review' && lowVendor.flags.vendor)
  const credit = classifyImportHealth(inv({ invoice_type: 'creditnota', total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }))
  check('clean negative creditnota → clean (not falsely flagged)', credit.level === 'clean')
}

console.log('\n— [REMINDER] a payment reminder is flagged for a human check (never silently confirmed) —')
{
  const rem = classifyImportHealth(inv({ field_confidence: { _safecore: { reminder: true } } }))
  check('reminder → needs-review', rem.level === 'needs-review' && rem.flags.reminder === true)
  check('reminder → owner-facing reason mentions checking the original',
    rem.reasons.some((r) => r.includes('herinnering') && r.includes('geboekt')))
  const remOf = classifyImportHealth(inv({ field_confidence: { _safecore: { reminder: true, reminder_of: '2216671' } } }))
  check('reminder_of names the original invoice number', remOf.reasons.some((r) => r.includes('2216671')))
  // A clean invoice that is NOT a reminder keeps calm.
  check('no reminder flag on a normal invoice', classifyImportHealth(inv({})).flags.reminder === false)
}

console.log('\n— [DEDUP-SOFT] a POSSIBLE duplicate is flagged for a human glance (never auto-booked) —')
{
  const dup = classifyImportHealth(inv({ field_confidence: { _safecore: { possible_duplicate: true } } }))
  check('possible dup → needs-review', dup.level === 'needs-review' && dup.flags.possibleDuplicate === true)
  check('possible dup → owner-facing "mogelijk dubbel" reason',
    dup.reasons.some((r) => r.includes('mogelijk dubbel') && r.includes('dubbele boeking')))
  const dupOf = classifyImportHealth(inv({ field_confidence: { _safecore: { possible_duplicate: true, possible_duplicate_of: 'F-2001', possible_duplicate_reason: 'zelfde bedrag en datum' } } }))
  check('names the look-alike invoice + reason', dupOf.reasons.some((r) => r.includes('F-2001') && r.includes('zelfde bedrag en datum')))
  check('no possible-dup flag on a normal invoice', classifyImportHealth(inv({})).flags.possibleDuplicate === false)
  // [DEDUP-SOFT #4] A _safecore that carries ONLY possible_duplicate (no arithmetic_ok — the intake
  // path never ran the arithmetic gate) must STILL recompute arithmetic, so a possible-dup invoice
  // that is ALSO math-inconsistent surfaces BOTH reasons, not just the dup one.
  const both = classifyImportHealth(inv({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130, field_confidence: { _safecore: { possible_duplicate: true } } }))
  check('possible-dup + math error → BOTH reasons', both.flags.possibleDuplicate === true && both.flags.arithmetic === true)
}

console.log('\n— [BTW-SUM-FIX] a DERIVED BTW is never presented as clean (it is our arithmetic) —')
{
  // The Enka Horeca shape AFTER the repair: 3413.92 + 405.90 = 3819.82, a legal 12% blend, so
  // every existing axis is silent. Without its own reason the owner would see a green "klaar"
  // over a BTW figure the invoice never printed — and auto-advance would book the voorbelasting.
  const derived = classifyImportHealth(inv({
    total_ex_btw: 3413.92, btw_amount: 405.90, total_inc_btw: 3819.82,
    field_confidence: { _btw_derived: { read: 995.90, used: 405.90 } },
  }))
  check('derived BTW → needs-review', derived.level === 'needs-review' && derived.flags.arithmetic === true)
  check('reason names the derivation + the amount', derived.reasons.some((r) => /afgeleid uit excl\. en totaal/.test(r) && r.includes('405,90')))
  check('the same amounts WITHOUT the note stay clean (the note is the cause)',
    classifyImportHealth(inv({ total_ex_btw: 3413.92, btw_amount: 405.90, total_inc_btw: 3819.82 })).level === 'clean')
  // A note with no usable figure still warns, just without naming an amount.
  const noAmount = classifyImportHealth(inv({ field_confidence: { _btw_derived: { read: null, used: null } } }))
  check('note without an amount still warns', noAmount.level === 'needs-review' && noAmount.reasons.some((r) => /afgeleid uit excl\. en totaal/.test(r)))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
