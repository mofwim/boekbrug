// src/lib/open-invoice-proof-text.ts
// [OPENSTAAND-BEWIJS] What the owner reads. Split from open-invoice-proof.ts on purpose: that
// module reaches matchTransactions and therefore the entire matching engine, and the screen needs
// sentences, not an engine. Pure — no I/O, no clock, no database.
//
// ── WHY THIS BUILDS A PANEL AND NOT A HANDFUL OF STRINGS ──
//
// The first version handed the screen two sentences and left the rest of the panel — the failure
// line, the per-hit question, the "not everything was included" note — hard-coded in the
// component. That is the half-finished translation AGENTS.md warns about, and it hides itself: the
// screen still looks right in Dutch, so nothing points at the gap. Worse, it was about to be
// COPIED, because the sales list needs the same panel.
//
// So one object describes the whole panel, the way invoice-sent-notice.ts does. The component
// renders what it is handed and holds no language of its own; both screens render the same object;
// and the direction travels with the words, so an owner reading Arabic cannot get the sentences and
// the layout out of step.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md). The strings come from the
// catalogue, where Dutch is the source and the fallback — an owner who never chose a language sees
// exactly what they saw before this file was translated, and the tests below assert that literally.

import { translator } from './i18n/t'
import { localeDir, type Locale } from './i18n/locale'
import type {
  OpenInvoiceHit, OpenInvoiceProof, OpenInvoiceProofResult, ProofDirection,
} from './open-invoice-proof-types'

