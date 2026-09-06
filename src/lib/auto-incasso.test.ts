// [AUTO-INCASSO] Pure node test — run: npx tsx --test src/lib/auto-incasso.test.ts
//
// What is being held here is a function that books money nobody watched leave. Every assertion
// below is one of the fences around that: the timing (never before the collection ran), the date
// it books on (the vervaldatum, because the kasstelsel reads it), and the eight states in which
// the invoice itself is not trustworthy enough to settle automatically.
//
// The negative half matters more than the positive half. `settle: true` on a clean rent invoice
// is the easy case; it is `settle: false` on the duplicate, the changed IBAN and the creditnota
// that keep this from becoming a way to make debts disappear.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  incassoDecision,
  incassoDisplayState,
  incassoLabel,
  withIncassoMark,
  wasAutoIncasso,
  INCASSO_HOLD_REASON,
  AUTO_INCASSO_MARKER,
  type IncassoInvoice,
  type IncassoHold,
} from './auto-incasso'

const TODAY = '2026-08-03'

/** A WonenBreburg rent invoice as it actually stands in the book: due 01-08, still 'received'. */
const rent = (over: Partial<IncassoInvoice> = {}): IncassoInvoice => ({
  id: 'i1',
  status: 'received',
  direction: 'incoming',
  accountant_status: null,
  due_date: '2026-08-01',
  client_name: 'WonenBreburg',
  invoice_number: 'VHF0001107004',
  invoice_type: 'factuur',
  invoice_date: '2026-07-15',
  total_ex_btw: 83.70,
  btw_amount: 0,
  total_inc_btw: 83.70,
  field_confidence: null,
  ...over,
})

/** The hold this invoice lands on, or null when it settles. Keeps the assertions one line each. */
function hold(inv: IncassoInvoice, today = TODAY): IncassoHold | null {
  const d = incassoDecision(inv, today)
  return d.settle ? null : d.hold
}

// ─── The case the feature exists for ──────────────────────────────────────────

test('[AUTO-INCASSO] a collected rent invoice is booked on its vervaldatum', () => {
  const d = incassoDecision(rent(), TODAY)
  assert.equal(d.settle, true, 'a clean, past-due invoice from an incasso supplier must settle')
  assert.equal(
    d.settle && d.paymentDate, '2026-08-01',
    'it must book on the day the bank moved the money, not the day the cron happened to run — ' +
      'under the kasstelsel that date picks the BTW-kwartaal',
  )
})

test('[AUTO-INCASSO] the amount is never a condition', () => {
  // The rule this replaces was "same supplier AND same amount". Rent is indexed every 1 July and
  // a supplier sends more than one invoice — the two WonenBreburg rows that started this differ
  // by € 8,74. Both must settle; neither amount is special.
  for (const total of [83.70, 74.96, 1204.55, 0.01]) {
    const d = incassoDecision(rent({ total_ex_btw: total, total_inc_btw: total }), TODAY)
    assert.equal(d.settle, true, `€ ${total} was refused — an amount rule has crept back in`)
  }
})

// ─── Timing: never before the money is gone ───────────────────────────────────

test('[AUTO-INCASSO] nothing is booked before the vervaldatum has passed', () => {
  assert.equal(hold(rent({ due_date: '2026-08-10' })), 'not-yet-due', 'a future collection is not a payment')
  assert.equal(
    hold(rent({ due_date: TODAY })), 'not-yet-due',
    'on the day itself the collection may still be running — the money is not gone yet',
  )
  assert.equal(hold(rent({ due_date: '2026-08-02' })), null, 'the day after, it has run')
})

test('[AUTO-INCASSO] an invoice without a vervaldatum is never booked', () => {
  assert.equal(
    hold(rent({ due_date: null })), 'no-due-date',
    'with no date there is nothing to book ON, and today would be a guess that lands in a kwartaal',
  )
})

// ─── The invoice must be settleable at all ────────────────────────────────────

test('[AUTO-INCASSO] only an OPEN incoming invoice is a candidate', () => {
  assert.equal(hold(rent({ direction: 'outgoing' })), 'not-incoming', 'nobody collects from us')
  assert.equal(hold(rent({ status: 'paid' })), 'not-open')
  assert.equal(hold(rent({ status: 'processing' })), 'not-open', 'an unverified row must never reach the BTW figures')
  assert.equal(hold(rent({ status: 'archived' })), 'not-open')
  assert.equal(hold(rent({ accountant_status: 'verwerkt' })), 'verwerkt', 'the accountant closed it')
})

