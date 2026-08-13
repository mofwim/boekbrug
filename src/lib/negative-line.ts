// src/lib/negative-line.ts
// [MIN-REGEL] A credit line inside a normal invoice.
// =====================================================================
// From a real supplier invoice — ATAPACK Cash & Carry 26304787, 17-07-2026. One line reads:
//
//     AP290004  Credit over faktuur 26302362 van 10-04-26
//               Knoopzakken, HDPE, AGF-zak …      2000st   -3   23,95   -71,85
//
// A return from an earlier delivery, settled on the NEXT invoice rather than on a separate
// creditnota. The rest of the document is ordinary: nine positive lines totalling € 173,03, minus
// € 71,85, giving € 101,18 excl. + € 21,25 btw = € 122,43. Every wholesaler in this trade does it,
// and a shop owner retyping such an invoice into this app could not: the line editor refused any
// quantity below 0,01.
//
// ── WHERE THE MINUS IS ALLOWED TO LIVE ──
//
// In the QUANTITY. Not in the price, and that is not a style preference:
//
//   · Peppol BIS 3.0 / EN 16931 rule BR-27 — "the item net price shall not be negative". An
//     e-factuur with a negative cbc:PriceAmount is REJECTED by the access point, so an invoice
//     that looks right on paper would silently fail to be delivered electronically.
//   · It is how the paper says it too: −3 pieces at € 23,95, not 3 pieces at € −23,95. The second
//     reads as a discount on a delivery that happened; the first says three went back.
//
// So: quantity may be negative, unit price may not. A zero quantity stays an error — a line that
// changes nothing is a mistake, never a credit.
//
// ── AND THE TOTAL DECIDES WHAT THE DOCUMENT IS ──
//
// Credits inside an invoice are fine while the invoice still asks for money. The moment they
// exceed the deliveries the document is not a factuur any more: it is a creditnota, and it has to
// be issued as one. Three things go wrong otherwise, and none of them is visible on the screen
// that made it:
//
//   · the number comes out of the doorlopende factuurreeks (Art. 35 Wet OB) while the document
//     behaves like a credit — the series then contains a document that gives money back;
//   · the BTW is declared as omzet where it belongs on the other side of the aangifte;
//   · the customer books a negative purchase invoice, which their own software may refuse.
//
// This module answers the question; the screen refuses and names the creditnota.
// =====================================================================

/** Just enough of a line to judge it. The editor's shape and the stored row both satisfy this. */
export interface SignedLine {
  quantity?: number | null
  unit_price?: number | null
  btw_rate?: number | null
  // [REGEL-KORTING] A line's own discount lowers what it is worth, so the question this module
  // answers — is this still a factuur? — has to be asked of the DISCOUNTED amount. A line at
  // 100% off is worth nothing, and a set of lines that is worth nothing next to one credit line
  // gives money back.
  discount_type?: string | null
  discount_value?: number | string | null
}

// [CENT] The app's one rounding. This module had `Math.round(x * 100) / 100`, which is wrong in
// both of the ways invoice-totals.round2 documents — and the second one is about exactly this
// feature: Math.round(-0.5) is −0, so a NEGATIVE half cent rounds towards zero while the positive
// one rounds away from it. A credit line would then be a cent smaller than the delivery it takes
// back. It also has to be the SAME rounding as the routes', because they store
// round2(quantity × unit_price) per line and this decides whether the sum of those is below zero.
import { round2 } from './invoice-totals'
// [REGEL-KORTING] "What is this line worth" had TWO definitions — one here, one in
// invoice-discount.ts — and they were the same expression until a line could carry a discount.
// At that moment they would have disagreed, and this is the module that decides whether a
// document is a factuur or a creditnota: the cheaper definition wins that argument by accident.
// So there is one, it lives with the discount rules, and this module uses it.
import { lineNetEx } from './invoice-discount'

export { lineNetEx }

/**
 * Cents, as an integer — the only safe unit for deciding whether a total crossed zero.
 *
 * No division back, so this is exact: it is a comparison, never an amount. (That is also why the
 * [CENT] gate allows this shape and not the other one.)
 */
const cents = (n: number): number => Math.round(n * 100)

/** The invoice's net excl-BTW total, credits and line discounts included. */
export function invoiceNetEx(lines: readonly SignedLine[]): number {
  return round2(lines.reduce((s, l) => s + lineNetEx(l), 0))
}

/**
 * Why this line cannot be issued as it stands.
 *
 * `null` when it is fine — including when its quantity is negative, which is the whole point.
 */
export type LineSignFault = 'quantity_zero' | 'price_negative'

export function lineSignFault(line: SignedLine): LineSignFault | null {
  const q = Number(line.quantity ?? 0)
  const p = Number(line.unit_price ?? 0)
  // A line that moves nothing. Not a credit — a half-typed line.
  if (!Number.isFinite(q) || cents(q) === 0) return 'quantity_zero'
  // The sign belongs in the quantity. See BR-27 in the header: a negative price is not deliverable
  // as an e-factuur, so it would look right on the PDF and never arrive.
  if (!Number.isFinite(p) || p < 0) return 'price_negative'
  return null
}

/**
 * Does this set of lines still describe a factuur?
 *
 * False once the credits are worth more than the deliveries: the document then gives money back,
 * which is a creditnota — a different number series and the other side of the aangifte.
 *
 * Exactly zero is still a factuur. A € 0,00 invoice is unusual but it is not a credit: nothing
 * flows back, and forcing it into the creditnota series would put a document there that credits
 * nothing.
 */
export function staysAFactuur(lines: readonly SignedLine[]): boolean {
  return cents(invoiceNetEx(lines)) >= 0
}

/**
 * Why a document with too many credits is refused, in the words the API answers with.
 *
 * Dutch inside an English file (AGENTS.md): this is not a comment or an identifier but the error
 * text an owner reads, and the routes have no language setting to translate it with — every other
 * refusal they send is Dutch for the same reason. The screen shows its own translated line from
 * the catalogue; this one is what a client that skipped the screen gets back.
 *
 * No full stop: the routes punctuate the reason themselves.
 */
export const NOT_A_FACTUUR_REASON =
  'de creditregels zijn samen meer waard dan wat je levert — dat is een creditnota, geen factuur'

/** Does this invoice carry at least one credit line? Used only to decide whether to explain. */
export function hasCreditLine(lines: readonly SignedLine[]): boolean {
  return lines.some((l) => Number(l.quantity ?? 0) < 0)
}
