// [CHECKLIST] Pure node test — run: npx tsx --test src/lib/invoice-checks.test.ts
//
// The list exists so a clean invoice stops being SILENT. What it must never do is turn a check
// that did not run into a green tick — that would replace the owner's habit of looking with a
// false reason not to, on the axes where being wrong costs them money.
//
// So most of what is asserted here is the third state.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { invoiceChecks, checksPassed, checksSummary, type CheckInput, type CheckOutcome } from './invoice-checks'

/** A correct 21% invoice with a printed account number — everything the app can check, checkable. */
const clean = (over: Partial<CheckInput> = {}): CheckInput => ({
  invoice_number: '26035350',
  invoice_date: '2026-06-24',
  invoice_type: 'factuur',
  total_ex_btw: 257.85,
  btw_amount: 23.21,
  total_inc_btw: 281.06,
  vendor_iban: 'NL65RABO0171136276',
  field_confidence: null,
  ...over,
})

/** The outcome of one check by id. */
function outcome(inv: CheckInput, id: string): CheckOutcome {
  const c = invoiceChecks(inv).find((x) => x.id === id)
  assert.ok(c, `no check with id ${id}`)
  return c!.outcome
}

test('[CHECKLIST] a clean invoice says what was checked instead of saying nothing', () => {
  const checks = invoiceChecks(clean())
  assert.equal(checks.length, 8, 'all eight axes are reported')
  assert.equal(checksPassed(checks), 8, 'and on a clean invoice every one of them passed')
  assert.match(checksSummary(checks), /Alle 8 controles gedaan/, 'the summary may claim completeness ONLY here')
  for (const c of checks) {
    assert.ok(c.label.length > 5, `${c.id} has no label`)
    assert.doesNotMatch(c.label, /[a-z]+_[a-z]+/, `${c.id} leaks a field name into the owner's text: "${c.label}"`)
  }
})

test('[CHECKLIST] a check that could not run is never a tick', () => {
  // The whole reason this file has three outcomes. Both of these were recorded at import time by
  // code that refused to let a skipped check read as a passed one — the list must keep that refusal.
  assert.equal(
    outcome(clean({ field_confidence: { _safecore: { iban_check_unavailable: true } } }), 'iban'), 'not-checked',
    'the supplier registry was unreachable — the fraud check did NOT run',
  )
  assert.equal(
    outcome(clean({ field_confidence: { _safecore: { one_invoice_unverified: true } } }), 'single-invoice'), 'not-checked',
    'a scanned pdf has no text layer, so the multi-invoice detector looked at nothing',
  )
})

test('[CHECKLIST] nothing to compare against is not a pass either', () => {
  // An invoice with no printed account number: there is no fraud check to pass. Ticking it would
  // tell the owner their supplier's IBAN is unchanged, about an invoice that names no IBAN.
  assert.equal(outcome(clean({ vendor_iban: null }), 'iban'), 'not-checked')
  assert.equal(outcome(clean({ vendor_iban: 'NL65' }), 'iban'), 'not-checked', 'too short to be an IBAN')

  // …but a missing DATE or NUMBER is the opposite case, and getting this backwards would hide a
  // real problem behind a neutral grey row. The check ran; its answer is that the invoice has no
  // usable date — and under the factuurstelsel that date picks the kwartaal. Only the detail
  // separates "there is none" from "we are unsure of the one we read".
  assert.equal(outcome(clean({ invoice_date: null }), 'date'), 'flagged')
  assert.match(
    invoiceChecks(clean({ invoice_date: null })).find((c) => c.id === 'date')?.detail ?? '',
    /geen datum/, 'and it says which of the two it is',
  )
  assert.equal(outcome(clean({ invoice_number: null }), 'number'), 'flagged')
  assert.match(
    invoiceChecks(clean({ invoice_number: null })).find((c) => c.id === 'number')?.detail ?? '',
    /geen nummer/,
  )
})

test('[CHECKLIST] the summary never claims completeness it does not have', () => {
  // The sentence that would undo the whole feature: "alles gecontroleerd" over a check that was
  // skipped. The owner would stop looking on the strength of something the app never did.
  const partial = invoiceChecks(clean({ field_confidence: { _safecore: { iban_check_unavailable: true } } }))
  const summary = checksSummary(partial)
  assert.doesNotMatch(summary, /Alle \d+ controles/, 'a skipped check must break the "all done" claim')
  assert.match(summary, /konden we niet nagaan/, 'and it must say so, not just stay quieter')
  assert.match(summary, /7 van de 8/, 'with the real numbers')
})