test('[AUTO-INCASSO] a creditnota is never "collected"', () => {
  // Both shapes: the one booked correctly as a creditnota, and the one that is simply negative
  // because that is how the supplier put it on paper. Marking either paid settles a debt that
  // runs the other way — the app would record money leaving that is in fact coming back.
  assert.equal(hold(rent({ invoice_type: 'creditnota', total_inc_btw: -83.70, total_ex_btw: -83.70 })), 'creditnota')
  assert.equal(hold(rent({ total_inc_btw: -83.70, total_ex_btw: -83.70 })), 'creditnota')
})

test('[AUTO-INCASSO] an invoice with no amount is not settled', () => {
  assert.equal(hold(rent({ total_inc_btw: 0, total_ex_btw: 0 })), 'no-amount')
  assert.equal(hold(rent({ total_inc_btw: null, total_ex_btw: null, btw_amount: null })), 'no-amount')
})

// ─── The invoice must be TRUSTWORTHY, not merely settleable ───────────────────

test('[AUTO-INCASSO] a changed rekeningnummer is the last thing that may be auto-paid', () => {
  // [IBAN-WISSEL] This is the signature of invoice fraud, and the case where every other check
  // reads clean on purpose. An automatic booking here would mark the fraudulent invoice paid and
  // take it off the screen the owner would otherwise have looked at.
  const flagged = rent({
    field_confidence: { _safecore: { iban_changed: true, iban_changed_from: 'NL65RABO0171136276', iban_changed_to: 'NL02INGB0000000123' } },
  })
  assert.equal(hold(flagged), 'iban-changed')
  assert.match(INCASSO_HOLD_REASON['iban-changed'], /controleer dit eerst zelf/, 'the owner must be told to check it themselves')
})

test('[AUTO-INCASSO] a possible duplicate is held, not booked twice', () => {
  const dup = rent({ field_confidence: { _safecore: { possible_duplicate: true, possible_duplicate_of: 'VHF0001107004' } } })
  assert.equal(hold(dup), 'duplicate', 'booking both copies pays a debt that exists once')
})

test('[AUTO-INCASSO] a file that held several invoices is held', () => {
  const multi = rent({ field_confidence: { _safecore: { multiple_invoices: true } } })
  assert.equal(hold(multi), 'multiple-invoices', 'one invoice was read; the others exist nowhere')
})

test('[AUTO-INCASSO] a breakdown that does not add up is held', () => {
  // The amount is the whole content of the booking. If excl + btw ≠ incl, the app does not know
  // what was collected, and an automatic settlement would put that unknown into the aangifte.
  const broken = rent({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 130 })
  assert.equal(hold(broken), 'arithmetic')
})

test('[AUTO-INCASSO] every hold says something a person can act on', () => {
  const holds: IncassoHold[] = [
    'not-incoming', 'not-open', 'verwerkt', 'creditnota', 'no-due-date',
    'not-yet-due', 'no-amount', 'duplicate', 'iban-changed', 'multiple-invoices', 'arithmetic',
  ]
  for (const h of holds) {
    const reason = INCASSO_HOLD_REASON[h]
    assert.ok(reason && reason.length > 15, `${h} has no owner-facing reason — a held invoice with no explanation reads as a broken feature`)
    assert.doesNotMatch(reason, /[A-Z_]{4,}/, `${h} leaks a code into a sentence the owner reads: "${reason}"`)
  }
})

// ─── What the card shows before anything is booked ────────────────────────────

test('[AUTO-INCASSO] the card knows the difference between "will be" and "was"', () => {
  assert.equal(incassoDisplayState(rent({ due_date: '2026-08-20' }), true, TODAY), 'awaiting')
  assert.equal(incassoDisplayState(rent({ due_date: '2026-08-01' }), true, TODAY), 'collected')
  assert.equal(incassoDisplayState(rent(), false, TODAY), null, 'not an incasso supplier → nothing')
  assert.equal(incassoDisplayState(rent({ status: 'paid' }), true, TODAY), null, 'a settled invoice needs no incasso line')
})

test('[AUTO-INCASSO] a held invoice still reads as an incasso invoice', () => {
  // The one that would put the danger back. A duplicate-flagged incasso invoice is held from
  // booking — but it is still collected by the bank, so the card must NOT fall back to showing
  // "Betalen". The display state deliberately does not consult the holds.
  const dup = rent({ field_confidence: { _safecore: { possible_duplicate: true } } })
  assert.equal(hold(dup), 'duplicate', 'precondition: this one is held')
  assert.equal(
    incassoDisplayState(dup, true, TODAY), 'collected',
    'a held invoice that lost its incasso badge would get the Betalen button back — and paying it ' +
      'is exactly the double payment this whole feature exists to prevent',
  )
})