/** Dutch money, as the rest of the app writes it. Not translated — see format-nl.ts. */
const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** A Dutch day, from an ISO string, without going through a Date in the browser's zone. */
function dayNL(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return null
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * [OPENSTAAND-BEWIJS] The sentence that does the actual work.
 *
 * It states the SEARCH, not the result — how many invoices were held against how many bank lines,
 * and up to which day the bank data reaches. An owner can check every number in it against their
 * own bank in seconds, which is the whole difference between a claim and a proof.
 *
 * `bankThrough` is the date of the most recent transaction the app holds. Naming it is the most
 * trust-building thing on this screen and the cheapest: an app that says where it STOPS knowing is
 * one you can believe about where it does. Null when there is no bank data at all, and then the
 * sentence says that instead of implying a check that never happened.
 */
export function describeProof(
  proof: OpenInvoiceProof,
  bankThrough: string | null,
  locale: Locale = 'nl',
): string {
  const t = translator(locale)
  const outgoing = proof.direction === 'outgoing'

  if (proof.checkedInvoices === 0) {
    return outgoing ? t('bewijs.geenOpen.verkoop') : t('bewijs.geenOpen.inkoop')
  }

  // Named by kind, so the two panels never read as the same sentence about the same money — the
  // owner can have both on screen in one session, and "12 openstaande facturen" twice with
  // different numbers under it is how someone stops trusting either. Written-out keys rather than
  // a computed suffix: the plural of `factuur` is `facturen` (the double u collapses), so appending
  // one produced "inkoopfactuuren", which is not a word and was on screen before this existed —
  // and a key assembled from a template is invisible to the [TAAL] gate that proves keys are real.
  const count = proof.checkedInvoices
  const facturen = count === 1
    ? (outgoing ? t('bewijs.aantal.verkoop.een') : t('bewijs.aantal.inkoop.een'))
    : (outgoing ? t('bewijs.aantal.verkoop.meer', { count }) : t('bewijs.aantal.inkoop.meer', { count }))

  // No bank lines to compare against is NOT a clean bill of health, and must never read as one.
  if (proof.checkedTransactions === 0) return t('bewijs.geenBank', { facturen })

  const dag = dayNL(bankThrough)
  const tot = dag ? t('bewijs.scope.tot', { datum: dag }) : ''
  const scope = proof.checkedTransactions === 1
    ? t('bewijs.scope.een', { facturen, tot })
    : t('bewijs.scope.meer', { facturen, tx: proof.checkedTransactions, tot })

  if (proof.hits.length === 0) return t('bewijs.niets', { scope })
  return proof.hits.length === 1
    ? t('bewijs.raak.een', { scope })
    : t('bewijs.raak.meer', { scope, count: proof.hits.length })
}

/**
 * The line under one hit: what the bank says, in the owner's own words from their own statement.
 *
 * The description is quoted verbatim and not summarised — it is the string the owner recognises,
 * and a tidied version of it is a string they have never seen.
 */
export function describeHit(
  hit: OpenInvoiceHit,
  direction: ProofDirection = 'incoming',
  locale: Locale = 'nl',
): string {
  const t = translator(locale)
  const datum = dayNL(hit.transaction.date) ?? hit.transaction.date
  const naam = hit.transaction.counterpartName?.trim()
  const bedrag = EUR.format(Math.abs(hit.transaction.amount))
  // The preposition is not decoration. On a purchase invoice the owner is looking for money that
  // LEFT ("aan de leverancier"); on a sales invoice for money that ARRIVED ("van de klant"). One
  // wrong word here is a sentence the owner reads twice and believes half of.
  const regel = !naam
    ? t('bewijs.hit.zonderNaam', { bedrag, datum })
    : direction === 'outgoing'
      ? t('bewijs.hit.verkoop', { bedrag, datum, naam })
      : t('bewijs.hit.inkoop', { bedrag, datum, naam })

  const tekst = hit.transaction.description?.trim()
  return tekst ? t('bewijs.hit.omschrijving', { regel, tekst }) : regel
}

/** One invoice we call open, with the payment that looks like it. */
export interface ProofPanelRow {
  invoiceId: string
  /** "264091 · BALKIP B.V. — € 1.224,75 open" */
  title: string
  /** "In je bank staat …. Klopt het dat deze factuur nog openstaat?" */
  question: string
}

/**
 * Everything the panel paints, in one object. A component that renders this holds no language and
 * no direction of its own — see the header.
 */
export interface OpenInvoiceProofPanel {
  /** A payment was found under something we call open. Drives the styling, not the wording. */
  alarm: boolean
  /** [NO-SILENT-EMPTY] `lead` is the "we could not look" sentence, not a finding. */
  failed: boolean
  /** The scope sentence — the product of this whole feature — or the failure sentence. */
  lead: string
  rows: ProofPanelRow[]
  /** "Niet alles is meegenomen: …", or null when the check was complete. */
  bounded: string | null
  /** Carried here so the words and the layout can never render out of step. */
  dir: 'ltr' | 'rtl'
}

/**
 * Build the panel for one side of the books.
 *
 * Null in exactly one case: there is no proof to show at all (the server did not run it). Every
 * other state — including a read that failed and a check that was cut short — is a panel with
 * something honest in it, because silence on this screen reads as "everything is fine".
 */
export function buildProofPanel(
  proof: OpenInvoiceProofResult | null | undefined,
  locale: Locale = 'nl',
): OpenInvoiceProofPanel | null {
  if (!proof) return null
  const t = translator(locale)
  const dir = localeDir(locale)
  const outgoing = proof.direction === 'outgoing'

  if (proof.readFailed) {
    return { alarm: false, failed: true, lead: t('bewijs.leesFout'), rows: [], bounded: null, dir }
  }

  const rows: ProofPanelRow[] = proof.hits.map((h) => {
    // Identity first, and both numbers on the line: what we call open, and the payment that looks
    // like it. Never applied — both come from a reading, and picking a winner is the
    // overconfidence that produces the wrong number in the first place.
    const naam = h.invoiceNumber ?? t('bewijs.regel.factuur')
    const wie = h.clientName ? `${naam} · ${h.clientName}` : naam
    const bewijs = describeHit(h, proof.direction, locale)
    return {
      invoiceId: h.invoiceId,
      title: `${wie} — ${t('bewijs.regel.open', { bedrag: EUR.format(h.openAmount) })}`,
      question: outgoing
        ? t('bewijs.vraag.verkoop', { bewijs })
        : t('bewijs.vraag.inkoop', { bewijs }),
    }
  })

  const ci = proof.capped.invoices
  const ct = proof.capped.transactions
  const bounded =
    ci > 0 && ct > 0 ? t('bewijs.beperkt.beide', { facturen: ci, transacties: ct })
      : ci > 0 ? t('bewijs.beperkt.facturen', { count: ci })
        : ct > 0 ? t('bewijs.beperkt.transacties', { count: ct })
          : null

  return {
    alarm: proof.hits.length > 0,
    failed: false,
    lead: describeProof(proof, proof.bankThrough, locale),
    rows,
    bounded,
    dir,
  }
}

/**
 * [HERINNER-BEWIJS] Why a reminder was held back, in one sentence with the bank line in it.
 *
 * Separate from the panel because it is read at a different moment and answers a different
 * question. The panel is a standing statement about a list; this is an interruption of a single
 * deliberate act, and it therefore has to say what to DO — link the payment, or send anyway.
 *
 * Always 'outgoing': nothing on the purchase side is ever chased at a customer.
 */
export function describeChaseBlock(hit: OpenInvoiceHit, locale: Locale = 'nl'): string {
  return translator(locale)('bewijs.herinner.geblokkeerd', {
    bewijs: describeHit(hit, 'outgoing', locale),
  })
}