test('[CHECKLIST] a flagged invoice leads with the thing to look at', () => {
  const broken = invoiceChecks(clean({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130 }))
  assert.equal(broken.find((c) => c.id === 'arithmetic')?.outcome, 'flagged')
  assert.match(checksSummary(broken), /Eén ding om even naar te kijken/)

  const two = invoiceChecks(clean({
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130,
    field_confidence: { _safecore: { possible_duplicate: true, possible_duplicate_of: '26035350' } },
  }))
  assert.match(checksSummary(two), /2 dingen om even naar te kijken/)
  assert.match(
    two.find((c) => c.id === 'duplicate')?.detail ?? '', /26035350/,
    'a duplicate names the invoice it looks like — otherwise the owner cannot check it',
  )
})

test('[CHECKLIST] a changed rekeningnummer says both numbers and what to do', () => {
  // The one row where the detail IS the product: a warned owner who phones the number printed on
  // the forged invoice phones the fraudster.
  const flagged = invoiceChecks(clean({
    field_confidence: { _safecore: { iban_changed: true, iban_changed_from: 'NL65RABO0171136276', iban_changed_to: 'NL02INGB0000000123' } },
  }))
  const iban = flagged.find((c) => c.id === 'iban')
  assert.equal(iban?.outcome, 'flagged')
  assert.match(iban?.detail ?? '', /NL65RABO0171136276/, 'the number they used before')
  assert.match(iban?.detail ?? '', /zelf opzoekt/, 'and the instruction that saves them')
})

test('[CHECKLIST] a kassabon is not asked for an invoice number', () => {
  // A receipt carries no factuurnummer and does not have to — a row about it would put an
  // unanswerable question on every bon. Same reasoning classifyImportHealth uses.
  const bon = invoiceChecks(clean({ invoice_number: null, field_confidence: { _intake_kind: 'receipt' } }))
  assert.equal(bon.find((c) => c.id === 'number'), undefined, 'the row is absent, not "not-checked"')
  assert.equal(bon.length, 7)
  assert.match(checksSummary(bon), /Alle 7 controles gedaan/, 'and the count follows the list it describes')
})

test('[CHECKLIST] the invoice that showed seven green ticks over a wrong btw', () => {
  // Enka Horeca 26701681, verbatim. Stored: excl 1.213,50 · btw 122,18 · totaal 1.335,68 — which
  // add up, so the arithmetic row is right to pass. On the paper the per-rate block is 9% and 21%,
  // and the real btw is 122,64. THIS is the row that has to refuse a tick, because a blended rate
  // is compared with nothing at all.
  const enka = clean({
    invoice_number: '26701681',
    invoice_date: '2026-01-30',
    total_ex_btw: 1213.5,
    btw_amount: 122.18,
    total_inc_btw: 1335.68,
  })
  assert.equal(outcome(enka, 'arithmetic'), 'passed', 'the three stored amounts genuinely do add up')
  assert.equal(outcome(enka, 'btw-split'), 'not-checked', 'and the btw itself was verified by nothing')

  const summary = checksSummary(invoiceChecks(enka))
  assert.doesNotMatch(summary, /Alle \d+ controles/, 'so the list may NOT claim it checked everything')
  assert.match(summary, /konden we niet nagaan/)

  // Negative control: the identical invoice with the CORRECT btw is equally unverifiable. That is
  // the honest answer — the app cannot tell these two apart without reading the per-rate block, and
  // a row that passed on one of them would be guessing on both.
  const correct = clean({ total_ex_btw: 1213.5, btw_amount: 122.64, total_inc_btw: 1336.14 })
  assert.equal(outcome(correct, 'btw-split'), 'not-checked')
})

test('[CHECKLIST] with the per-rate block stored, the btw row can finally answer', () => {
  const rows = [
    { rate: 9, base: 1101.38, btw: 99.06 },
    { rate: 21, base: 112.12, btw: 23.58 },
  ]
  const wrong = clean({
    total_ex_btw: 1213.5, btw_amount: 122.18, total_inc_btw: 1335.68,
    field_confidence: { _btw_rows: rows },
  })
  assert.equal(outcome(wrong, 'btw-split'), 'flagged', 'the printed block does not sum to what we stored')
  assert.match(
    invoiceChecks(wrong).find((c) => c.id === 'btw-split')?.detail ?? '',
    /122,64/, 'and it names the figure the invoice actually adds up to',
  )

  const right = clean({
    total_ex_btw: 1213.5, btw_amount: 122.64, total_inc_btw: 1336.14,
    field_confidence: { _btw_rows: rows },
  })
  assert.equal(outcome(right, 'btw-split'), 'passed', 'a mixed-rate invoice earns its tick this way')
})

