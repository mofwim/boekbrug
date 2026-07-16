// src/lib/safecore.test.ts — [BRIDGE-CREDITNOTA-SIGN] creditnota branch tests
// Run: npx tsx src/lib/safecore.test.ts
//
// Written BEFORE the implementation (tests-first, per review). Covers:
//   - regression: the standard path is byte-for-byte unchanged in behaviour
//   - the new creditnota branch (opts.isCreditNote = true)
//   - the smarter negative-amount message on the standard path
//
// Style: plain check() functions + process exit code — same as retention.test.ts.

import { evaluateArithmetic, normalizeInvoiceNumber } from './safecore'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('═══ safecore creditnota tests ═══\n')

// ── 1. Regression: normal invoice, consistent → ok ──────────────────────────
{
  const v = evaluateArithmetic({ totalExBtw: 852.17, btwAmount: 76.7, totalIncBtw: 928.87 })
  check('1. normale factuur (consistent) → ok', v.ok === true, JSON.stringify(v))
}

// ── 2. Normal invoice with NEGATIVE amounts (extraction error) → blocked,
//      with the NEW smart message hinting at creditnota ─────────────────────
{
  const v = evaluateArithmetic({ totalExBtw: -4, btwAmount: -0.84, totalIncBtw: -4.84 })
  check('2a. normale factuur met negatieve bedragen → blocked', v.ok === false)
  check(
    '2b. …met slimme reden ("is dit een creditnota?")',
    (v.reason ?? '').includes('creditnota'),
    v.reason
  )
  check(
    '2c. …behoudt de bestaande flag (consumers ongebroken)',
    (v.flags ?? []).includes('non_finite_or_negative'),
    JSON.stringify(v.flags)
  )
}

// ── 3. Creditnota: negative + consistent (real CR-002-2026 numbers) → ok ────
{
  const v = evaluateArithmetic(
    { totalExBtw: -4.0, btwAmount: -0.84, totalIncBtw: -4.84 },
    { isCreditNote: true }
  )
  check('3. creditnota negatief + consistent → ok', v.ok === true, JSON.stringify(v))
}

// ── 4. Creditnota with MIXED signs (ex neg, btw pos) → blocked ──────────────
{
  const v = evaluateArithmetic(
    { totalExBtw: -4.0, btwAmount: 0.84, totalIncBtw: -3.16 },
    { isCreditNote: true }
  )
  check('4. creditnota met gemengde tekens → blocked', v.ok === false, JSON.stringify(v))
}

// ── 5. Creditnota with all-POSITIVE amounts → blocked ───────────────────────
{
  const v = evaluateArithmetic(
    { totalExBtw: 4.0, btwAmount: 0.84, totalIncBtw: 4.84 },
    { isCreditNote: true }
  )
  check('5. creditnota met positieve bedragen → blocked', v.ok === false, JSON.stringify(v))
}

// ── 6. Creditnota negative but INCONSISTENT (ex+btw ≠ incl) → blocked ───────
{
  const v = evaluateArithmetic(
    { totalExBtw: -4.0, btwAmount: -0.84, totalIncBtw: -9.99 },
    { isCreditNote: true }
  )
  check('6a. creditnota inconsistent → blocked', v.ok === false)
  check('6b. …met sum_mismatch flag', (v.flags ?? []).includes('sum_mismatch'), JSON.stringify(v.flags))
}

// ── 7. Creditnota with ILLEGAL BTW rate (|btw/ex| > 21%) → blocked ──────────
{
  // ex=-4, btw=-2 → rate = 50% (neg/neg = positive) → illegal
  const v = evaluateArithmetic(
    { totalExBtw: -4.0, btwAmount: -2.0, totalIncBtw: -6.0 },
    { isCreditNote: true }
  )
  check('7. creditnota met ongeldig BTW-tarief (50%) → blocked', v.ok === false, JSON.stringify(v))
}

// ── 8. Regression: normal zero invoice → blocked (existing behaviour) ───────
{
  const v = evaluateArithmetic({ totalExBtw: 0, btwAmount: 0, totalIncBtw: 0 })
  check('8. normale factuur met nul-bedragen → blocked', v.ok === false)
}

// ── 9. Creditnota edge: btw=0 (0% rate), ex=incl, negative → ok ─────────────
{
  const v = evaluateArithmetic(
    { totalExBtw: -10.0, btwAmount: 0, totalIncBtw: -10.0 },
    { isCreditNote: true }
  )
  check('9. creditnota 0% BTW (btw=0) → ok', v.ok === true, JSON.stringify(v))
}

// ── 10. Creditnota zero total → blocked (not bookable) ──────────────────────
{
  const v = evaluateArithmetic(
    { totalExBtw: 0, btwAmount: 0, totalIncBtw: 0 },
    { isCreditNote: true }
  )
  check('10. creditnota met nul-totaal → blocked', v.ok === false)
}

// ── 11. Regression: opts absent === opts undefined === old behaviour ────────
{
  const a = evaluateArithmetic({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 })
  const b = evaluateArithmetic({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 }, {})
  check('11. bestaande aanroepen (zonder opts) ongewijzigd', a.ok === true && b.ok === true)
}

// ── 12. Regression: date sanity still applies on both paths ─────────────────
{
  const std = evaluateArithmetic({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121, invoiceDate: '2050-01-01' })
  const cn = evaluateArithmetic(
    { totalExBtw: -100, btwAmount: -21, totalIncBtw: -121, invoiceDate: '2050-01-01' },
    { isCreditNote: true }
  )
  check('12a. datum buiten bereik → blocked (standaard)', std.ok === false)
  check('12b. datum buiten bereik → blocked (creditnota)', cn.ok === false)
}

console.log('\n═══ [DEDUP-NUMBER-NORM] invoice-number normalization ═══\n')
{
  check('spacing around a separator folds', normalizeInvoiceNumber('26 / 3958') === normalizeInvoiceNumber('26/3958'))
  check('leading/trailing space folds', normalizeInvoiceNumber('  26/3958 ') === '26/3958')
  check('case folds', normalizeInvoiceNumber('Inv2026') === 'inv2026')
  check('a genuinely different number does NOT fold', normalizeInvoiceNumber('26/3958') !== normalizeInvoiceNumber('26/3959'))
  check('a different separator is preserved (not merged)', normalizeInvoiceNumber('26/3958') !== normalizeInvoiceNumber('26-3958'))
  check('null → empty string', normalizeInvoiceNumber(null) === '')
}

console.log(`\n${failures === 0 ? '✅ ALLE TESTS GESLAAGD' : `❌ ${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)