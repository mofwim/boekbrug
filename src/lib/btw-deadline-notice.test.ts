// src/lib/btw-deadline-notice.test.ts
// Run: npx tsx --test src/lib/btw-deadline-notice.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deadlineNotice, deadlineNudgeDue } from './btw-deadline-notice'

test('[DEADLINE] every quarter is due at the end of the month after it', () => {
  assert.equal(deadlineNotice(2026, 1, '2026-04-01').deadline, '2026-04-30')
  assert.equal(deadlineNotice(2026, 2, '2026-07-01').deadline, '2026-07-31')
  assert.equal(deadlineNotice(2026, 3, '2026-10-01').deadline, '2026-10-31')
  // Q4 rolls into the next calendar year. Stated as the same year it would be a date eleven months
  // in the past, and the app would announce a late aangifte to everyone with a perfectly timely Q4.
  assert.equal(deadlineNotice(2026, 4, '2027-01-05').deadline, '2027-01-31')
})

test('[DEADLINE] the four states are the four things worth saying', () => {
  // Three weeks out: mentioned, not shouted.
  assert.equal(deadlineNotice(2026, 2, '2026-07-10').state, 'ruim')
  assert.equal(deadlineNotice(2026, 2, '2026-07-10').days, 21)

  // The last week is where a nudge earns its place. Eight days is still 'ruim' — the boundary is
  // stated once, here, so three screens cannot each round it differently.
  assert.equal(deadlineNotice(2026, 2, '2026-07-23').state, 'ruim')
  assert.equal(deadlineNotice(2026, 2, '2026-07-24').state, 'bijna')
  assert.equal(deadlineNotice(2026, 2, '2026-07-24').days, 7)
  assert.equal(deadlineNotice(2026, 2, '2026-07-30').state, 'bijna')

  // Today is its own state: "nog 0 dagen" and "vandaag" are the same fact, and only one of them
  // makes a person act.
  assert.equal(deadlineNotice(2026, 2, '2026-07-31').state, 'vandaag')
  assert.equal(deadlineNotice(2026, 2, '2026-07-31').days, 0)

  // And past is past, with the count carrying how far.
  assert.equal(deadlineNotice(2026, 2, '2026-08-01').state, 'voorbij')
  assert.equal(deadlineNotice(2026, 2, '2026-08-01').days, -1)
  assert.equal(deadlineNotice(2026, 2, '2026-09-15').days, -46)
})

test('[DEADLINE] the day count survives the two nights the clocks change', () => {
  // Amsterdam goes to summer time on 29 March 2026 and back on 25 October. A local-time
  // subtraction returns 23 or 25 hours across those nights and rounds a day out — on a date that
  // carries a fine. Counted on the calendar, both cross correctly.
  assert.equal(deadlineNotice(2026, 1, '2026-03-28').days, 33)  // spans the March change
  assert.equal(deadlineNotice(2026, 3, '2026-10-24').days, 7)   // spans the October change
  assert.equal(deadlineNotice(2026, 3, '2026-10-24').state, 'bijna')
})

test('[DEADLINE] the escalating nudge is only for the last week, and never for a filed quarter', () => {
  const bijna = deadlineNotice(2026, 2, '2026-07-25')
  const ruim = deadlineNotice(2026, 2, '2026-07-01')
  const vandaag = deadlineNotice(2026, 2, '2026-07-31')
  const voorbij = deadlineNotice(2026, 2, '2026-08-02')

  assert.equal(deadlineNudgeDue(bijna, false), true)
  assert.equal(deadlineNudgeDue(vandaag, false), true)

  // Filed is filed: the quarter-close nudge already refuses to chase a filer, and so does this one.
  assert.equal(deadlineNudgeDue(bijna, true), false)
  assert.equal(deadlineNudgeDue(vandaag, true), false)

  // Not three weeks early — a manual re-run of the cron must not nag the whole book in July for
  // something due at the end of the month.
  assert.equal(deadlineNudgeDue(ruim, false), false)
  // And not after the fact: at that point the message is a different one, and it is not this
  // module's job to write it.
  assert.equal(deadlineNudgeDue(voorbij, false), false)
})
