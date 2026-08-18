// src/lib/open-invoice-proof-text.ts
// [OPENSTAAND-BEWIJS] What the owner reads. Split from open-invoice-proof.ts on purpose: that
// module reaches matchTransactions and therefore the entire matching engine, and the screen needs
// two sentences, not an engine. Pure, and imports nothing but its own types.
//
// Dutch, because it is read by the entrepreneur — see the language rule in AGENTS.md.

import type { OpenInvoiceHit, OpenInvoiceProof } from './open-invoice-proof-types'

/** Dutch money, as the rest of the app writes it. */
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
export function describeProof(proof: OpenInvoiceProof, bankThrough: string | null): string {
  if (proof.checkedInvoices === 0) {
    return 'Er staan geen inkoopfacturen open om na te kijken.'
  }
  const facturen = proof.checkedInvoices === 1
    ? '1 openstaande factuur'
    : `${proof.checkedInvoices} openstaande facturen`

  if (proof.checkedTransactions === 0) {
    // No bank lines to compare against is NOT a clean bill of health, and must never read as one.
    return (
      `${facturen} — nog niet vergeleken met je bank. ` +
      'Er staan geen banktransacties klaar om tegen te houden; importeer je bankafschrift.'
    )
  }

  const tot = dayNL(bankThrough)
  const scope =
    `${facturen} vergeleken met ${proof.checkedTransactions} ` +
    `${proof.checkedTransactions === 1 ? 'banktransactie' : 'banktransacties'}` +
    (tot ? ` t/m ${tot}` : '') + '.'

  if (proof.hits.length === 0) {
    return `${scope} Geen betaling gevonden die bij een van deze facturen past.`
  }
  return proof.hits.length === 1
    ? `${scope} Bij 1 factuur vonden we tóch een betaling die erbij lijkt te passen.`
    : `${scope} Bij ${proof.hits.length} facturen vonden we tóch een betaling die erbij lijkt te passen.`
}

/**
 * The line under one hit: what the bank says, in the owner's own words from their own statement.
 *
 * The description is quoted verbatim and not summarised — it is the string the owner recognises,
 * and a tidied version of it is a string they have never seen.
 */
export function describeHit(hit: OpenInvoiceHit): string {
  const day = dayNL(hit.transaction.date) ?? hit.transaction.date
  const naam = hit.transaction.counterpartName?.trim()
  const omschrijving = hit.transaction.description?.trim()
  return (
    `${EUR.format(Math.abs(hit.transaction.amount))} op ${day}` +
    (naam ? ` aan ${naam}` : '') +
    (omschrijving ? ` — "${omschrijving}"` : '')
  )
}
