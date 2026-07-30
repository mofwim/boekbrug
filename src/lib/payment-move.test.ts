// [MOVE-PAYMENT] Pure node test — run: npx tsx src/lib/payment-move.test.ts
// Locks the rules the picker offers by, and the words a refusal comes back in. The atomic write
// lives in move_invoice_payment (invoice_move_payment.sql); this side must never be MORE
// permissive than that function, because everything it offers the owner will tap.

import {
  canReceivePayment,
  rankMoveTargets,
  remainingOn,
  moveFailureText,
  type MoveTargetCandidate,
  type MovablePayment,
} from './payment-move'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

/** The invoice that WRONGLY holds the payment. */
const source: MoveTargetCandidate = {
  id: 'src', status: 'received', direction: 'incoming', invoice_number: '26302050',
  client_name: 'Atapack B.V.', invoice_date: '2026-05-07', total_inc_btw: 6662.8, amount_paid: 2000,
}
/** The € 2.000 sitting on it. */
const payment: MovablePayment = {
  id: 'link-1', invoice_id: 'src', amount_applied: 2000, transaction_id: 'tx-1', paid_on: null, method: null,
}
const target = (o: Partial<MoveTargetCandidate> = {}): MoveTargetCandidate => ({
  id: 'tgt', status: 'received', direction: 'incoming', invoice_number: '26302051',
  client_name: 'Atapack B.V.', invoice_date: '2026-05-11', total_inc_btw: 2000, amount_paid: 0, ...o,
})

console.log('\n— remainingOn: what a target can still absorb —')
{
  check('open invoice → full total', remainingOn(target()) === 2000)
  check('partly paid → the rest', remainingOn(target({ amount_paid: 500 })) === 1500)
  check('over-paid never goes negative', remainingOn(target({ amount_paid: 9999 })) === 0)
  check('a credit total counts by magnitude', remainingOn(target({ total_inc_btw: -2000 })) === 2000)
}

console.log('\n— the ordinary case —')
{
  check('exact fit → allowed', canReceivePayment(payment, target(), 'incoming').ok)
  check('room to spare → allowed', canReceivePayment(payment, target({ total_inc_btw: 5000 }), 'incoming').ok)
}
{
  // One cent of OCR drift must not block a payment that plainly settles the invoice.
  check('a cent short → still allowed', canReceivePayment(payment, target({ total_inc_btw: 1999.99 }), 'incoming').ok)
}

console.log('\n— money may never be silently split or over-applied —')
{
  const r = canReceivePayment(payment, target({ total_inc_btw: 1500 }), 'incoming')
  check('too little open → refused', !r.ok && r.reason === 'too_small')
}
{
  const r = canReceivePayment(payment, target({ amount_paid: 1000 }), 'incoming')
  check('partly paid target with too little left → refused', !r.ok && r.reason === 'too_small')
}
{
  check(
    'the refusal explains the choice, not just the no',
    /overbetalen/.test(moveFailureText('[MOVE-PAYMENT] target remaining 1500 is less than payment 2000')),
  )
}

console.log('\n— the guards that mirror the RPC —')
{
  const r = canReceivePayment(payment, target({ id: 'src' }), 'incoming')
  check('cannot move onto itself', !r.ok && r.reason === 'same_invoice')
}
{
  const r = canReceivePayment(payment, target({ direction: 'outgoing' }), 'incoming')
  check('a supplier payment cannot settle a sales invoice', !r.ok && r.reason === 'direction')
}
{
  const r = canReceivePayment(payment, target({ accountant_status: 'verwerkt' }), 'incoming')
  check('the accountant lock stops it', !r.ok && r.reason === 'verwerkt')
}
{
  // 'processing' is an UNVERIFIED purchase invoice — its amounts came from the AI and nobody has
  // read them. Paid feeds the BTW figures, so money may never land there through this door.
  const r = canReceivePayment(payment, target({ status: 'processing' }), 'incoming')
  check('an unverified invoice may not receive money', !r.ok && r.reason === 'not_payable')
}
{
  for (const status of ['archived', 'draft', 'paid']) {
    const r = canReceivePayment(payment, target({ status }), 'incoming')
    check(`status '${status}' is not payable`, !r.ok && r.reason === 'not_payable')
  }
}
{
  const r = canReceivePayment(payment, target({ total_inc_btw: 0 }), 'incoming')
  check('no total to settle → refused', !r.ok && r.reason === 'no_total')
}
{
  // The same bank line already pays this invoice — a second link would break the unique pair, and
  // merging the two would silently turn two bookings into one.
  const r = canReceivePayment(payment, target(), 'incoming', new Set(['tgt']))
  check('target already on this bank line → refused', !r.ok && r.reason === 'already_linked')
}
{
  // A MANUAL instalment has no bank line, so that collision cannot apply to it.
  const manual = { ...payment, transaction_id: null }
  check('a manual payment is not blocked by the pair rule', canReceivePayment(manual, target(), 'incoming', new Set(['tgt'])).ok)
}

