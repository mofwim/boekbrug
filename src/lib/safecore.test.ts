// src/lib/safecore.test.ts — [BRIDGE-CREDITNOTA-SIGN] creditnota branch tests
// Run: npx tsx src/lib/safecore.test.ts
//
// Written BEFORE the implementation (tests-first, per review). Covers:
//   - regression: the standard path is byte-for-byte unchanged in behaviour
//   - the new creditnota branch (opts.isCreditNote = true)
//   - the smarter negative-amount message on the standard path
//
// Style: plain check() functions + process exit code — same as retention.test.ts.

import { evaluateArithmetic, normalizeInvoiceNumber, normalizeToIso, pickDedupMatch } from './safecore'

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

// ── 4. [NET-CREDIT] MIXED signs (ex neg, btw pos) but the identity holds → ok ──
// Policy change: a net-credit with POSITIVE BTW over a negative net total is legitimate (the
// Altena statiegeld/retour shape). -4 + 0.84 = -3.16, rate |0.84/-4| = 21% (legal). The identity
// check still blocks a genuine sign-error (see 10c) — only mutually-consistent numbers pass.
{
  const v = evaluateArithmetic(
    { totalExBtw: -4.0, btwAmount: 0.84, totalIncBtw: -3.16 },
    { isCreditNote: true }
  )
  check('4. net-credit met gemengde tekens (identiteit klopt) → ok', v.ok === true, JSON.stringify(v))
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

// ── 10b. [NET-CREDIT] mixed-sign net-credit (the real Altena invoice) → ok ──
// ex -123, BTW +13.42 (positive, on the 9% goods), totaal -109.58; -123 + 13.42 = -109.58.
{
  const v = evaluateArithmetic(
    { totalExBtw: -123.0, btwAmount: 13.42, totalIncBtw: -109.58 },
    { isCreditNote: true }
  )
  check('10b. net-credit met POSITIEVE BTW en negatief totaal → ok', v.ok === true, JSON.stringify(v))
}

// ── 10c. net-credit but identity broken → still blocked (the read is wrong) ──
{
  const v = evaluateArithmetic(
    { totalExBtw: -123.0, btwAmount: 13.42, totalIncBtw: -100.0 },
    { isCreditNote: true }
  )
  check('10c. net-credit met verkeerd totaal → blocked', v.ok === false && (v.flags ?? []).includes('sum_mismatch'))
}

// ── 10d. net-credit with an impossible rate (|btw/ex| > 21%) → blocked ──────
{
  const v = evaluateArithmetic(
    { totalExBtw: -10.0, btwAmount: 5.0, totalIncBtw: -5.0 },
    { isCreditNote: true }
  )
  check('10d. net-credit met ongeldig tarief (50%) → blocked', v.ok === false && (v.flags ?? []).includes('illegal_btw_rate'))
}

// ── 10e. Regression: a normal positive invoice is untouched by the net-credit relaxation ──
{
  const std = evaluateArithmetic({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 })
  check('10e. gewone factuur (positief) blijft ok', std.ok === true, JSON.stringify(std))
}

// ── 10f. [NO-BASE] near-zero base with a large BTW → blocked (the rate check can't run) ──
// €238 BTW on a €0.004 base is a physically-impossible read; the identity still holds, so only
// this guard catches it now that the all-≤0 structural rule is gone.
{
  const v = evaluateArithmetic(
    { totalExBtw: 0.004, btwAmount: -238, totalIncBtw: -237.996 },
    { isCreditNote: true }
  )
  check('10f. BTW zonder grondslag (bijna-nul ex) → blocked', v.ok === false && (v.flags ?? []).includes('illegal_btw_rate'), JSON.stringify(v))
}

// ── 10g. exact-zero base with BTW, negative total → blocked (closes the ex==0 gap too) ──
{
  const v = evaluateArithmetic(
    { totalExBtw: 0, btwAmount: -50, totalIncBtw: -50 },
    { isCreditNote: true }
  )
  check('10g. BTW op nul-grondslag → blocked', v.ok === false, JSON.stringify(v))
}

// ── 10h. Regression: a legit 0%-BTW credit (btw exactly 0, real base) stays ok ──
{
  const v = evaluateArithmetic(
    { totalExBtw: -10, btwAmount: 0, totalIncBtw: -10 },
    { isCreditNote: true }
  )
  check('10h. 0%-credit (btw=0, echte grondslag) blijft ok', v.ok === true, JSON.stringify(v))
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

// ── 13. [BREAKDOWN-MISSING] total present but ex+BTW both absent → clearer reason ───
{
  // The €8.980 case: only the printed total came through; ex and BTW are null.
  const v = evaluateArithmetic({ totalExBtw: null, btwAmount: null, totalIncBtw: 8980.05 })
  check('13a. missing split → blocked', v.ok === false)
  check('13b. …still flagged sum_mismatch (consumers unaffected)', (v.flags ?? []).includes('sum_mismatch'))
  check('13c. …reason says the split is MISSING, not "≠ totaal"',
    (v.reason ?? '').includes('uitsplitsing') && !(v.reason ?? '').includes('≠'), JSON.stringify(v.reason))
  // A split that IS present but wrong keeps the original mismatch wording.
  const w = evaluateArithmetic({ totalExBtw: 100, btwAmount: 5, totalIncBtw: 200 })
  check('13d. present-but-wrong split → still "excl + BTW ≠ totaal"',
    (w.reason ?? '').includes('≠'), JSON.stringify(w.reason))

  // ── The shape this ACTUALLY has once it is stored ──
  //
  // Both write paths insert `v.total_ex_btw ?? 0` into a NOT-NULL numeric column, so on every row
  // the owner has ever seen, the absent split reads back as 0 — never null. 13a–13c above only
  // ever passed inside the write path; at read time the branch fell through to reconcileHint with
  // an ex of 0, which reports the whole gross as the excl the invoice "should" have. An owner who
  // follows that sentence sets their btw to zero and loses the voorbelasting.
  const stored = evaluateArithmetic({ totalExBtw: 0, btwAmount: 0, totalIncBtw: 8980.05 })
  check('13e. stored-as-0 split reads as MISSING, like the null it came from',
    (stored.reason ?? '').includes('uitsplitsing'), JSON.stringify(stored.reason))
  check('13f. …and never proposes the gross as the excl (that zeroes the btw)',
    !(stored.reason ?? '').includes('8.980,05'), JSON.stringify(stored.reason))
  const storedCn = evaluateArithmetic(
    { totalExBtw: 0, btwAmount: 0, totalIncBtw: -8980.05 }, { isCreditNote: true })
  check('13g. same on the creditnota gate', (storedCn.reason ?? '').includes('uitsplitsing'))

  // The fence: a REAL contradiction must still be a contradiction. Only ex is missing here, so a
  // split WAS read — and widening this test must never swallow that.
  const halfRead = evaluateArithmetic({ totalExBtw: 0, btwAmount: 21, totalIncBtw: 121 })
  check('13h. half a split is not a missing split', (halfRead.reason ?? '').includes('≠'),
    JSON.stringify(halfRead.reason))
  check('13i. …and it is still blocked', halfRead.ok === false)
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

console.log('\n═══ [DATE-ISO-SAFE / I6] tolerant date normalization (never throws) ═══\n')
{
  check('ISO passes through', normalizeToIso('2026-05-15') === '2026-05-15')
  check('ISO with time → date part', normalizeToIso('2026-05-15T10:00:00Z') === '2026-05-15')
  check('Dutch DD-MM-YYYY → ISO (the throw case)', normalizeToIso('15-05-2026') === '2026-05-15')
  check('slash DD/MM/YYYY → ISO', normalizeToIso('15/05/2026') === '2026-05-15')
  check('single-digit day/month pads', normalizeToIso('5-5-2026') === '2026-05-05')
  check('invalid month → null (not a throw, not a wrong date)', normalizeToIso('15-13-2026') === null)
  check('garbage → null', normalizeToIso('not a date') === null)
  check('null → null', normalizeToIso(null) === null)
  check('empty → null', normalizeToIso('') === null)
}

console.log('\n═══ [DEDUP-VENDOR-NORM] pickDedupMatch — de vergelijking staat in code, niet in een LIKE ═══\n')
{
  const sumup = { id: 'b', invoice_number: 'F-2', client_name: 'SUMUP *CAFE' }
  const lookalike = { id: 'a', invoice_number: 'F-1', client_name: 'SUMUP XCAFE' }

  // DE REGRESSIE. Via `.ilike(client_name, 'SUMUP *CAFE')` maakte PostgREST er 'SUMUP %CAFE' van,
  // en dan blokkeerde een wildvreemde factuur met hetzelfde totaal + dezelfde datum de upload.
  check('een naam die alléén via het wildcard-patroon zou matchen, matcht niet',
    pickDedupMatch([lookalike], { tier: 'vendor', total: 10, vendor: 'SUMUP *CAFE' }) === null)
  check('de ster is een letterlijke ster — de échte leverancier matcht wél',
    pickDedupMatch([lookalike, sumup], { tier: 'vendor', total: 10, vendor: 'SUMUP *CAFE' })?.id === 'b')
  check('ook % en _ zijn nu letterlijk, niet alleen ontsnapt',
    pickDedupMatch([{ id: 'x', invoice_number: null, client_name: '50XY KORTING' }],
      { tier: 'vendor', total: 10, vendor: '50%_ KORTING' }) === null)

  // De normalisatie die we WEL willen houden — dezelfde die isReliableVendor gebruikt.
  check('hoofdletters, dubbele spaties en accenten vouwen samen',
    pickDedupMatch([{ id: 'c', invoice_number: null, client_name: 'Café  de  Kroon' }],
      { tier: 'vendor', total: 10, vendor: 'cafe de kroon' })?.id === 'c')

  // De verwijderde terugval: zonder bruikbare sleutel NOOIT "dan maar de eerste rij" — dat zou
  // blokkeren op totaal + datum alleen, wat findSemanticDuplicate "te los" noemt.
  check('geen leverancier → geen match (nooit rows[0])',
    pickDedupMatch([lookalike, sumup], { tier: 'vendor', total: 10 }) === null)
  check('geen nummer op de nummer-tier → geen match (nooit rows[0])',
    pickDedupMatch([lookalike, sumup], { tier: 'number', total: 10 }) === null)
  check('lege kandidatenlijst → null', pickDedupMatch([], { tier: 'vendor', total: 10, vendor: 'X' }) === null)

  // De nummer-tier blijft doen wat [DEDUP-NUMBER-NORM] hierboven vastlegde.
  check('nummer-tier vergelijkt genormaliseerd door',
    pickDedupMatch([{ id: 'n', invoice_number: '26 / 3958', client_name: 'Wie dan ook' }],
      { tier: 'number', total: 10, invoiceNumber: '26/3958' })?.id === 'n')
  check('een echt ander nummer matcht niet',
    pickDedupMatch([{ id: 'n', invoice_number: '26/3959', client_name: 'Wie dan ook' }],
      { tier: 'number', total: 10, invoiceNumber: '26/3958' }) === null)
}

console.log(`\n${failures === 0 ? '✅ ALLE TESTS GESLAAGD' : `❌ ${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)