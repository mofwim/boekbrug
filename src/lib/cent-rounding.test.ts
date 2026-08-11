// [CENT] Pure node test — run: npx tsx --test src/lib/cent-rounding.test.ts
//
// Rounding to cents was written five times, in four different ways, and every one of them sat on
// a money path. This test does not check that the app has one round2 — the gate in
// lifecycle-gates.test.ts does that. It checks the thing that matters: that the surfaces which
// describe THE SAME INVOICE to different readers now agree to the cent.
//
// THE DEFECT, MEASURED, on the most ordinary invoice imaginable — one line, € 21,50 excl., 21%:
//
//     screen · database · PDF · aangifte     btw 4,52     total 26,02
//     the e-invoice XML sent to the customer btw 4.51     PayableAmount 26.01
//
// 21,50 × 0,21 is 4,514999999999999 in binary floating point, so plain Math.round gives 4,51.
// invoice-totals adds 1e-9 before rounding and gets 4,52; ubl-export added Number.EPSILON
// (2,2e-16), which is four orders of magnitude too small to make any difference at all.
//
// Nothing complained. The XML is internally consistent, so no Peppol rule fires; ubl-export's own
// header cross-check only warns above one cent. The customer's bookkeeping simply books a cent
// less than the invoice says, pays that, and the invoice stays open forever.
//
// 492 amounts under € 5.000 at 9% and 21% do this. They are not edge cases — they are every price
// that ends on a half euro: 21,50 · 22,50 · 26,50 · 46,50 · 52,50 · 77,50 …

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeInvoiceTotals, round2 } from './invoice-totals'
import { buildInvoiceUbl } from './ubl-export'

// ── the function itself ────────────────────────────────────────────────────────────────────────

test('[CENT] a half cent lost to floating point is rounded UP, not away', () => {
  // The three amounts the four old versions disagreed about, and why: the exact decimal is x.xx5,
  // the double nearest to it is a hair BELOW, and Math.round then goes down.
  assert.equal(round2(21.5 * 0.21), 4.52)
  assert.equal(round2(26.5 * 0.09), 2.39)
  assert.equal(round2(77.5 * 0.21), 16.28)
  // A literal half cent — no drift involved — rounds up as well. Same answer, same rule.
  assert.equal(round2(4.515), 4.52)
  assert.equal(round2(0.005), 0.01)
})

test('[CENT] a creditnota is the exact mirror of the factuur it takes back', () => {
  // Math.round(-0.5) is -0. Every version built on plain Math.round therefore rounded a negative
  // half cent TOWARDS ZERO while rounding the positive one up — so the credit note came out a cent
  // short of the invoice it reverses, and the books stayed off by that cent permanently.
  for (const n of [0.005, 4.515, 21.5 * 0.21, 1234.565]) {
    assert.equal(round2(-n), -round2(n), `-${n} must mirror ${n}`)
  }
  assert.equal(round2(-0.005), -0.01)
})

test('[CENT] the ordinary amount is untouched — this is not a new rounding', () => {
  // The point of the 1e-9 is to recover a half cent, not to shift real money. Anything that is
  // already a clean amount, or clearly below/above the halfway mark, comes out exactly as before.
  assert.equal(round2(100), 100)
  assert.equal(round2(0), 0)
  assert.equal(round2(4.514), 4.51)
  assert.equal(round2(4.516), 4.52)
  assert.equal(round2(362.38 * 1.09), 394.99, 'the real Kiwi invoice still lands on 394,99')
  // The nudge is 1e-9 of a euro — a hundred-millionth of a cent. It cannot move an amount that is
  // not already sitting on the boundary.
  assert.equal(round2(4.5149999), 4.51)
})

test('[CENT] a non-finite amount becomes 0, not Infinity or NaN', () => {
  // These reach a PDF, a CSV and an aangifte. "€ 0,00" is wrong in a way a human notices;
  // "€ NaN" and "€ Infinity" are wrong in a way that makes a document unusable, and Infinity
  // silently poisons every sum it is added to.
  assert.equal(round2(Number.NaN), 0)
  assert.equal(round2(Number.POSITIVE_INFINITY), 0)
  assert.equal(round2(Number.NEGATIVE_INFINITY), 0)
  assert.equal(round2(undefined as unknown as number), 0)
  assert.equal(round2(null as unknown as number), 0)
})

