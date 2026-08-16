// [DAGSTART] Pure node test — run: npx tsx --test src/lib/accountant-daily.test.ts
//
// This app sends around forty different notifications and exactly ONE reaches an accountant — from
// the quarter-close cron, four times a year. So the stack waiting on them grows in silence and the
// deadline counts down on a screen nobody was asked to open.
//
// The obvious fix is worse than the problem: "you have 40 invoices waiting", every morning, forever
// is a message you stop reading — and then the day it says something new, you miss it.
//
// What is held here is therefore mostly the SILENCE. A quiet morning must produce nothing, so that
// a message means something.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  planAccountantDay,
  deadlineSpeaks,
  DEADLINE_BANDS,
  type AccountantDaySignals,
} from './accountant-daily'

const day = (o: Partial<AccountantDaySignals> = {}): AccountantDaySignals => ({
  newToConfirm: 0,
  totalToConfirm: 0,
  daysToDeadline: null,
  clientsNotFiled: 0,
  newlyDivergedQuarters: 0,
  divergedQuarters: 0,
  ...o,
})

test('[DAGSTART] a quiet morning says nothing at all', () => {
  // The common case, and the whole design. If this ever returns a message, every other assertion
  // here stops mattering: a daily message that always fires is a daily message nobody reads.
  assert.equal(planAccountantDay(day()), null)
  assert.equal(planAccountantDay(day({ daysToDeadline: 40, clientsNotFiled: 6 })), null,
    'a deadline far away has nothing new to say today')
  assert.equal(planAccountantDay(day({ totalToConfirm: 40 })), null,
    'a stack that did not CHANGE is not news — this is the nag the whole module exists to avoid')
})

test('[DAGSTART] the unchanged stack is the case that must stay silent', () => {
  // Forty invoices waiting, none of them new. Yesterday it said forty; today it would say forty.
  // Speaking here is exactly how a notification becomes wallpaper.
  const stil = planAccountantDay(day({ newToConfirm: 0, totalToConfirm: 40 }))
  assert.equal(stil, null)
  // One arrives → there is something to say, and the stack is context, not the reason.
  const nieuw = planAccountantDay(day({ newToConfirm: 1, totalToConfirm: 41 }))
  assert.ok(nieuw)
  assert.match(nieuw.title, /1 nieuw stuk/)
  assert.match(nieuw.body, /De stapel is nu 41 stuks/, 'the size comes along as context')
  assert.equal(nieuw.link, '/dashboard/accountant/bevestigen', 'and it lands where the work is')
})

test('[DAGSTART] the deadline speaks on its bands and on no other day', () => {
  for (const d of DEADLINE_BANDS) {
    assert.equal(deadlineSpeaks(d, 3), true, `day ${d} is a band`)
  }
  for (const d of [30, 21, 15, 13, 8, 6, 4, 2]) {
    assert.equal(deadlineSpeaks(d, 3), false, `day ${d} would be the same message twice`)
  }
  // No client left to file → the deadline is not about anything.
  assert.equal(deadlineSpeaks(7, 0), false)
  // Unknown → nothing claimed.
  assert.equal(deadlineSpeaks(null, 5), false)
})

test('[DAGSTART] past the date it speaks every day, and that is not nagging', () => {
  // An unfiled aangifte past its date is a fine per client, per day, and the accountant is the one
  // who can still fix it. This is the one place repetition is the message doing its job.
  for (const d of [-1, -2, -9]) {
    assert.equal(deadlineSpeaks(d, 2), true, `day ${d} still matters`)
  }
  const m = planAccountantDay(day({ daysToDeadline: -1, clientsNotFiled: 1 }))
  assert.ok(m)
  assert.match(m.title, /verstreken/)
  assert.match(m.body, /gisteren/, 'one day past reads as "gisteren", not "1 dagen geleden"')
  const ouder = planAccountantDay(day({ daysToDeadline: -5, clientsNotFiled: 3 }))
  assert.match(ouder!.body, /5 dagen geleden/)
  assert.match(ouder!.body, /3 klanten/)
})

test('[DAGSTART] every sentence names a number, never "er is iets"', () => {
  // A digest that says "there are updates" costs a tap to find out it was nothing. The number IS
  // the message; without it this is a badge, and a badge is not worth a notification.
  const cases: AccountantDaySignals[] = [
    day({ newToConfirm: 3, totalToConfirm: 3 }),
    day({ daysToDeadline: 7, clientsNotFiled: 4 }),
    day({ daysToDeadline: 0, clientsNotFiled: 1 }),
    day({ daysToDeadline: -2, clientsNotFiled: 2 }),
  ]
  for (const c of cases) {
    const m = planAccountantDay(c)
    assert.ok(m, 'this one should speak')
    assert.match(`${m.title} ${m.body}`, /\d/, 'a number appears')
  }
})

test('[DAGSTART] singular and plural are right, because a bookkeeper reads this at 7am', () => {
  const een = planAccountantDay(day({ daysToDeadline: 1, clientsNotFiled: 1 }))
  assert.match(een!.title, /Morgen is de aangiftedatum/)
  assert.match(een!.body, /Nog 1 dag /)
  assert.match(een!.body, /1 klant is nog niet ingediend/)

  const meer = planAccountantDay(day({ daysToDeadline: 3, clientsNotFiled: 5 }))
  assert.match(meer!.title, /Nog 3 dagen/)
  assert.match(meer!.body, /5 klanten zijn nog niet ingediend/)

  const vandaag = planAccountantDay(day({ daysToDeadline: 0, clientsNotFiled: 2 }))
  assert.match(vandaag!.title, /Vandaag is de laatste dag/)
  assert.match(vandaag!.body, /2 klanten moeten nog/)
})

