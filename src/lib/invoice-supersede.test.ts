// [SUPERSEDE] Pure node test — run: npx tsx src/lib/invoice-supersede.test.ts
// Locks refuseSupersede: "deze vervangt factuur X" archives another invoice, so the question is
// not only "does it work" but "what can it NEVER reach". Money on the old invoice, an accountant
// lock, and a pair that is not a pair each have to stop it — and stop it with a reason the owner
// can act on, never a silent no-op.

import { refuseSupersede, SUPERSEDE_REFUSAL_TEXT, type SupersedeInvoice } from './invoice-supersede'
import { MESSAGES } from './i18n/messages'

let passed = 0, failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`) }
}

/** The OLD invoice — the wrong one, still in the books, nothing paid on it. */
const oldInv = (o: Partial<SupersedeInvoice> = {}): SupersedeInvoice => ({
  id: 'old', status: 'received', direction: 'incoming', invoice_number: '26302050',
  amount_paid: 0, accountant_status: null, ...o,
})
/** The NEW invoice — the correction, still in the verify queue. */
const newInv = (o: Partial<SupersedeInvoice> = {}): SupersedeInvoice => ({
  id: 'new', status: 'processing', direction: 'incoming', invoice_number: '26302051',
  amount_paid: 0, accountant_status: null, ...o,
})

console.log('\n— the ordinary case: a corrected re-issue replaces the wrong one —')
{
  check('unpaid, in the books, both purchase → allowed', refuseSupersede(oldInv(), newInv()) === null)
}
{
  // The old one may still be in the verify queue itself — both copies often arrive together.
  check('old still in the queue → allowed', refuseSupersede(oldInv({ status: 'processing' }), newInv()) === null)
}
{
  // The replacement may already be verified ('received') without being paid.
  check('replacement already verified → allowed', refuseSupersede(oldInv(), newInv({ status: 'received' })) === null)
}

console.log('\n— money: the wall the owner already hit once —')
{
  // Fully paid. Archiving would take euros that genuinely moved out of kas- en bankoverzicht.
  check('old invoice paid → refused', refuseSupersede(oldInv({ status: 'paid' }), newInv()) === 'money_settled')
}
{
  // A DEELBETALING on an otherwise open invoice — the exact shape of the original bug report
  // (€ 2.000 booked on € 6.662,80). Status alone would have said "open"; amount_paid is what tells.
  check(
    'old invoice partly paid → refused',
    refuseSupersede(oldInv({ status: 'received', amount_paid: 2000 }), newInv()) === 'money_settled',
  )
}
{
  // A cent of noise is not a payment.
  check('sub-cent amount_paid is not money', refuseSupersede(oldInv({ amount_paid: 0.004 }), newInv()) === null)
}
{
  check('the refusal names the way out', /draai die betaling eerst terug/i.test(SUPERSEDE_REFUSAL_TEXT.money_settled))
}

console.log('\n— the accountant outranks the owner, and is named FIRST —')
{
  check('verwerkt → refused', refuseSupersede(oldInv({ accountant_status: 'verwerkt' }), newInv()) === 'verwerkt')
}
{
  // Both true: the road runs through the accountant, so naming the payment would send the owner
  // down a path that ends at the same wall.
  check(
    'verwerkt AND paid → verwerkt is the answer',
    refuseSupersede(oldInv({ accountant_status: 'verwerkt', status: 'paid' }), newInv()) === 'verwerkt',
  )
}

console.log('\n— a pair that is not a pair —')
{
  const same = oldInv()
  check('an invoice cannot replace itself', refuseSupersede(same, same) === 'same_invoice')
}
{
  check(
    'an outgoing invoice is never the target',
    refuseSupersede(oldInv({ direction: 'outgoing' }), newInv()) === 'not_incoming',
  )
}
{
  check(
    'an outgoing replacement is refused too',
    refuseSupersede(oldInv(), newInv({ direction: 'outgoing' })) === 'not_incoming',
  )
}
{
  check(
    'already archived → nothing to replace',
    refuseSupersede(oldInv({ status: 'archived' }), newInv()) === 'already_archived',
  )
}
{
  // A replacement that is itself archived or paid is not a correction the owner is looking at —
  // it is a stale client, and it must not be able to archive anything.
  check(
    'an archived replacement may not supersede',
    refuseSupersede(oldInv(), newInv({ status: 'archived' })) === 'not_supersedable',
  )
  check(
    'a paid replacement may not supersede',
    refuseSupersede(oldInv(), newInv({ status: 'paid' })) === 'not_supersedable',
  )
  check(
    'a draft replacement may not supersede',
    refuseSupersede(oldInv(), newInv({ status: 'draft' })) === 'not_supersedable',
  )
}
{
  // Only an invoice that is IN the books can be taken out of them.
  check(
    'a draft old invoice is not supersedable',
    refuseSupersede(oldInv({ status: 'draft' }), newInv()) === 'not_supersedable',
  )
}
{
  // A missing direction must never be read as "incoming by default".
  check(
    'absent direction → refused, never assumed',
    refuseSupersede(oldInv({ direction: null }), newInv()) === 'not_incoming',
  )
}

console.log('\n— every refusal has words the owner can act on —')
{
  const codes = ['same_invoice', 'not_incoming', 'already_archived', 'money_settled', 'verwerkt', 'not_supersedable'] as const
  check('no refusal is left without a sentence', codes.every((c) => (SUPERSEDE_REFUSAL_TEXT[c] ?? '').length > 10))
}

console.log('\n— the confirmation says what leaves, and that it comes back —')
{
  // [VERVANG] Deze beloftes stonden gepind op supersedeConfirmBody(), een Nederlandse zin naast de
  // regel die nooit werd gerenderd: het scherm toont 'ink.vervang.uitlegMetNr' uit messages.ts, in
  // drie talen. De functie is weg; de beloftes blijven — ze horen bij de tekst die de eigenaar
  // ECHT leest, dus daar staan ze nu op.
  const body = MESSAGES['ink.vervang.uitlegMetNr'].nl
  check('names the invoice being replaced', body.includes('{nr}'))
  check('promises the bewaarplicht', /7 jaar bewaarplicht/.test(body))
  check('names where it goes', /Genegeerd/.test(body))
  check('and says this invoice simply stays in the queue', /wachtrij/.test(body))
}
{
  // Zonder nummer bestaat er een EIGEN zin, in plaats van "factuur  " met een gat erin.
  const zonder = MESSAGES['ink.vervang.uitlegZonderNr'].nl
  check('no number → its own sentence, no dangling label', /De andere factuur/.test(zonder) && !/factuur {2}/.test(zonder))
  check('and it makes the same promise', /7 jaar bewaarplicht/.test(zonder))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
