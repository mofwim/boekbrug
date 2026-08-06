// src/lib/email-body-invoice.ts
// [MAILTEKST] The invoice that never had an attachment. Pure, no I/O, no AI.
// Run: npx tsx --test src/lib/email-body-invoice.test.ts
//
// ── WHY THIS EXISTS ──
// Plenty of suppliers do not attach anything. A hosting bill, a phone subscription, a parking app,
// a small web service: the invoice IS the e-mail, laid out as an HTML table in the body. Both
// fetchers listed on "has an attachment", so those messages were never even seen — not skipped,
// not reported, not counted. The cost never entered the books and the voorbelasting was never
// claimed, every month, for as long as the subscription runs.
//
// ── WHY THIS IS THE MOST DANGEROUS THING TO GET WRONG ──
// Every other import path starts from a file somebody deliberately attached. This one starts from
// ORDINARY MAIL, where the overwhelming majority of what carries a euro amount is not an invoice:
// order confirmations, shipping notices, payment receipts from a card processor, price lists,
// newsletters, "your subscription renews next month". Booking any of those is a cost that never
// existed and a voorbelasting claim on it.
//
// So this file is a FILTER before it is a reader, and it is deliberately hard to pass. It is
// mechanical — no model, no cost — and it runs before anything is sent anywhere. What it lets
// through still goes to the verify queue and is never booked automatically; see the sync.
//
// ── AND THE TEXT HAS TO SURVIVE THE HTML ──
// The amounts in these mails are almost always in a table, and the naive `replace(/<[^>]+>/g, '')`
// welds the cells together: "Totaal€ 121,00" and, worse, "21%€ 21,00" — which reads as one number
// to every check downstream. Cells become spaces and rows become newlines here, because the
// grounding check, the placement check and the model all read what this produces.

/** What the pre-filter concluded, and why — the reason travels into the skip registry. */
export interface BodyInvoiceVerdict {
  /** Worth showing to the classifier. Never "this is an invoice". */
  candidate: boolean
  /** Short English tag for the audit trail. */
  reason: string
}

const NOT = (reason: string): BodyInvoiceVerdict => ({ candidate: false, reason })

/**
 * HTML → text a human (and the grounding check) can read.
 *
 * Block elements and table rows become newlines; table CELLS become a space, never nothing. That
 * last one is not cosmetic: "21%€ 21,00" glued together is a token no amount parser can read, and
 * "€ 121,00" welded to the word before it stops the grounding check finding the total that IS on
 * the page.
 */
