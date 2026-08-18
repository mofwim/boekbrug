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
// [TAAL] The words come from the catalogue; this module still decides WHICH words. Dutch is the
// source and the fallback, so an owner who has not chosen a language sees exactly what they saw
// before this file was translated — the tests below assert that literally.
import { translator } from './i18n/t'
import { localeDir, type Locale } from './i18n/locale'
// The direction of the money. Shared with the proof panel so one vocabulary describes both halves
// of the same question: is what we say about this euro true, and how do we know?
import type { ProofDirection } from './open-invoice-proof-types'

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
 * `direction` decides whether the money LEFT or ARRIVED. It is not a nicety: "afgeschreven naar
 * Kiwi Food Market" under an invoice Kiwi paid describes the owner paying their own customer, on
 * the one line that exists to be believed.
 */
export function describePayment(
  ev: PaymentEvidence,
  direction: ProofDirection = 'incoming',
  locale: Locale = 'nl',
): string {
  const t = translator(locale)
  switch (ev.kind) {
    case 'unknown':
      return t('betaal.onbekend')
    case 'none':
      // Honest, and rare. "Betaald" with nothing recording how is the one case where the app has a
      // status and no evidence at all — saying so is what keeps the other two worth believing.
      return t('betaal.geen')
    case 'manual': {
      const l = ev.links[0]
      const datum = dayNL(l.paidOn)
      const kas = l.method === 'kas'
      if (kas) return datum ? t('betaal.hand.kas', { datum }) : t('betaal.hand.kas.zonderDatum')
      return datum ? t('betaal.hand', { datum }) : t('betaal.hand.zonderDatum')
    }
    case 'bank':
    case 'mixed': {
      const bank = ev.links.filter((l) => l.transactionId)
      const l = bank[0]
      const tx = l?.transaction
      const datum = dayNL(tx?.date ?? l?.paidOn)
      const naam = tx?.counterpartName?.trim()
      const bedrag = tx?.amount != null ? EUR.format(Math.abs(tx.amount)) : EUR.format(ev.total)
      const out = direction !== 'outgoing'

      // Four shapes per direction, because both the name and the date can genuinely be missing —
      // a bank line whose own row could not be read still proves that a bank line CARRIES this
      // payment, and that claim is worth keeping without its text.
      let regel: string
      if (datum && naam) regel = out ? t('betaal.bank.inkoop', { bedrag, datum, naam }) : t('betaal.bank.verkoop', { bedrag, datum, naam })
      else if (datum) regel = out ? t('betaal.bank.inkoop.zonderNaam', { bedrag, datum }) : t('betaal.bank.verkoop.zonderNaam', { bedrag, datum })
      else if (naam) regel = out ? t('betaal.bank.inkoop.zonderDatum', { bedrag, naam }) : t('betaal.bank.verkoop.zonderDatum', { bedrag, naam })
      else regel = out ? t('betaal.bank.inkoop.kaal', { bedrag }) : t('betaal.bank.verkoop.kaal', { bedrag })

      const tekst = tx?.description?.trim()
      if (tekst) regel = t('betaal.bank.omschrijving', { regel, tekst })
      if (bank.length === 2) regel = t('betaal.bank.meer.een', { regel })
      else if (bank.length > 2) regel = t('betaal.bank.meer.meer', { regel, count: bank.length - 1 })
      // Punctuation, not language: every locale in this catalogue ends a sentence with a full stop,
      // and a key whose entire content is "." would be a translation nobody can get wrong or right.
      regel = `${regel}.`
      return ev.kind === 'mixed' ? t('betaal.bank.deelsHand', { regel }) : regel
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

/** What a screen paints under "Betaald". No language of its own — see the header. */
export interface PaymentEvidenceLine {
  text: string
  /**
   * How loudly to say it. Not decoration: a bank-proven payment and the owner's own tick are
   * different claims, and a screen that renders them identically borrows the bank's authority for
   * one of them.
   *
   *   bank     a third party corroborates this
   *   hand     true, and the app is the only witness
   *   geen     marked paid with nothing recording how — the one case worth interrupting for
   *   onbekend the read failed, which is never the same answer as "nothing is recorded"
   */
  tone: 'bank' | 'hand' | 'geen' | 'onbekend'
  /** Carried here so the words and the layout can never render out of step. */
  dir: 'ltr' | 'rtl'
}

/**
 * Build that line, or null when there is nothing to say.
 *
 * Null happens for an invoice the screen sent no evidence for — an older render, or a row the
 * server did not ask about. The row then looks exactly as it did before this feature existed,
 * which is the only honest thing to do with an answer nobody has.
 */
export function buildPaymentEvidenceLine(
  ev: PaymentEvidence | undefined | null,
  direction: ProofDirection = 'incoming',
  locale: Locale = 'nl',
): PaymentEvidenceLine | null {
  if (!ev) return null
  const tone: PaymentEvidenceLine['tone'] =
    ev.kind === 'unknown' ? 'onbekend'
      : ev.kind === 'none' ? 'geen'
        : isBankProven(ev) ? 'bank'
          : 'hand'
  return { text: describePayment(ev, direction, locale), tone, dir: localeDir(locale) }
}

/**
 * The invoices on a screen that CLAIM to be settled — the only ones worth asking about.
 *
 * A screen that asked for every row would read the whole ledger's payment links to draw a line
 * under a handful of them. Deliberately not capped: the reads it feeds are chunked by id, so
 * there is no length ceiling to hide behind — and a silent cap here would leave later rows with
 * no line at all, which reads as "nothing to say" rather than "not asked".
 *
 * Sorted and deduplicated so a screen can use the result as a cache key: the loader's page order
 * is not guaranteed, and an unstable key re-reads the same rows on every render.
 */
export function settledInvoiceIds(
  rows: ReadonlyArray<{ id?: string | null; status?: string | null; amount_paid?: number | null }>,
): string[] {
  const out = new Set<string>()
  for (const r of rows) {
    if (!r.id) continue
    // 'paid' is the claim this line explains. A PARTLY paid invoice is not claiming to be settled,
    // but it does carry payments — and the instalment the owner is asked to believe deserves the
    // same evidence, so it is in.
    if (r.status === 'paid' || (typeof r.amount_paid === 'number' && r.amount_paid > 0.005)) out.add(r.id)
  }
  return [...out].sort()
}