test('[CHECKLIST] an amount WE computed is not an amount we checked', () => {
  // [PRINTED-TOTAL] The reader returned excl + btw and no printed total, so we subtracted our way
  // to one. "excl + btw = totaal" then holds because we made it hold. Reporting that as a passed
  // check hands the owner our own arithmetic back as a fact about their invoice.
  const derived = clean({ field_confidence: { _total_derived: 'total' } })
  assert.equal(outcome(derived, 'arithmetic'), 'not-checked')
  assert.match(
    invoiceChecks(derived).find((c) => c.id === 'arithmetic')?.detail ?? '',
    /wij hebben het/, 'and it says whose arithmetic it is',
  )
  assert.doesNotMatch(checksSummary(invoiceChecks(derived)), /Alle \d+ controles/)

  // A genuine contradiction still outranks it: flagged is louder than not-checked, and an invoice
  // whose numbers disagree must never be softened into a grey "we could not look".
  const alsoBroken = clean({
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130,
    field_confidence: { _total_derived: 'total' },
  })
  assert.equal(outcome(alsoBroken, 'arithmetic'), 'flagged')
})

test('[CHECKLIST] the kind of document is stated, not only warned about', () => {
  const ordinary = invoiceChecks(clean())
  assert.equal(ordinary.find((c) => c.id === 'kind')?.label, 'Dit is een gewone factuur')

  const credit = invoiceChecks(clean({ invoice_type: 'creditnota', total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }))
  const kind = credit.find((c) => c.id === 'kind')
  assert.equal(kind?.label, 'Dit is een creditnota')
  assert.equal(kind?.outcome, 'passed', 'a correctly booked credit note is not a problem')
  assert.match(kind?.detail ?? '', /van je openstaande saldo af/)

  // The one that matters: booked as a credit note, amounts still positive.
  const conflict = invoiceChecks(clean({ invoice_type: 'creditnota', total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 }))
  assert.equal(conflict.find((c) => c.id === 'kind')?.outcome, 'flagged')
})

test('[CHECKLIST-BEIDE] a flagged invoice still reports the checks that could not run', () => {
  // Measured on a real invoice: one red point (the supplier's bank account had changed) under the
  // heading "Eén ding om even naar te kijken" — while the btw amount had not been verified at all,
  // because the invoice mixes rates. The owner reads "one thing", deals with that one thing, and
  // never learns the btw went unchecked. Two open points become one, in their disfavour.
  //
  // This is the same overstatement the test above this one guards, in the branch it does not
  // reach: that one covers "alles gecontroleerd" when nothing is flagged.
  const both = invoiceChecks(clean({
    total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130,
    field_confidence: { _safecore: { iban_check_unavailable: true } },
  }))
  assert.ok(both.some((c) => c.outcome === 'flagged'), 'the fixture must flag something')
  assert.ok(both.some((c) => c.outcome === 'not-checked'), '…and leave something unchecked')

  const summary = checksSummary(both)
  assert.match(summary, /om even naar te kijken/, 'the flagged count still leads')
  assert.match(summary, /konden we niet nagaan/, '…and the unknown is not swallowed by it')
})

test('[CHECKLIST-BEIDE] nothing is added when every check actually ran', () => {
  // The ordinary flagged invoice must not grow a clause about zero unknowns.
  const only = invoiceChecks(clean({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130 }))
  assert.equal(only.filter((c) => c.outcome === 'not-checked').length, 0)
  assert.equal(checksSummary(only), 'Eén ding om even naar te kijken')
})

test('[CHECKLIST-BEIDE] one unknown reads as one, several read as several', () => {
  // Dutch: "1 controle" against "3 controles". A count sentence that does not agree with itself
  // reads as a template nobody finished.
  const one = checksSummary([
    { id: 'a', label: 'a', outcome: 'flagged' },
    { id: 'b', label: 'b', outcome: 'not-checked' },
  ] as never)
  assert.match(one, /1 controle konden we niet nagaan/)
  assert.doesNotMatch(one, /1 controles/)

  const many = checksSummary([
    { id: 'a', label: 'a', outcome: 'flagged' },
    { id: 'b', label: 'b', outcome: 'not-checked' },
    { id: 'c', label: 'c', outcome: 'not-checked' },
  ] as never)
  assert.match(many, /2 controles konden we niet nagaan/)
})