export function htmlToReadableText(html: string): string {
  if (!html) return ''
  return (
    html
      // Script and style carry no invoice text and plenty of numbers.
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Line breaks, before the blanket rule below turns every remaining tag into a space.
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|h[1-6]|table|section|header|footer)>/gi, '\n')
      .replace(/<(?:p|div|tr|li|h[1-6]|table)\b[^>]*>/gi, '\n')
      // Everything else becomes a SPACE — and the space is the whole point, not tidiness. With ''
      // here, `<td>BTW 21%</td><td>€ 21,00</td>` collapses to "BTW 21%€ 21,00": one token no amount
      // parser can read, and "Totaal€ 121,00" that stops the grounding check finding a total which
      // IS on the page. A correct invoice would read as one whose total is not printed.
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
      .replace(/&euro;|&#8364;|&#x20ac;/gi, '€')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
      // Tidy: collapse runs of spaces, then runs of blank lines, but keep the line structure —
      // the placement check reads "is this amount on a line that follows a total word".
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * Words that make a message an invoice rather than a message ABOUT money.
 * Dutch first, English beside it — a Dutch owner's suppliers write in both.
 */
const INVOICE_WORDS = [
  'factuur', 'factuurnummer', 'faktuur', 'nota', 'rekening',
  'invoice', 'invoice number', 'tax invoice', 'rechnung',
]

/**
 * A tax line. This is the single strongest signal that a document is an invoice and not a receipt
 * for someone else's money: an invoice states the BTW, because the recipient needs it to claim
 * the voorbelasting. A shipping notice never does.
 */
const TAX_WORDS = ['btw', 'b.t.w', 'vat', 'omzetbelasting', 'mwst', 'tax']

/**
 * Shapes that carry all the right words and are NOT a bill to the owner.
 *
 * This list is the whole reason the filter is trustworthy, and it is deliberately about the
 * MESSAGE'S PURPOSE rather than its vocabulary. Every one of these mentions an amount and most
 * mention BTW:
 *
 *   · a quotation is an offer, not a debt;
 *   · a reminder about an invoice the owner SENT is income, and booking it as a cost is the
 *     sign error that is hardest to find later;
 *   · a payment confirmation from a processor is money that already moved and will arrive on the
 *     bank statement, where it belongs;
 *   · a dunning notice for an invoice already booked would double the cost.
 */
const NOT_AN_INVOICE = [
  'offerte', 'prijsopgave', 'quotation', 'quote request', 'vrijblijvende',
  'orderbevestiging', 'order confirmation', 'bestelbevestiging', 'bevestiging van je bestelling',
  'verzendbevestiging', 'shipping confirmation', 'track & trace', 'je pakket',
  'betaalverzoek', 'payment request', 'betaling ontvangen', 'payment received',
  'nieuwsbrief', 'newsletter', 'uitschrijven', 'unsubscribe',
  'wachtwoord', 'password', 'verifieer je', 'verify your', 'inloggen',
  'aanmaning', 'herinnering', 'reminder',
  'proforma', 'pro forma',
]

/**
 * A euro amount as it is actually written in these mails: € 1.234,56 / EUR 1234.56 / 1.234,56 EUR.
 * At least two decimals, because a bare "€ 5" in a newsletter is not an invoice total.
 */
const EURO_AMOUNT = /(?:€|EUR)\s*\d{1,3}(?:[.\s]\d{3})*,\d{2}|(?:€|EUR)\s*\d+\.\d{2}|\d{1,3}(?:[.\s]\d{3})*,\d{2}\s*(?:€|EUR)/i

/**
 * Is this message body worth showing to the classifier?
 *
 * FOUR conditions, all required. Each one on its own admits far too much:
 *
 *   1. it is not one of the shapes above that are never a bill;
 *   2. it names itself an invoice;
 *   3. it states a BTW/VAT line — what makes it a document the owner can deduct from;
 *   4. it carries a euro amount with cents.
 *
 * Deliberately strict, and the direction of that choice is deliberate too. A missed body invoice
 * costs the owner the same as today, which is what they already live with. A FALSE one becomes a
 * cost that never existed and a voorbelasting claim on it — and it arrives looking exactly like
 * every other row in the queue.
 */
export function bodyLooksLikeInvoice(text: string, subject: string): BodyInvoiceVerdict {
  const body = (text ?? '').toLowerCase()
  const subj = (subject ?? '').toLowerCase()
  if (body.trim().length < 40) return NOT('body_too_short')

  const hay = `${subj}\n${body}`

  const excluded = NOT_AN_INVOICE.find((w) => hay.includes(w))
  if (excluded) return NOT(`not_an_invoice:${excluded}`)

  if (!INVOICE_WORDS.some((w) => hay.includes(w))) return NOT('no_invoice_word')

  // Whole-word for the short ones: "vat" inside "private" and "btw" inside a URL are not tax lines.
  const hasTax = TAX_WORDS.some((w) =>
    new RegExp(`(^|[^a-z0-9])${w.replace(/\./g, '\\.')}([^a-z0-9]|$)`, 'i').test(hay))
  if (!hasTax) return NOT('no_tax_line')

  if (!EURO_AMOUNT.test(text ?? '')) return NOT('no_euro_amount')

  return { candidate: true, reason: 'body_invoice_candidate' }
}

/**
 * The filename this body gets once it is stored as evidence.
 *
 * It has to be recognisable in bestanden a year later and stable across syncs, because it is half
 * of the `${messageId}:${filename}` key that stops the same mail importing twice. Derived from the
 * subject, never from a clock.
 */
export function bodyDocumentName(subject: string | null | undefined): string {
  const clean = (subject ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${clean || 'factuur in e-mailtekst'}.pdf`
}
