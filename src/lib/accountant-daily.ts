// src/lib/accountant-daily.ts
// [DAGSTART] Does the accountant have a reason to open BoekBrug today? Pure — no I/O, no clock.
//
// ── WHAT THIS ANSWERS, AND WHY IT WAS MISSING ──
// The werkboard calls itself "the accountant's daily driver", and it is well built: a BTW-deadline
// hero, readiness per client, a to-do list. Nothing drives anyone to it.
//
// Counted: this app sends roughly forty different notifications, and exactly ONE of them is
// addressed to an accountant — from the quarter-close cron, whose schedule is `0 8 5 1,4,7,10 *`.
// Four times a year. The entrepreneur is told when an invoice is booked, when a payment matches,
// when their accountant asks something; the bookkeeper, whose whole job this app is trying to make
// smaller, is told almost nothing. So the stack of invoices waiting for them grows in silence, the
// deadline counts down on a screen nobody was asked to open, and the app is something you remember
// in the last week of the month.
//
// ── WHY THIS IS NOT A DAILY NAG ──
// The obvious version — "you have 40 invoices waiting" every morning — is worse than silence. A
// message that says the same thing every day is one you stop reading, and then the day it says
// something new you miss it. This codebase keeps deleting exactly that shape.
//
// So the rule is: speak only about what is NEW or what has MOVED, and say nothing at all otherwise.
// Both are derivable without remembering anything, which is why there is no state table here:
//
//   · new work — invoices that arrived in the last day. "3 nieuwe stukken" is true today and false
//     tomorrow by construction, so a stack that has not changed produces no message at all;
//   · the deadline — it moves by itself, so the BANDS do the work. Fourteen days out, seven, three,
//     the last day, and then overdue. On any other day it says nothing, because on any other day
//     it would be repeating itself.
//
// Overdue is the one exception to "only on transitions", and deliberately: an unfiled aangifte past
// its date is a fine per client, every day, and the accountant is the person who can still fix it.
// Repeating that is not nagging; it is the message doing its job.
//
// ── AND WHAT IT DELIBERATELY DOES NOT DO ──
// It never counts a client's own answered questions or new messages: those already notify
// individually and immediately, and a digest that repeats them turns one real signal into two.

/** What the caller measured for one accountant. Every field is a COUNT of work waiting on them. */
export interface AccountantDaySignals {
  /**
   * Purchase invoices that entered the confirm queue in the LAST DAY, at clients who authorised
   * this accountant to confirm. Not the whole stack — see the header.
   */
  newToConfirm: number
  /** How large the whole waiting stack is. Context for the sentence, never the reason to send it. */
  totalToConfirm: number
  /** Days until the BTW deadline for the running quarter. Negative = past it. Null = unknown. */
  daysToDeadline: number | null
  /** Clients whose aangifte for that quarter is not filed yet. 0 → the deadline says nothing. */
  clientsNotFiled: number
}

export interface AccountantDayMessage {
  title: string
  body: string
  /** Where the message lands. Always a screen that can act on what it says. */
  link: string
}

/**
 * The deadline days that are worth a sentence. Anything else would be the same message twice.
 *
 * Chosen around how the work actually falls: fourteen days is "start now and it is comfortable",
 * seven is "this week", three is "clear your afternoon", one is "today or tomorrow", zero is the
 * last day the Belastingdienst accepts it.
 */
export const DEADLINE_BANDS = [14, 7, 3, 1, 0] as const

/** Is today a day the deadline has something new to say? */
export function deadlineSpeaks(days: number | null, clientsNotFiled: number): boolean {
  if (days === null || clientsNotFiled <= 0) return false
  // Past the date: every day, on purpose — see the header.
  if (days < 0) return true
  return (DEADLINE_BANDS as readonly number[]).includes(days)
}

/**
 * What to send this accountant today, or null when the honest answer is nothing.
 *
 * Null is the common case and the point of the whole module: a quiet morning produces no message,
 * so a message means something.
 */
export function planAccountantDay(s: AccountantDaySignals): AccountantDayMessage | null {
  const newWork = Math.max(0, s.newToConfirm)
  const deadline = deadlineSpeaks(s.daysToDeadline, s.clientsNotFiled)
  if (newWork === 0 && !deadline) return null

  const parts: string[] = []

  if (deadline) {
    const d = s.daysToDeadline as number
    const klanten = s.clientsNotFiled === 1 ? '1 klant' : `${s.clientsNotFiled} klanten`
    if (d < 0) {
      const over = Math.abs(d)
      parts.push(
        `De aangiftedatum is ${over === 1 ? 'gisteren' : `${over} dagen geleden`} verstreken en ` +
        `${klanten} ${s.clientsNotFiled === 1 ? 'heeft' : 'hebben'} nog niet ingediend.`,
      )
    } else if (d === 0) {
      parts.push(`Vandaag is de laatste dag voor de aangifte, en ${klanten} ${s.clientsNotFiled === 1 ? 'moet' : 'moeten'} nog.`)
    } else {
      parts.push(
        `Nog ${d === 1 ? '1 dag' : `${d} dagen`} tot de aangiftedatum. ` +
        `${klanten} ${s.clientsNotFiled === 1 ? 'is' : 'zijn'} nog niet ingediend.`,
      )
    }
  }

  if (newWork > 0) {
    const stapel = s.totalToConfirm > newWork
      ? ` De stapel is nu ${s.totalToConfirm} stuks.`
      : ''
    parts.push(
      `${newWork === 1 ? 'Er is 1 nieuw stuk' : `Er zijn ${newWork} nieuwe stukken`} binnengekomen om te bevestigen.${stapel}`,
    )
  }

  return {
    title: dayTitle(s, deadline, newWork),
    body: parts.join(' '),
    // The deadline sends them to the board that shows every client's position; new work sends them
    // straight to the stack. Whichever is the more urgent decides, so the link always matches the
    // first sentence.
    link: deadline ? '/dashboard/accountant/agenda' : '/dashboard/accountant/bevestigen',
  }
}

/** The one line that has to earn the tap. Names the number — never "er is iets". */
function dayTitle(s: AccountantDaySignals, deadline: boolean, newWork: number): string {
  if (deadline) {
    const d = s.daysToDeadline as number
    if (d < 0) return 'De aangiftedatum is verstreken'
    if (d === 0) return 'Vandaag is de laatste dag voor de aangifte'
    return d === 1 ? 'Morgen is de aangiftedatum' : `Nog ${d} dagen tot de aangiftedatum`
  }
  return newWork === 1 ? '1 nieuw stuk om te bevestigen' : `${newWork} nieuwe stukken om te bevestigen`
}