console.log('\n— ranking: the top row is the one that gets tapped without reading —')
{
  const ranked = rankMoveTargets(payment, source, [
    target({ id: 'other-vendor', client_name: 'Jansen Groothandel', invoice_date: '2026-05-08' }),
    target({ id: 'same-vendor', client_name: 'Atapack B.V.', invoice_date: '2026-06-20' }),
  ])
  check('same supplier outranks a nearer date', ranked[0]?.id === 'same-vendor')
}
{
  const ranked = rankMoveTargets(payment, source, [
    target({ id: 'roomy', total_inc_btw: 9000, invoice_date: '2026-05-08' }),
    target({ id: 'exact', total_inc_btw: 2000, invoice_date: '2026-09-01' }),
  ])
  check('an exact-amount fit outranks a nearer date', ranked[0]?.id === 'exact')
}
{
  const ranked = rankMoveTargets(payment, source, [
    target({ id: 'far', invoice_date: '2026-12-01' }),
    target({ id: 'near', invoice_date: '2026-05-08' }),
  ])
  check('otherwise the nearest date wins', ranked[0]?.id === 'near')
}
{
  const ranked = rankMoveTargets(payment, source, [
    target({ id: 'no', status: 'processing' }),
    target({ id: 'yes' }),
  ])
  check('ineligible candidates never reach the list', ranked.length === 1 && ranked[0].id === 'yes')
}
{
  check('nothing eligible → an empty list, not a wrong suggestion', rankMoveTargets(payment, source, []).length === 0)
}

console.log('\n— every refusal reaches the owner as a sentence —')
{
  const cases: [string, RegExp][] = [
    ['[MOVE-PAYMENT] payment not found', /bestaat niet meer/],
    ['[MOVE-PAYMENT] same invoice', /staat al op deze factuur/],
    ['[MOVE-PAYMENT] payment has no recorded amount', /geen bedrag vastgelegd/],
    ['[MOVE-PAYMENT] target already linked to this transaction', /al aan die factuur gekoppeld/],
    ['[MOVE-PAYMENT] invoice locked by accountant (verwerkt)', /boekhouder/],
    ['[MOVE-PAYMENT] direction mismatch', /verkoopfactuur/],
    ['[MOVE-PAYMENT] target not payable', /wachtrij/],
    ['[MOVE-PAYMENT] target has no total to settle', /geen bedrag/],
    ['[MOVE-PAYMENT] target remaining 10 is less than payment 20', /overbetalen/],
    ['[MOVE-PAYMENT] source invoice not found / not owned', /bestaat niet meer/],
  ]
  check('each known refusal has its own words', cases.every(([msg, re]) => re.test(moveFailureText(msg))))
}
{
  // The move is atomic, so an UNKNOWN failure still means nothing changed — and saying so is the
  // whole point: an owner who is unsure whether the money moved will go looking, or move it twice.
  const t = moveFailureText('something nobody predicted')
  check('an unknown failure still states that nothing changed', /niets gewijzigd/.test(t))
  check('…and so does a null message', /niets gewijzigd/.test(moveFailureText(null)))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
