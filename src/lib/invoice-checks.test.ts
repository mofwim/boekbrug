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
  // Nine since [LEVERANCIER-ID]: the eight original axes plus the IBAN checksum, which appears
  // because the fixture prints an account number. The btw-number row stays away — the fixture
  // carries no read btw id, and a row about a number nobody printed is a permanent grey nothing.
  assert.equal(checks.length, 9, 'all nine axes are reported')
  assert.equal(checksPassed(checks), 9, 'and on a clean invoice every one of them passed')
  assert.match(checksSummary(checks), /Alle 9 controles gedaan/, 'the summary may claim completeness ONLY here')
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
  assert.match(summary, /8 van de 9/, 'with the real numbers')
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
  assert.equal(bon.length, 8)
  assert.match(checksSummary(bon), /Alle 8 controles gedaan/, 'and the count follows the list it describes')
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

// ── [RIJ-VERKEERD-ETIKET] + [ANDER-TOTAAL] The two rows that sent an owner searching ──────────

test('[RIJ-VERKEERD-ETIKET] a mislabeled rate row earns its tick with the relabel said out loud', () => {
  // GROOTHANDEL M.H. BAL 264242: the reader returned "21% over 697,09 = 62,74" — which is exactly
  // 9%. The amounts corroborate; only the label was misread. The row must pass AND say so.
  const checks = invoiceChecks(clean({
    total_ex_btw: 697.09, btw_amount: 62.74, total_inc_btw: 759.83,
    field_confidence: { _btw_rows: [{ rate: 21, base: 697.09, btw: 62.74 }] } as unknown as CheckInput['field_confidence'],
  }))
  const row = checks.find((c) => c.id === 'btw-split')
  assert.ok(row, 'the btw row exists')
  assert.equal(row!.outcome, 'passed')
  assert.match(row!.detail!, /9%/, 'names the rate the amounts fit')
  assert.match(row!.detail!, /misgelezen/, 'and never hides the relabel behind the tick')
})

test('[ANDER-TOTAAL] the total-on-document row names its witness and shows the block that IS printed', () => {
  const checks = invoiceChecks(clean({
    field_confidence: {
      _grounding: { totalIncBtw: 'absent', source: 'ocr', alternative: { ex: 1065.14, btw: 95.54, inc: 1160.68 } },
    } as unknown as CheckInput['field_confidence'],
  }))
  const row = checks.find((c) => c.id === 'total-on-document')
  assert.ok(row, 'the row appears when the total is absent from the witness')
  assert.equal(row!.outcome, 'flagged')
  assert.match(row!.detail!, /blinde leesbeurt/, 'an OCR witness is named as what it is, not as "de tekst"')
  assert.match(row!.detail!, /1\.160,68/, 'the block that IS on the paper lands on the screen')
})

test('[ANDER-TOTAAL] a text witness without an alternative keeps the plain sentence', () => {
  const checks = invoiceChecks(clean({
    field_confidence: { _grounding: { totalIncBtw: 'absent' } } as unknown as CheckInput['field_confidence'],
  }))
  const row = checks.find((c) => c.id === 'total-on-document')
  assert.ok(row)
  assert.match(row!.detail!, /tekst van dit document/)
  assert.doesNotMatch(row!.detail!, /wél/, 'no invented alternative when the witness saw none')
})

// ── [LEVERANCIER-ID] + [STATIEGELD-GAT] The three rows added after the owner's report ─────────

test('[LEVERANCIER-ID] an account number whose checksum fails is flagged, not merely stored', () => {
  // One digit off the fixture's real IBAN. The reader stores what it reads WITHOUT the mod-97
  // check ("future validation at QR-prepare time"), so this reached the pay screen looking
  // ordinary. It is a different failure from the change-check above it: no malice, just a
  // character read or printed wrong — and the money goes nowhere.
  const row = invoiceChecks(clean({ vendor_iban: 'NL66RABO0171136276' })).find((c) => c.id === 'iban-vorm')
  assert.ok(row, 'the row exists when an account number is printed')
  assert.equal(row!.outcome, 'flagged')
  assert.match(row!.detail!, /controlecijfers/)
  assert.match(row!.detail!, /vóór je betaalt/, 'it says WHEN to act — before the money moves')
})