test('[AUTO-INCASSO] the label says who does it and when', () => {
  assert.equal(incassoLabel('awaiting', '1 aug'), 'Wordt automatisch afgeschreven op 1 aug')
  assert.equal(incassoLabel('awaiting', null), 'Wordt automatisch afgeschreven', 'no date is still worth saying')
  assert.equal(incassoLabel('collected', '1 aug'), 'Automatisch afgeschreven')
})

// ─── [INCASSO-ONGEDAAN] The owner's correction has to survive the next hour ────

test('[INCASSO-ONGEDAAN] an invoice we booked once and that is open again is NOT booked again', () => {
  // The loop this closes: the idempotency key is derived from the invoice and its vervaldatum, so
  // it is identical on every run — but it is STORED in the bank_tx_invoices row, and the undo
  // (/api/invoice/pay-toggle) deletes that row. The replay lookup then misses, the selection still
  // matches (status 'received', direction incoming), and the pass books the whole balance again,
  // hourly, for as long as the supplier stays marked.
  //
  // The marker is written only AFTER a successful booking, so carrying it while standing at
  // 'received' means exactly one thing: the payment we assumed was reversed.
  const undone = rent({
    field_confidence: withIncassoMark(null, { at: '2026-08-01T09:00:00Z', paid_on: '2026-08-01', supplier: 'WonenBreburg' }),
  })
  assert.equal(hold(undone), 'undone', 'a reversed auto-incasso booking was re-booked')
})

test('[INCASSO-ONGEDAAN] the owner is told why, in words, not left watching it flip back', () => {
  // Every hold carries its own sentence for the same reason the type says: "a held invoice keeps
  // standing open, and an unexplained one looks like the feature is broken".
  assert.ok(INCASSO_HOLD_REASON.undone.length > 0)
  assert.match(INCASSO_HOLD_REASON.undone, /openstaand/, 'the reason must name what the owner did')
})

test('[INCASSO-ONGEDAAN] it does not fire on an invoice that was never auto-booked', () => {
  // The narrowness matters: holding a clean invoice would stop the feature working at all. Only
  // the marker this module itself writes counts — not any other field_confidence content.
  assert.equal(hold(rent({ field_confidence: null })), null, 'a clean invoice must still settle')
  assert.equal(
    hold(rent({ field_confidence: { vendor: 0.98, _safecore: { arithmetic_ok: true } } })),
    null,
    'ordinary AI confidence scores were mistaken for the incasso marker',
  );
  assert.equal(hold(rent({ field_confidence: {} })), null)
})

test('[INCASSO-ONGEDAAN] a still-paid invoice is held as not-open, not as undone', () => {
  // Order matters. An invoice that is still 'paid' has not been reversed at all — reporting it as
  // "you put this back" would be a sentence about something the owner never did.
  const stillPaid = rent({
    status: 'paid',
    field_confidence: withIncassoMark(null, { at: 'x', paid_on: '2026-08-01', supplier: null }),
  })
  assert.equal(hold(stillPaid), 'not-open')
})

// ─── The assumption is recorded as an assumption ──────────────────────────────

test('[AUTO-INCASSO] an assumed payment is marked as one, without disturbing the rest', () => {
  // payment_method stays 'bank' because that is true — the money left the bank account. So
  // nothing in the row itself would otherwise separate a payment the app watched arrive from one
  // it inferred, and a storno would be invisible.
  const existing = { vendor: 0.98, _safecore: { arithmetic_ok: true }, _intake_kind: 'invoice' }
  const merged = withIncassoMark(existing, { at: '2026-08-03T09:00:00Z', paid_on: '2026-08-01', supplier: 'WonenBreburg' })

  assert.equal(wasAutoIncasso(merged), true)
  assert.equal((merged as { vendor: number }).vendor, 0.98, 'the AI scores must survive')
  assert.deepEqual((merged as { _safecore: unknown })._safecore, { arithmetic_ok: true }, 'the safecore block must survive')
  assert.equal((merged[AUTO_INCASSO_MARKER] as { paid_on: string }).paid_on, '2026-08-01')

  assert.equal(wasAutoIncasso(existing), false, 'an ordinary invoice is not marked')
  assert.equal(wasAutoIncasso(null), false)
  assert.equal(wasAutoIncasso('nonsense'), false, 'a non-object must not throw')
  assert.deepEqual(
    withIncassoMark(null, { at: 'x', paid_on: 'y', supplier: null }),
    { [AUTO_INCASSO_MARKER]: { at: 'x', paid_on: 'y', supplier: null } },
    'an invoice with no field_confidence yet must still get the marker',
  )
})