test('[DAGSTART] the deadline outranks the stack, and the link follows the first sentence', () => {
  // Both at once: the deadline is the one with a date attached, so it leads and it decides where
  // the tap goes. A message whose link does not match its first line sends people hunting.
  const m = planAccountantDay(day({ newToConfirm: 2, totalToConfirm: 9, daysToDeadline: 3, clientsNotFiled: 4 }))
  assert.ok(m)
  assert.match(m.title, /Nog 3 dagen/)
  assert.match(m.body, /^Nog 3 dagen/, 'the deadline sentence comes first')
  assert.match(m.body, /2 nieuwe stukken/, 'and the new work is still said')
  assert.equal(m.link, '/dashboard/accountant/agenda', 'the link matches the leading sentence')
})

test('[DAGSTART] a negative or absurd count never produces a sentence about it', () => {
  assert.equal(planAccountantDay(day({ newToConfirm: -3 })), null)
  assert.equal(planAccountantDay(day({ daysToDeadline: 7, clientsNotFiled: -1 })), null)
})

// ── [SUPPLETIE] A filing that moved after it was sent ────────────────────────
//
// art. 10a AWR turns a filed aangifte that has become wrong into a reporting duty, and the
// accountant is the person who discharges it. The signal therefore had to reach the one message
// they read — without becoming the daily nag the rest of this module exists to refuse.

test('[SUPPLETIE] a newly moved filing is worth a morning on its own', () => {
  const m = planAccountantDay(day({ newlyDivergedQuarters: 1, divergedQuarters: 1 }))
  assert.ok(m, 'this speaks even when nothing else does')
  assert.match(m!.title, /ingediend kwartaal is gewijzigd/)
  assert.match(m!.body, /suppletie/, 'and names what has to be checked')
  assert.equal(m!.link, '/dashboard/accountant/agenda',
    'the per-client board — the stack of unconfirmed invoices cannot answer a question about a past quarter')
})

test('[SUPPLETIE] a STANDING one never sends a message by itself', () => {
  // The nag test. A suppletie that nobody has acted on is still true tomorrow, and the morning after
  // that, and forever — which is exactly the shape this module deletes everywhere else.
  assert.equal(planAccountantDay(day({ divergedQuarters: 3 })), null)
  assert.equal(planAccountantDay(day({ divergedQuarters: 3, newlyDivergedQuarters: 0 })), null)
})

test('[SUPPLETIE] …but it rides along on a morning that was already speaking', () => {
  // The reminder that costs nothing: the message was going out anyway, so the standing duty is
  // named in it. This is how a missed first message stops being a permanently missed one.
  const m = planAccountantDay(day({ newToConfirm: 2, totalToConfirm: 9, divergedQuarters: 2 }))
  assert.ok(m)
  assert.match(m!.body, /2 gewijzigde ingediende kwartalen/)
  assert.match(m!.body, /2 nieuwe stukken/, 'and still says what it came to say')
  assert.match(m!.title, /nieuwe stukken/, 'the trigger keeps the title — nothing new happened on the filings')
})

test('[SUPPLETIE] the deadline still outranks it, and new work does not', () => {
  // Order of urgency: a deadline about to become a fine, then a duty already incurred, then a stack
  // that waits without cost.
  const both = planAccountantDay(day({
    daysToDeadline: 3, clientsNotFiled: 2, newlyDivergedQuarters: 1, divergedQuarters: 1, newToConfirm: 5, totalToConfirm: 5,
  }))
  assert.ok(both)
  assert.match(both!.title, /Nog 3 dagen/, 'the deadline keeps the title')
  assert.ok(both!.body.indexOf('aangiftedatum') < both!.body.indexOf('gewijzigd'),
    'and the deadline sentence comes first')
  assert.ok(both!.body.indexOf('gewijzigd') < both!.body.indexOf('nieuwe stukken'),
    'a duty already incurred is named before a stack that waits')

  const overNew = planAccountantDay(day({ newlyDivergedQuarters: 1, divergedQuarters: 1, newToConfirm: 5, totalToConfirm: 5 }))
  assert.match(overNew!.title, /ingediend kwartaal is gewijzigd/, 'it does outrank new work')
})

test('[SUPPLETIE] the total only appears when it says something the trigger did not', () => {
  // One moved, one standing: repeating "in totaal 1" after "een kwartaal is gewijzigd" is noise.
  const same = planAccountantDay(day({ newlyDivergedQuarters: 1, divergedQuarters: 1 }))
  assert.doesNotMatch(same!.body, /In totaal/)
  const more = planAccountantDay(day({ newlyDivergedQuarters: 1, divergedQuarters: 4 }))
  assert.match(more!.body, /In totaal staan er 4/)
})

test('[SUPPLETIE] a negative count cannot manufacture a message', () => {
  // Counts come from a database read; a clamp here is cheaper than trusting every future caller.
  assert.equal(planAccountantDay(day({ newlyDivergedQuarters: -3 })), null)
  assert.equal(planAccountantDay(day({ divergedQuarters: -1, newToConfirm: 0 })), null)
})
