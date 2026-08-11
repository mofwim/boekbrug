// [EERLIJK-GEBRUIK-UITLEG] Pure node test — run: npx tsx --test src/lib/fair-use-notice.test.ts
//
// The reported case: hitting the monthly limit appeared as a toast that faded in a few seconds,
// saying only what pauses and never that a LIMIT had been reached, which one, or where the owner
// stands against it. What is tested here is the content of the replacement — that it names the
// event, quotes the PUBLISHED numbers rather than invented ones, and never states a figure it
// cannot back.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fairUseNotice, isFairUseRefusal } from './fair-use-notice'
import { FAIR_USE_LIMITS } from './fair-use'

/** A 402 exactly as fair-use-gate.ts writes it. */
const REFUSAL = {
  error:
    'Nieuwe documenten worden nog wel bewaard, maar niet meer automatisch gelezen tot de volgende maand of tot je upgradet. Je kunt ze zelf invullen.',
  reason: 'fair_use',
  metric: 'aiDocuments',
  used: 50,
  limit: 50,
  plan: 'free',
  wachten: 'De teller begint op de 1e van de volgende maand weer bij nul.',
  upgradeUrl: '/prijzen',
  beleidUrl: '/eerlijk-gebruik',
}

test('[EERLIJK-GEBRUIK-UITLEG] the reported case: it names the limit, and where you stand', () => {
  const n = fairUseNotice(REFUSAL)!
  assert.ok(n, 'a fair-use refusal must produce a notice')
  // The toast said only what pauses. The title says what HAPPENED.
  assert.match(n.title, /gratis documenten/i)
  assert.equal(n.count, 'Je hebt deze maand 50 van de 50 gebruikt.')
  // Reassurance exists and is separate from the restriction.
  assert.match(n.stillWorks, /blijven bewaard|niets verloren/i)
  // And the restriction is the published sentence, verbatim.
  assert.equal(n.pauses, REFUSAL.error)
  assert.match(n.resets, /1e van de volgende maand/)
})

test('[EERLIJK-GEBRUIK-UITLEG] only a fair-use refusal opens it', () => {
  // Keyed on the reason, never on the 402 status: a payment provider answers 402 too, and a
  // monthly-allowance explanation would be nonsense there.
  assert.equal(fairUseNotice({ error: 'Card declined' }), null)
  assert.equal(fairUseNotice({ reason: 'rate_limit' }), null)
  assert.equal(fairUseNotice(null), null)
  assert.equal(fairUseNotice('fair_use'), null, 'a bare string is not a payload')
  assert.equal(isFairUseRefusal(REFUSAL), true)
})

test('[EERLIJK-GEBRUIK-UITLEG] the numbers come from the published table, not from the screen', () => {
  // /eerlijk-gebruik, Instellingen › Facturering and this modal all read FAIR_USE_LIMITS. A
  // hand-written "50 documenten" anywhere is a fourth place that can disagree with a promise.
  const ai = FAIR_USE_LIMITS.find((l) => l.key === 'aiDocuments')!
  const n = fairUseNotice({ ...REFUSAL, limit: undefined })!
  assert.ok(n.count!.includes(String(ai.free)), 'the free limit falls back to the published one')
  assert.equal(n.pauses, ai.onExceed, 'and the consequence is the published sentence')
})

test('[EERLIJK-GEBRUIK-UITLEG] a number it cannot back is not stated', () => {
  // One wrong figure costs more trust than a missing line. "50 van de 0" must never appear.
  // No USED figure means no sentence — there is nothing to place against the limit.
  assert.equal(fairUseNotice({ ...REFUSAL, used: undefined, limit: undefined, plan: 'plus' })!.count, null)
  assert.equal(fairUseNotice({ ...REFUSAL, used: null, limit: 0 })!.count, null)
  // A bogus limit is different: the published table still knows the real one, and quoting it is
  // more honest than going silent about a number we can back.
  const ai = FAIR_USE_LIMITS.find((l) => l.key === 'aiDocuments')!
  assert.equal(fairUseNotice({ ...REFUSAL, used: 12, limit: 0 })!.count,
    `Je hebt deze maand 12 van de ${ai.free} gebruikt.`)
  // …and for a Plus owner that fallback is the PLUS number, never the free one.
  assert.ok(fairUseNotice({ ...REFUSAL, used: 12, limit: 0, plan: 'plus' })!.count!.includes(String(ai.plus)))
  // …and the rest of the notice still stands, because a half-explained pause beats a faded toast.
  const partial = fairUseNotice({ reason: 'fair_use', metric: 'aiDocuments' })!
  assert.equal(partial.count, null)
  assert.ok(partial.title.length > 0 && partial.pauses.length > 0 && partial.resets.length > 0)
})

test('[EERLIJK-GEBRUIK-UITLEG] a Plus owner is told their OWN limit', () => {
  const ai = FAIR_USE_LIMITS.find((l) => l.key === 'aiDocuments')!
  const n = fairUseNotice({ ...REFUSAL, plan: 'plus', used: ai.plus, limit: ai.plus })!
  assert.ok(n.count!.includes(String(ai.plus)), 'not the free number they are no longer on')
})

test('[EERLIJK-GEBRUIK-UITLEG] every metric says what still works, and they differ', () => {
  // "What pauses" is per-limit: reading, sending, uploading, connecting. A single generic sentence
  // would be wrong for four of the five.
  const seen = new Set<string>()
  for (const l of FAIR_USE_LIMITS) {
    const n = fairUseNotice({ reason: 'fair_use', metric: l.key, used: 1, limit: 1 })!
    assert.ok(n, `${l.key} must produce a notice`)
    assert.ok(n.stillWorks.length > 20, `${l.key} must say what still works`)
    assert.equal(n.pauses, l.onExceed, `${l.key} must quote its own published consequence`)
    seen.add(n.stillWorks)
  }
  assert.equal(seen.size, FAIR_USE_LIMITS.length, 'each limit pauses something different')
})

test('[EERLIJK-GEBRUIK-UITLEG] an absolute limit does not promise a monthly reset', () => {
  // Storage and mailboxes are not per month. Telling that owner "the counter resets on the 1st"
  // would be a promise the app cannot keep.
  const n = fairUseNotice({ reason: 'fair_use', metric: 'storageMb', used: 2048, limit: 2048, wachten: null })!
  assert.doesNotMatch(n.resets, /1e van de volgende maand/)
  assert.match(n.resets, /niet per maand/)
})

test('[EERLIJK-GEBRUIK-UITLEG] an unknown metric still explains itself', () => {
  // A metric added to the gate before this table is not a reason to fall back to a toast.
  const n = fairUseNotice({ reason: 'fair_use', metric: 'somethingNew', error: 'Dit pauzeert.' })!
  assert.ok(n.title.length > 0)
  assert.equal(n.pauses, 'Dit pauzeert.')
  assert.equal(n.upgradeUrl, '/prijzen', 'and the way out is never lost')
})