// ── [DUBBEL-INCASSO] Het nummer dat twee keer in de administratie staat ────────────────────────
//
// Gemeten op de live administratie. Enka Horeca 26701681 stond DRIE keer — drie lezingen van één
// document, op € 1.335,68, € 1.336,14 en € 1.348,14 — en deze pas boekte er twee als betaald,
// binnen 250 milliseconden, op een datum waarop de bank niets deed. Twee inkoopfacturen waar er één
// is, voorbelasting twee keer afgetrokken, en de échte afschrijving van € 1.336,14 stond nog
// ongekoppeld in de wachtrij.
//
// De duplicaatcontrole die er al stond kón dit niet zien: _safecore.possible_duplicate wordt bij de
// IMPORT berekend en sleutelt op het BEDRAG. Drie lezingen die het over het bedrag ONEENS zijn,
// zijn voor haar drie verschillende facturen — en juist die soort duplicaat is de gevaarlijke,
// want elke kopie boekt haar eigen verkeerde totaal.

const enka = (over: Partial<IncassoInvoice> = {}): IncassoInvoice => rent({
  id: 'enka-1',
  client_name: 'Enka Horeca B.V.',
  invoice_number: '26701681',
  invoice_date: '2026-01-30',
  due_date: '2026-03-01',
  total_ex_btw: 1213.50,
  btw_amount: 122.18,
  total_inc_btw: 1335.68,
  ...over,
})

test('[DUBBEL-INCASSO] hetzelfde factuurnummer op twee rijen wordt niet geboekt', () => {
  // Zonder context boekt hij — dat is de toestand van 5 augustus, en zij was fout.
  assert.deepEqual(incassoDecision(enka(), TODAY), { settle: true, paymentDate: '2026-03-01' })

  const d = incassoDecision(enka(), TODAY, { sameNumberElsewhere: true })
  assert.equal(d.settle, false)
  if (d.settle) return
  assert.equal(d.hold, 'same-number')
  assert.match(
    INCASSO_HOLD_REASON[d.hold], /staat nog een keer/,
    'de reden moet zeggen WAT er aan de hand is — "we boeken hem niet" zonder waarom is een ' +
      'factuur die blijft staan zonder dat iemand weet waarom',
  )
})

test('[DUBBEL-INCASSO] en de kopie die het over het bedrag ONEENS is, wordt net zo goed gehouden', () => {
  // De derde lezing: € 12,00 te veel btw. Een bedragregel ziet hier geen duplicaat; het nummer wel.
  const derde = enka({ id: 'enka-3', btw_amount: 134.64, total_inc_btw: 1348.14 })
  const d = incassoDecision(derde, TODAY, { sameNumberElsewhere: true })
  assert.equal(d.settle, false)
  if (!d.settle) assert.equal(d.hold, 'same-number')
})

test('[DUBBEL-INCASSO] tegenproef: een nummer dat één keer staat, wordt gewoon geboekt', () => {
  // Zonder deze test slaagt alles hierboven ook als de pas nooit meer iets boekt — en dan staat elke
  // incasso weer voor eeuwig in "nog te betalen", de fout waar [AUTO-INCASSO] voor bestaat.
  assert.deepEqual(
    incassoDecision(enka(), TODAY, { sameNumberElsewhere: false }),
    { settle: true, paymentDate: '2026-03-01' },
  )
  assert.deepEqual(
    incassoDecision(rent({ due_date: '2026-08-01' }), TODAY, { sameNumberElsewhere: false }),
    { settle: true, paymentDate: '2026-08-01' },
  )
})

test('[DUBBEL-INCASSO] de zwaardere weigeringen blijven vóór deze staan', () => {
  // Volgorde is betekenis: een creditnota of een verwerkte factuur mag niet als "dubbel nummer"
  // gerapporteerd worden, want dan gaat de eigenaar het verkeerde nakijken.
  const verwerkt = incassoDecision(enka({ accountant_status: 'verwerkt' }), TODAY, { sameNumberElsewhere: true })
  assert.equal(verwerkt.settle === false && verwerkt.hold, 'verwerkt')
  const credit = incassoDecision(enka({ invoice_type: 'creditnota', total_inc_btw: -1336.14 }), TODAY, { sameNumberElsewhere: true })
  assert.equal(credit.settle === false && credit.hold, 'creditnota')
})
