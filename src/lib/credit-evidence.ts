// src/lib/credit-evidence.ts
// [CREDIT-BEWIJS] Which credit notes produced "Deels gecrediteerd · € 250". Pure, no I/O.
//
// The third layer, on the documents that give money back. It is the same argument as the
// instalments in payment-evidence.ts and needs saying once more here, because the answer is
// different: an instalment is proved by somebody ELSE's record (a bank line the owner recognises),
// while a credit is proved by a document the owner SENT. The app is not gathering evidence — it is
// showing evidence it was already holding and never put on the screen.
//
// What the chip says today is a conclusion. "Deels gecrediteerd · € 250" on a € 1.210 invoice
// leaves the owner to find the credit notes themselves to see which ones, for how much, and when —
// and a credit note is exactly the document an accountant asks about by number.
//
// NOTE ON LANGUAGE: identifiers and comments English (AGENTS.md); the strings come from the
// catalogue, where Dutch is the source and the fallback.

import type { CreditDetail } from './credited-invoices'
// [CENT] The app's ONE rounding. Writing `Math.round(x * 100) / 100` here instead was caught by
// the gate on the first run — and rightly: this file prints an amount the owner reconciles against
// their own credit notes, and two roundings disagree on exactly the half cents that show up there.
import { round2 } from './invoice-totals'
import { translator } from './i18n/t'
import { localeDir, type Locale } from './i18n/locale'

const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** A Dutch day from an ISO string, parsed from the STRING so no timezone can shift it. */
function dayNL(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return null
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

/** What a screen paints under the credit chip. No language and no direction of its own. */
export interface CreditEvidenceLine {
  /** "€ 250,00 teruggegeven met 2 creditnota's:" */
  lead: string
  /** One per credit note, newest first: "CR-2026-003 · 14 juli 2026 — € 150,00" */
  entries: string[]
  dir: 'ltr' | 'rtl'
}

/**
 * Build that line, or null when there is nothing to show.
 *
 * Null for an invoice with no credits at all — the row then looks exactly as it did before this
 * existed, which is the only honest thing to do about a document that was never written.
 */
export function buildCreditEvidenceLine(
  credits: readonly CreditDetail[] | undefined | null,
  locale: Locale = 'nl',
): CreditEvidenceLine | null {
  if (!credits || credits.length === 0) return null
  const t = translator(locale)
  const total = credits.reduce((sum, c) => sum + Math.abs(c.amount), 0)
  const bedrag = EUR.format(round2(total))

  const lead = credits.length === 1
    ? t('credit.samen.een', { bedrag })
    : t('credit.samen.meer', { bedrag, count: credits.length })

  const entries = credits.map((c) => {
    const geld = EUR.format(Math.abs(c.amount))
    // A creditnota in concept has no number yet, and that is the truth rather than a gap: the
    // number falls when it is sent (Art. 35). Saying "Concept" is more use than an empty space.
    if (!c.invoiceNumber) return t('credit.regel.zonderNummer', { bedrag: geld })
    const datum = dayNL(c.invoiceDate)
    return datum
      ? t('credit.regel', { nummer: c.invoiceNumber, datum, bedrag: geld })
      : t('credit.regel.zonderDatum', { nummer: c.invoiceNumber, bedrag: geld })
  })

  return { lead, entries, dir: localeDir(locale) }
}