test('[LEVERANCIER-ID] no account number on the invoice: no second row about it', () => {
  // The change-check already says "er staat geen rekeningnummer op deze factuur". Repeating that
  // in a second grey row is noise, and grey that is always there stops being read.
  const checks = invoiceChecks(clean({ vendor_iban: null }))
  assert.equal(checks.find((c) => c.id === 'iban-vorm'), undefined)
  assert.equal(outcome(clean({ vendor_iban: null }), 'iban'), 'not-checked')
})

test('[BTW-NUMMER-GELEZEN] a malformed btw number is named, with the consequence attached', () => {
  // Ten digits where nine belong. The reader drops such a value as a supplier KEY — correct — and
  // that drop used to be the end of it: the one case worth telling the owner about was the one
  // that vanished. art. 35a Wet OB requires a valid number; without it the voorbelasting on this
  // cost is refusable, so the sentence says that rather than "controleer even".
  const row = invoiceChecks(clean({
    field_confidence: { _vendor_btw_printed: 'NL8522448721B01' } as unknown as CheckInput['field_confidence'],
  })).find((c) => c.id === 'btw-nummer')
  assert.ok(row)
  assert.equal(row!.outcome, 'flagged')
  assert.match(row!.detail!, /NL8522448721B01/, 'quotes what is printed, so the owner can compare')
  assert.match(row!.detail!, /voorbelasting/, 'and names what it costs')
})

test('[BTW-NUMMER-GELEZEN] a valid NL id passes; a Belgian supplier is not a false alarm', () => {
  const nl = invoiceChecks(clean({
    field_confidence: { _vendor_btw_printed: 'NL852244872B01' } as unknown as CheckInput['field_confidence'],
  })).find((c) => c.id === 'btw-nummer')
  assert.equal(nl?.outcome, 'passed')
  const be = invoiceChecks(clean({
    field_confidence: { _vendor_btw_printed: 'BE0123456789' } as unknown as CheckInput['field_confidence'],
  })).find((c) => c.id === 'btw-nummer')
  assert.equal(be?.outcome, 'passed', 'per-country rules are not encoded — a valid EU number must not flag')
})

test('[STATIEGELD-GAT] the arithmetic row explains the gap when the paper explains it', () => {
  // Elegance Brands 2026080832: 835,30 + 75,22 under a printed total of 1.086,92. The import found
  // the missing 176,40 beside the word "Statiegeld", so this row stops saying "komt niet uit" and
  // starts saying what to do — including the figure the base becomes.
  const row = invoiceChecks(clean({
    total_ex_btw: 835.3, btw_amount: 75.22, total_inc_btw: 1086.92,
    field_confidence: {
      _statiegeld: { gap: 176.4, label: 'Statiegeld', correctedExcl: 1011.7 },
    } as unknown as CheckInput['field_confidence'],
  })).find((c) => c.id === 'arithmetic')
  assert.ok(row)
  assert.equal(row!.outcome, 'flagged', 'still a flag — the amounts as stored do not add up')
  assert.match(row!.detail!, /€\s?176,40/)
  assert.match(row!.detail!, /Statiegeld/)
  assert.match(row!.detail!, /€\s?1\.011,70/, 'and the base the one tap would produce')
})

test('[STATIEGELD-GAT] a gap the paper does NOT explain keeps the blunt sentence', () => {
  const row = invoiceChecks(clean({
    total_ex_btw: 835.3, btw_amount: 75.22, total_inc_btw: 1086.92, field_confidence: null,
  })).find((c) => c.id === 'arithmetic')
  assert.equal(row?.outcome, 'flagged')
  assert.match(row!.detail!, /komt niet uit op het totaal/, 'nothing may be invented in its place')
})

