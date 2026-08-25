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
// [DEELBETALING-BEWIJS] The shared vocabulary of a partly-settled invoice — one definition of
// "wat is er betaald", used here to hold the CACHED figure against the rows it caches.
import { CENT_EPSILON, totalAmount, type PartialPayInvoice } from './partial-payment'
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
  /**
   * What this link settled, as a magnitude — or NULL for a row created before the column existed.
   *
   * NULL is not zero, and reading it as zero is how this feature came to cry wolf on real data: a
   * link from before bank_tx_invoices.amount_applied was added carries no amount, and by
   * construction settled its invoice IN FULL (the same rule allocatedOnLine has always applied in
   * bank-line-budget.ts, where reading NULL as 0 would let the same euros be spent twice). Dropped
   * as "nothing applied", such an invoice rendered the amber "marked paid, no payment linked" —
   * about an invoice with a bank line on it.
   */
  amountApplied: number | null
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

/** What one link settled, once a NULL has been valued at the invoice's own total. */
export interface AppliedLink {
  link: PaymentLink
  /** The magnitude this link settled, or null when nothing could value it. */
  applied: number | null
}

export type PaymentEvidence =
  /** At least one bank line carries this payment. The strongest thing the app can say. */
  | { kind: 'bank'; total: number; totalKnown: boolean; links: PaymentLink[]; applied: AppliedLink[] }
  /** The owner recorded it themselves. True, and not the same claim. */
  | { kind: 'manual'; total: number; totalKnown: boolean; links: PaymentLink[]; applied: AppliedLink[] }
  /** Some of both — a bank payment plus a hand-recorded remainder. */
  | { kind: 'mixed'; total: number; totalKnown: boolean; links: PaymentLink[]; applied: AppliedLink[] }
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
export function classifyPayment(
  links: readonly PaymentLink[] | null,
  /**
   * The invoice's own total, used to value a link whose amount_applied is NULL — see PaymentLink.
   * Absent, such a link still COUNTS as a settlement (it is one) but its amount stays unknown, and
   * `totalKnown` then says so rather than letting a 0 pass for a figure.
   */
  invoiceTotal?: number | null,
): PaymentEvidence {
  if (links === null) return { kind: 'unknown' }
  const fallback = typeof invoiceTotal === 'number' && Math.abs(invoiceTotal) > 0.005
    ? Math.abs(invoiceTotal)
    : null
  const applied: AppliedLink[] = []
  for (const link of links) {
    if (link.amountApplied === null) {
      // A row from before the column existed: a settlement whose size is not recorded here.
      applied.push({ link, applied: fallback })
      continue
    }
    const magnitude = Math.abs(link.amountApplied)
    if (magnitude > 0.005) applied.push({ link, applied: magnitude })
  }
  if (applied.length === 0) return { kind: 'none' }

  const totalKnown = applied.every((a) => a.applied !== null)
  const total = round2(applied.reduce((s, a) => s + (a.applied ?? 0), 0))
  const real = applied.map((a) => a.link)
  const withBank = real.filter((l) => l.transactionId !== null && l.transactionId !== '')
  const kind = withBank.length === real.length ? 'bank' : withBank.length === 0 ? 'manual' : 'mixed'
  return { kind, total, totalKnown, links: real, applied }
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
      // The amount is named here too. apply_manual_payment always records one (only pre-migration
      // BANK links carry a NULL), so there is no branch to write — and on a partly settled invoice
      // an instalment without its figure is the term you cannot check.
      const bedrag = EUR.format(ev.total)
      if (kas) return datum ? t('betaal.hand.kas', { bedrag, datum }) : t('betaal.hand.kas.zonderDatum', { bedrag })
      return datum ? t('betaal.hand', { bedrag, datum }) : t('betaal.hand.zonderDatum', { bedrag })
    }
    case 'bank':
    case 'mixed': {
      const bank = ev.links.filter((l) => l.transactionId)
      const l = bank[0]
      const tx = l?.transaction
      const datum = dayNL(tx?.date ?? l?.paidOn)
      const naam = tx?.counterpartName?.trim()
      // The figure comes from the bank row when there is one, and otherwise from what this link
      // applied. When NEITHER exists — a legacy link with no amount and no readable transaction —
      // nothing is printed: "€ 0,00 afgeschreven" is a number nobody ever wrote down, and on this
      // line a wrong figure is worse than an admitted gap.
      //
      // `ev.applied ?? []` is not defensive noise. This function runs inside a LIST ROW, and a
      // throw there does not blank one line — it blanks the screen (the whole reason
      // tests/render/ exists). An evidence object assembled anywhere but classifyPayment has no
      // `applied`, and the link's own amount answers the same question, so it falls back rather
      // than reaching into undefined.
      const eigen = (ev.applied ?? []).find((a) => a.link === l)?.applied ?? l?.amountApplied ?? null
      const magnitude = tx?.amount != null ? Math.abs(tx.amount) : eigen
      if (magnitude === null) return t('betaal.bank.bedragOnbekend')
      const bedrag = EUR.format(magnitude)
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
   * [DEELBETALING-BEWIJS] One line per instalment, when there is more than one. Empty otherwise.
   *
   * A partly settled invoice is where a conclusion is hardest to check by hand. "Deels betaald ·
   * nog € 460" is an assertion; the owner cannot see which instalments produced it without opening
   * their bank and adding up — which is the work this product exists to remove. With several
   * payments the lead becomes the SUM ("€ 750,00 van € 1.210,00 voldaan, in 2 betalingen:") and
   * these carry the terms it is made of.
   */
  entries: string[]
  /**
   * [NO-SILENT-EMPTY] invoices.amount_paid is a cached sum of the very rows above it, maintained by
   * a database function. Nothing had ever held the two against each other — so a link removed
   * outside the app's own paths, or a total corrected downward after payments were booked (the
   * recompute CLAMPS at the invoice magnitude, silently), left a remainder no instalment supports.
   * Null when they agree; a sentence naming BOTH figures when they do not.
   */
  warning: string | null
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
  /**
   * [CIRKEL] The bank line behind a bank-proven claim, so the words can be a LINK to the place
   * where the claim can be checked (/dashboard/bank/verdelen/{txId}). Null for hand/none/unknown
   * — a tick with no bank row has nowhere to jump to, and a dead link would borrow authority.
   */
  txId: string | null
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
  /**
   * The invoice this evidence belongs to. Optional, and what it buys is the arithmetic: the total
   * to measure the instalments against, and the amount_paid to hold the sum of them up to.
   */
  invoice?: PartialPayInvoice | null,
): PaymentEvidenceLine | null {
  if (!ev) return null
  const t = translator(locale)
  const tone: PaymentEvidenceLine['tone'] =
    ev.kind === 'unknown' ? 'onbekend'
      : ev.kind === 'none' ? 'geen'
        : isBankProven(ev) ? 'bank'
          : 'hand'
  const dir = localeDir(locale)

  if (ev.kind === 'unknown' || ev.kind === 'none') {
    return { text: describePayment(ev, direction, locale), entries: [], warning: null, tone, dir, txId: null }
  }

  // ── The instalments, when there is more than one ──
  let text = describePayment(ev, direction, locale)
  const entries: string[] = []
  const terms = ev.applied ?? []
  if (terms.length > 1) {
    const totaal = invoice ? EUR.format(totalAmount(invoice)) : null
    text = totaal
      ? t('deel.samen.meer', { betaald: EUR.format(ev.total), totaal, count: terms.length })
      : text
    for (const a of terms) {
      // Each term carries its OWN evidence sentence, so a bank-proven instalment and a
      // hand-recorded one are never flattened into one claim about the whole invoice.
      const bewijs = describePayment(
        { kind: a.link.transactionId ? 'bank' : 'manual', total: a.applied ?? 0, totalKnown: a.applied !== null, links: [a.link], applied: [a] },
        direction, locale,
      )
      entries.push(bewijs)
    }
  }

  // ── The cached sum, held against the rows it caches ──
  let warning: string | null = null
  if (ev.totalKnown === false) {
    warning = t('deel.verschil.onmeetbaar')
  } else if (invoice && typeof invoice.amount_paid === 'number') {
    const geboekt = Math.max(0, invoice.amount_paid)
    if (Math.abs(round2(geboekt - ev.total)) > CENT_EPSILON) {
      warning = t('deel.verschil', { geboekt: EUR.format(geboekt), geteld: EUR.format(ev.total) })
    }
  }

  // [CIRKEL] The first bank-backed link's transaction — the line the sentence is ABOUT.
  const txId = tone === 'bank'
    ? ev.links.find((l) => l.transactionId)?.transactionId ?? null
    : null
  return { text, entries, warning, tone, dir, txId }
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
