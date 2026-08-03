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