test('[REKENING-GELEZEN] an unreadable account number is said out loud, never as "none printed"', () => {
  // Same class as the btw number: the reader canonicalises what it finds and DROPS what it cannot
  // use, and that drop destroyed the only evidence the invoice printed one at all. The checklist
  // then told the owner "er staat geen rekeningnummer op deze factuur" about a page that plainly
  // carries one — a false statement about their paper, on the axis where being wrong costs the
  // payment.
  const inv = clean({
    vendor_iban: null,
    field_confidence: { _vendor_iban_printed: 'NL20ABNA04582' } as unknown as CheckInput['field_confidence'],
  })
  const shape = invoiceChecks(inv).find((c) => c.id === 'iban-vorm')
  assert.ok(shape, 'the row appears — something WAS printed')
  assert.equal(shape!.outcome, 'flagged')
  assert.match(shape!.detail!, /NL20ABNA04582/, 'quotes what was read, so the owner can compare')
  assert.match(shape!.detail!, /geen bruikbaar rekeningnummer/)

  const change = invoiceChecks(inv).find((c) => c.id === 'iban')
  assert.equal(change?.outcome, 'not-checked')
  assert.match(change!.detail!, /niet goed lezen/, 'the change-check stops claiming none was printed')
  assert.doesNotMatch(change!.detail!, /er staat geen rekeningnummer/)
})

test('[REKENING-GELEZEN] a page that really prints none keeps the old, true sentence', () => {
  const change = invoiceChecks(clean({ vendor_iban: null, field_confidence: null }))
    .find((c) => c.id === 'iban')
  assert.match(change!.detail!, /er staat geen rekeningnummer op deze factuur/)
})

// ── [WIJ-LAZEN] ───────────────────────────────────────────────────────────────────────────────
//
// A photographed DELMO GROOTHANDEL invoice, measured digit by digit:
//
//   printed  IBAN NL94.INGB.066.66.64.293   → NL94INGB0666664293, mod-97 valid
//   stored                                   NL94INGB0066664293, one 6 read as a 0, invalid
//   printed  BTW-nr. NL0085.41.048B01       → NL008541048B01, a valid Dutch btw-nummer
//   stored                                   NL008085410048B01, three digits too many
//
// Both rows flagged, and both were RIGHT about the value they held. What they said about the
// INVOICE was wrong in a way that costs the owner something: one told them their supplier had
// printed no account number (two are printed, both valid), and the other told them to go back to
// that supplier and ask for a corrected invoice — over a number the app itself had mangled.

test('[WIJ-LAZEN] the checksum row prints the number it is complaining about', () => {
  // Without it the owner is told the check digits are wrong and given nothing to compare against
  // the paper, which is the one action the sentence asks of them.
  const row = invoiceChecks(clean({ vendor_iban: 'NL94INGB0066664293' })).find((c) => c.id === 'iban-vorm')
  assert.ok(row)
  assert.equal(row!.outcome, 'flagged')
  assert.match(row!.detail!, /NL94INGB0066664293/,
    'the row withholds the very number it says is wrong — there is nothing to hold against the invoice')
  assert.match(row!.detail!, /wij lazen/i, 'and it must be OUR reading, not a claim about the paper')
})

