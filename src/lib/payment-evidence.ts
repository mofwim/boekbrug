// src/lib/payment-evidence.ts
// [BETAALBEWIJS] Under every "Betaald", the bank line that says so.
//
// ── WHY A LABEL IS NOT ENOUGH ──
//
// The pay screen shows a conclusion: "Betaald". It reads amount_paid and payment_date and has
// never once read bank_tx_invoices, so the word carries no evidence — and the owner who wants to
// check it has to open their bank in another tab and search. That is the work the app was bought
// to remove, handed back at the exact moment trust is being asked for.
//
// ── AND WHY THE TWO KINDS MAY NOT LOOK THE SAME ──
//
// A payment PROVEN by a bank line and a payment the owner ticked by hand are different facts. The
// first is corroborated by a third party; the second is a memory. Today both render as the same
// word, which quietly borrows the bank's authority for the tick — and when the tick was a mistake,
// nothing on the screen ever says so. Naming which one it is costs a few words and is the whole
// difference between "the app says" and "your bank says".
//
// The third state is the one nobody thinks of: an invoice standing as paid with NO link at all.
// It happens (an older row, a repaired database, a link deleted with its statement) and it is the
// only one of the three where the app genuinely does not know. It says that.
//
// Pure: no I/O, no clock, no database.

import { round2 } from './invoice-totals'

/** One settlement row, as bank_tx_invoices holds it. */
export interface PaymentLink {
  /** Null for a payment the owner recorded by hand — that is the whole distinction. */
  transactionId: string | null
  amountApplied: number
  paidOn: string | null
  /** 'bank' | 'kas' — how the owner said it was settled, when they said it. */
  method: string | null
  /** The bank line, when this link has one. */
  transaction?: {
    date: string | null
    amount: number | null
    description: string | null
    counterpartName: string | null
    counterpartIban: string | null
  } | null
}

export type PaymentEvidence =
  /** At least one bank line carries this payment. The strongest thing the app can say. */
  | { kind: 'bank'; total: number; links: PaymentLink[] }
  /** The owner recorded it themselves. True, and not the same claim. */
  | { kind: 'manual'; total: number; links: PaymentLink[] }
  /** Some of both — a bank payment plus a hand-recorded remainder. */
  | { kind: 'mixed'; total: number; links: PaymentLink[] }
  /** Marked paid, and nothing anywhere records HOW. The app does not know; it says so. */
  | { kind: 'none' }
  /** The links could not be read. Never the same as 'none'. */
  | { kind: 'unknown' }

/**
 * What kind of claim "Betaald" is on this invoice.
 *
 * `links === null` means the read failed, and that is deliberately NOT the same answer as an empty
 * list: one says "we could not look", the other says "nothing is recorded". Collapsing them is how
 * a screen ends up asserting that an invoice has no payment evidence because the database was busy.
 */
export function classifyPayment(links: readonly PaymentLink[] | null): PaymentEvidence {
  if (links === null) return { kind: 'unknown' }
  const real = links.filter((l) => Math.abs(l.amountApplied) > 0.005)
  if (real.length === 0) return { kind: 'none' }
  const total = round2(real.reduce((s, l) => s + Math.abs(l.amountApplied), 0))
  const withBank = real.filter((l) => l.transactionId !== null && l.transactionId !== '')
  if (withBank.length === real.length) return { kind: 'bank', total, links: real }
  if (withBank.length === 0) return { kind: 'manual', total, links: real }
  return { kind: 'mixed', total, links: real }
}

const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** A Dutch day from an ISO string, parsed from the STRING so no timezone can shift it. */
function dayNL(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return null
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * [BETAALBEWIJS] The line under "Betaald", in the owner's own words from their own statement.
 *
 * The bank text is quoted VERBATIM and never tidied: it is the string the owner recognises on
 * their own screen, and a cleaned-up version of it is a string they have never seen. Recognition
 * is the entire mechanism — the owner is not asked to verify anything, only to recognise.
 *
 * Dutch, because the entrepreneur reads it (AGENTS.md).
 */
export function describePayment(ev: PaymentEvidence): string {
  switch (ev.kind) {
    case 'unknown':
      return 'We konden niet nakijken waar deze betaling vandaan komt.'
    case 'none':
      // Honest, and rare. "Betaald" with nothing recording how is the one case where the app has a
      // status and no evidence at all — saying so is what keeps the other two worth believing.
      return 'Als betaald gemarkeerd, maar er is geen betaling aan gekoppeld.'
    case 'manual': {
      const l = ev.links[0]
      const dag = dayNL(l.paidOn)
      const hoe = l.method === 'kas' ? ' contant' : ''
      return (
        `Door jou${hoe} afgevinkt${dag ? ` op ${dag}` : ''} — ` +
        'er is geen bankregel aan gekoppeld.'
      )
    }
    case 'bank':
    case 'mixed': {
      const bank = ev.links.filter((l) => l.transactionId)
      const l = bank[0]
      const t = l?.transaction
      const dag = dayNL(t?.date ?? l?.paidOn)
      const naam = t?.counterpartName?.trim()
      const oms = t?.description?.trim()
      const bedrag = t?.amount != null ? EUR.format(Math.abs(t.amount)) : EUR.format(ev.total)
      const meer = bank.length > 1 ? ` (+ ${bank.length - 1} andere betaling${bank.length > 2 ? 'en' : ''})` : ''
      const hand = ev.kind === 'mixed' ? ' Een deel is door jou zelf afgevinkt.' : ''
      return (
        `${bedrag} afgeschreven${dag ? ` op ${dag}` : ''}${naam ? ` naar ${naam}` : ''}` +
        `${oms ? ` — "${oms}"` : ''}${meer}.${hand}`
      )
    }
  }
}

/**
 * Is this payment corroborated by something other than the app itself?
 *
 * The screens use it to decide how loudly to say "Betaald". Not a quality judgement on the owner's
 * tick — a hand-recorded payment is usually perfectly true — but the two claims have different
 * weight, and a screen that renders them identically is borrowing the bank's authority for one of
 * them.
 */
export function isBankProven(ev: PaymentEvidence): boolean {
  return ev.kind === 'bank' || ev.kind === 'mixed'
}