// ── the surfaces, on one invoice ───────────────────────────────────────────────────────────────

const SUPPLIER = {
  company_name: 'Boekbrug',
  kvk_number: '12345678',
  btw_number: 'NL001234567B01',
} as never

/** The BTW and the payable amount as the e-invoice states them. */
function ublTotals(lines: unknown[], header: Record<string, unknown>) {
  const { xml } = buildInvoiceUbl(
    {
      invoice_number: '2026-001',
      invoice_date: '2026-08-11',
      client_name: 'Klant BV',
      ...header,
    } as never,
    lines as never,
    SUPPLIER,
  )
  const tax = xml.match(/<cbc:TaxAmount currencyID="EUR">([\d.-]+)<\/cbc:TaxAmount>/)
  const payable = xml.match(/<cbc:PayableAmount currencyID="EUR">([\d.-]+)<\/cbc:PayableAmount>/)
  assert.ok(tax && payable, 'the XML must state a tax and a payable amount')
  return { btw: Number(tax![1]), inc: Number(payable![1]) }
}

test('[CENT] the e-invoice states the same BTW as the PDF — the defect itself', () => {
  // € 21,50 at 21%. Before the fix: ledger 4,52 / XML 4.51.
  const lines = [{ description: 'Advies', quantity: 1, unit_price: 21.5, line_total: 21.5, btw_rate: 21 }]
  const t = computeInvoiceTotals(lines)
  const ubl = ublTotals(lines, {
    total_ex_btw: t.total_ex_btw,
    btw_amount: t.btw_amount,
    total_inc_btw: t.total_inc_btw,
  })
  assert.equal(t.btw_amount, 4.52, 'the ledger figure, unchanged')
  assert.equal(ubl.btw, t.btw_amount, 'the XML may not state a different BTW than the invoice')
  assert.equal(ubl.inc, t.total_inc_btw, 'nor a different amount to pay')
})

test('[CENT] and on every half-euro amount, not just that one', () => {
  // A sweep rather than a single example, because the point is the CLASS. These are the amounts
  // the two implementations disagreed on; each one was a cent going out of the door wrong.
  const cases: Array<[number, number]> = [
    [21.5, 21], [22.5, 21], [23.5, 21], [77.5, 21], [81.5, 21], [85.5, 21],
    [26.5, 9], [46.5, 9], [52.5, 9], [92.5, 9], [93.5, 9], [104.5, 9],
  ]
  for (const [ex, rate] of cases) {
    const lines = [{ description: 'Werk', quantity: 1, unit_price: ex, line_total: ex, btw_rate: rate }]
    const t = computeInvoiceTotals(lines)
    const ubl = ublTotals(lines, {
      total_ex_btw: t.total_ex_btw,
      btw_amount: t.btw_amount,
      total_inc_btw: t.total_inc_btw,
    })
    assert.equal(ubl.btw, t.btw_amount, `€ ${ex} @ ${rate}%: XML says ${ubl.btw}, ledger says ${t.btw_amount}`)
    assert.equal(ubl.inc, t.total_inc_btw, `€ ${ex} @ ${rate}%: payable amount differs`)
  }
})

test('[CENT] a mixed-rate invoice too — the rates are rounded before they are added', () => {
  // Both sides group per rate and round each group, so the agreement has to survive the grouping
  // as well as the rounding. 21,50 at 21% and 26,50 at 9% are two amounts that BOTH drifted.
  const lines = [
    { description: 'Advies', quantity: 1, unit_price: 21.5, line_total: 21.5, btw_rate: 21 },
    { description: 'Boek', quantity: 1, unit_price: 26.5, line_total: 26.5, btw_rate: 9 },
  ]
  const t = computeInvoiceTotals(lines)
  const ubl = ublTotals(lines, {
    total_ex_btw: t.total_ex_btw,
    btw_amount: t.btw_amount,
    total_inc_btw: t.total_inc_btw,
  })
  assert.equal(t.btw_amount, round2(4.52 + 2.39))
  assert.equal(ubl.btw, t.btw_amount)
  assert.equal(ubl.inc, t.total_inc_btw)
})
