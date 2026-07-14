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
    invoice_date: '2026-03-10', invoice_type: 'factuur', field_confidence: null, ...p,
  }
}

console.log('\n— a genuinely clean invoice stays calm (no false alarm) —')
{
  const h = classifyImportHealth(inv({}))
  check('clean → level clean, no reasons', h.level === 'clean' && h.reasons.length === 0)
  const h2 = classifyImportHealth(inv({ field_confidence: { vendor: 0.98, invoice_number: 0.95, invoice_date: 0.99, amount: 0.97 } }))
  check('clean + high confidences → still clean', h2.level === 'clean')
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

console.log('\n— existing guards still hold —')
{
  const mismatch = classifyImportHealth(inv({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 100 }))
  check('excl+BTW≠incl → needs-review (arithmetic)', mismatch.level === 'needs-review' && mismatch.flags.arithmetic)
  const lowVendor = classifyImportHealth(inv({ field_confidence: { vendor: 0.3 } }))
  check('low vendor confidence → needs-review (vendor)', lowVendor.level === 'needs-review' && lowVendor.flags.vendor)
  const credit = classifyImportHealth(inv({ invoice_type: 'creditnota', total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }))
  check('clean negative creditnota → clean (not falsely flagged)', credit.level === 'clean')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