test('[WIJ-LAZEN] a malformed btw number sends the owner to the INVOICE before the supplier', () => {
  const row = invoiceChecks(clean({
    field_confidence: { _vendor_btw_printed: 'NL008085410048B01' } as unknown as CheckInput['field_confidence'],
  })).find((c) => c.id === 'btw-nummer')
  assert.ok(row)
  assert.equal(row!.outcome, 'flagged')
  assert.match(row!.detail!, /NL008085410048B01/, 'it still quotes what it holds')
  assert.match(row!.detail!, /voorbelasting/, 'and the tax consequence is real, so it stays')

  // The order is the fix. "Ask your supplier for a corrected invoice" is an instruction to tell a
  // company their paperwork is defective, and here the paperwork was fine.
  const compare = row!.detail!.search(/Vergelijk het met de factuur/);
  const supplier = row!.detail!.search(/vraag de leverancier/i);
  assert.ok(compare >= 0, 'the owner is never asked to look at the invoice first');
  assert.ok(supplier > compare,
    'the owner is sent to their supplier before being asked to look at the paper — on OUR reading');
  assert.match(row!.detail!, /lazen wij het verkeerd/,
    'and the possibility that the fault is ours is never stated');
});

// ── [EERSTE-KEER] ─────────────────────────────────────────────────────────────────────────────
//
// The comment above the iban row lists three states and calls collapsing any two of them "the
// failure this whole file is careful about". There were four. "We compared it and it is unchanged"
// and "we had nothing to compare it with" both arrived as an empty _safecore, and the second one
// therefore earned the tick — and the sentence "ongewijzigd ten opzichte van eerdere facturen",
// which on a first invoice is a claim about invoices that do not exist.
//
// It matters here more than anywhere: mod-97 catches every single-digit misread and every adjacent
// transposition (measured: 0 of 90 and 0 of 5 slip through), so a wrong number that still validates
// is a two-digit error — about 0.8% of them — or a valid number read off the wrong part of the page.
// Against those the only defence is history, and a first invoice has none. Measured on one account:
// 72 invoices, EUR 63,128.41.

test('[EERSTE-KEER] a first invoice from a supplier does not claim the number is unchanged', () => {
  const first = clean({
    vendor_iban: 'NL94INGB0666664293',
    field_confidence: { _safecore: { iban_first_seen: true } } as unknown as CheckInput['field_confidence'],
  })
  const row = invoiceChecks(first).find((c) => c.id === 'iban')
  assert.ok(row)
  assert.notEqual(row!.outcome, 'passed',
    'the strongest reassurance the panel gives, at the one moment there is no history behind it')
  assert.equal(row!.outcome, 'not-checked', 'and not red either — a new supplier is an ordinary event')
  assert.doesNotMatch(row!.detail!, /ongewijzigd/,
    'it still says the number is unchanged from invoices that do not exist')
  assert.match(row!.detail!, /eerste rekeningnummer/, 'it says what actually happened')
  assert.match(row!.detail!, /vóór je betaalt/, 'and hands the comparison to the only party who can make it')
})

test('[EERSTE-KEER] a supplier we have paid before still earns the tick', () => {
  // The counter-proof. If this row stopped passing for everyone, the panel would flag 509 invoices
  // and the flag would mean nothing.
  const known = clean({
    vendor_iban: 'NL94INGB0666664293',
    field_confidence: { _safecore: {} } as unknown as CheckInput['field_confidence'],
  })
  const row = invoiceChecks(known).find((c) => c.id === 'iban')
  assert.equal(row?.outcome, 'passed')
  assert.match(row!.detail!, /ongewijzigd ten opzichte van eerdere facturen/)
})

test('[EERSTE-KEER] a CHANGED number still outranks a first sighting', () => {
  const both = clean({
    vendor_iban: 'NL02RABO0123456789',
    field_confidence: {
      _safecore: { iban_first_seen: true, iban_changed: true, iban_changed_from: 'NL91ABNA0417164300' },
    } as unknown as CheckInput['field_confidence'],
  })
  const row = invoiceChecks(both).find((c) => c.id === 'iban')
  assert.equal(row?.outcome, 'flagged', 'the fraud signal must not be softened into "we did not check"')
  assert.match(row!.detail!, /NL91ABNA0417164300/)
  assert.match(row!.detail!, /bel de leverancier/)
})

