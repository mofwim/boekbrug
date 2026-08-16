// src/lib/incasso.ts
// [WIK] The veertiendagenbrief — the one letter that decides whether an unpaid invoice can ever
// cost the debtor anything. Pure, no I/O. Run: npx tsx src/lib/incasso.test.ts
//
// Dutch law (art. 6:96 lid 6 BW + Besluit vergoeding buitengerechtelijke incassokosten) is blunt
// about a CONSUMER debtor: before any incassokosten may be charged, the creditor must have sent
// an aanmaning that
//   1. grants at least FOURTEEN days, counted from the day AFTER the letter is received, and
//   2. states the EXACT amount of the collection costs that will follow.
// A letter missing either element gives no right to those costs — not reduced, none at all. Every
// polite reminder this app has ever sent falls in that category: helpful, and legally worth
// nothing when the customer keeps ignoring it.
//
// For a BUSINESS debtor the letter is not required (art. 6:96 lid 5): the €40 minimum is owed by
// law once the payment term passes. Sending the same letter anyway is harmless and clearer, so
// the engine does — only the wording differs.
//
// What this module deliberately does NOT do: state an interest amount. The wettelijke rente and
// the wettelijke handelsrente are re-set by decree twice a year, and a stale percentage in a
// letter to a third party is exactly the "wrong number" this app refuses to send. The letter
// mentions that statutory interest may be charged; it never prints a figure this app cannot
// guarantee. The collection-cost staffel below, by contrast, has been fixed since 2012.

import { round2 } from './invoice-totals'

/** The staffel of the Besluit BIK: [threshold of the band, percentage over that band]. */
const BANDS: Array<{ upTo: number; pct: number }> = [
  { upTo: 2500, pct: 0.15 },
  { upTo: 5000, pct: 0.1 },
  { upTo: 10000, pct: 0.05 },
  { upTo: 200000, pct: 0.01 },
  { upTo: Infinity, pct: 0.005 },
];

/** Legal floor and ceiling of the collection costs (Besluit BIK art. 2). */
export const INCASSO_MIN_EUR = 40;
export const INCASSO_MAX_EUR = 6775;

/**
 * How many days the letter must grant. The law says "minstens veertien dagen", counted from the
 * day AFTER receipt — so the term can never be shorter than 14 clear days plus the delivery day.
 * A day too many only strengthens the creditor's position; a day too few voids the whole claim.
 * Hence 15, deliberately on the safe side of a rule that has no upside to cutting fine.
 */
export const WIK_TERM_DAYS = 15;

export type DebtorType = "consumer" | "business";

/**
 * [CENT] Round to cents the way a person does with a calculator — now the app's one round2.
 *
 * This file found the defect first, on its own, and solved it locally: the naive
 * `Math.round(n * 100) / 100` is a cent short often enough to matter, because 15% of €1.000,50 is
 * 150.075 and in binary `150.075 * 100` is 15007.499999999998, which rounds DOWN to € 150,07.
 * The number goes into a letter that a debtor may well recompute themselves, and an amount that
 * does not match their own arithmetic costs the whole letter its credibility.
 *
 * It is the same defect that sent an e-invoice out a cent light — the fix now lives in one place
 * (invoice-totals.round2) instead of being rediscovered per module, and it also handles the
 * negative half cent this local version still got wrong.
 */
const cents = round2;

/**
 * The buitengerechtelijke incassokosten over an unpaid principal, per the legal staffel.
 *
 * Progressive per band, floored at €40 and capped at €6.775. Returns 0 for a principal that is
 * zero or negative — there is nothing to collect, and a €40 claim on nothing is a false demand.
 *
 * BTW is NOT added. An ondernemer who can reclaim BTW may not charge it on top of the collection
 * costs; the exception (a creditor who cannot deduct, e.g. under the KOR) would only ever mean
 * the owner may claim MORE than this. Understating is the safe direction for a number that goes
 * out in a letter.
 */
export function incassokosten(principal: number): number {
  const amount = Number(principal);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  let remaining = amount;
  let previousCap = 0;
  let total = 0;
  for (const band of BANDS) {
    if (remaining <= 0) break;
    const width = band.upTo - previousCap;
    const inBand = Math.min(remaining, width);
    total += inBand * band.pct;
    remaining -= inBand;
    previousCap = band.upTo;
  }
  return cents(Math.min(Math.max(total, INCASSO_MIN_EUR), INCASSO_MAX_EUR));
}

/**
 * Consumer or business? Decided on the one signal an invoice always carries: a BTW number on the
 * customer means a business, its absence means a consumer.
 *
 * The default when unknown is CONSUMER, and that asymmetry is the point. Treating a business as a
 * consumer costs nothing — they receive a letter the law did not require. Treating a consumer as
 * a business skips the letter the law DOES require, and the owner silently loses the right to
 * ever charge collection costs on that invoice. Only one of those mistakes is recoverable.
 */
export function debtorTypeOf(invoice: { client_btw_number?: string | null }): DebtorType {
  return (invoice.client_btw_number ?? "").trim().length > 0 ? "business" : "consumer";
}

/** Add whole days to an ISO date via UTC, so a server timezone can never shift a legal term. */
export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** The last day of the statutory term when the letter goes out on `sentIso`. */
export function wikDeadline(sentIso: string): string {
  return addDaysIso(sentIso, WIK_TERM_DAYS);
}

export interface WikNotice {
  debtorType: DebtorType;
  /** What is still owed — the basis for the calculation, never the invoice total. */
  principal: number;
  /** The exact collection costs the letter must name. */
  costs: number;
  /** ISO date up to and including which payment avoids those costs. */
  deadline: string;
  /** The statutory sentence, ready to render. */
  sentence: string;
}

const EUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
// [TZ] timeZone PINNED. formatDay() below builds midnight UTC from the ISO parts and formats it,
// which is right only as long as the RUNTIME's zone is UTC — true on the current host, and not a
// property of this code. On any other zone west of UTC the aanmaning would print the day before
// the one it is chasing. Pinning makes it independent of where it runs; on a UTC host the output
// is byte-identical.
const DATE = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });

function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso;
  return DATE.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/**
 * Everything the final reminder needs to be a legally effective aanmaning: the term, the exact
 * amount, and the sentence that names both. Returns null when there is nothing to demand.
 */
export function buildWikNotice(args: {
  openstaand: number;
  sentIso: string;
  debtorType: DebtorType;
  /**
   * [WIK-EEN-AANMANING] The other invoice numbers this one demand also covers, when the same
   * debtor is behind on more than one. Absent or empty = a single claim, and then every word of
   * this letter is exactly what it was.
   */
  covers?: readonly string[];
}): WikNotice | null {
  const principal = cents(Number(args.openstaand));
  if (!Number.isFinite(principal) || principal <= 0) return null;

  const costs = incassokosten(principal);
  const deadline = wikDeadline(args.sentIso);
  // [WIK-EEN-AANMANING] Art. 6:96 lid 7 BW: where a debtor can be aanmaand for more than one
  // claim, it happens in ONE aanmaning and the hoofdsommen are added together. So the letter has
  // to say which claims it adds up — a demand for a total the reader cannot reconcile with any
  // invoice they hold is exactly the demand they take to a judge.
  const anderen = (args.covers ?? []).map((n) => String(n ?? "").trim()).filter((n) => n !== "");
  const samen = anderen.length > 0
    ? ` Dit bedrag betreft de facturen ${anderen.join(", ")} samen.`
    : "";
  const sentence =
    args.debtorType === "consumer"
      ? `Wij verzoeken u het openstaande bedrag van ${EUR.format(principal)} uiterlijk op ${formatDay(deadline)} te voldoen.${samen} ` +
        `Betaalt u niet binnen deze termijn van veertien dagen, dan zijn wij genoodzaakt ${EUR.format(costs)} aan ` +
        `buitengerechtelijke incassokosten in rekening te brengen, vermeerderd met de wettelijke rente.`
      : `Wij verzoeken u het openstaande bedrag van ${EUR.format(principal)} uiterlijk op ${formatDay(deadline)} te voldoen.${samen} ` +
        `Bij uitblijven van betaling brengen wij ${EUR.format(costs)} aan buitengerechtelijke incassokosten in rekening, ` +
        // [HANDELSRENTE] Art. 6:119a lid 1 BW runs from the day FOLLOWING the last day of payment,
        // not from the vervaldatum itself. No amount is computed anywhere from this sentence, so
        // this corrects what the letter CLAIMS, which is the half a debtor can dispute.
        `vermeerderd met de wettelijke handelsrente vanaf de dag na de vervaldatum.`;

  return { debtorType: args.debtorType, principal, costs, deadline, sentence };
}

/**
 * [WIK-EEN-AANMANING] Which claims one aanmaning must cover, and what its hoofdsom is.
 *
 * ── WHY THIS IS NOT PER INVOICE ──
 *
 * The staffel of art. 6:96 lid 6 BW is degressive and starts at a EUR 40 MINIMUM, and lid 7 says
 * in as many words that where a debtor can be aanmaand for several claims — from one agreement or
 * from more than one — it happens in ONE aanmaning, with the hoofdsommen added together. Sending a
 * letter per invoice therefore does not merely repeat itself, it CHARGES more:
 *
 *     3 x EUR   100   one letter each:  3 x EUR 40  = EUR 120     together:  EUR  40
 *     3 x EUR 1.000   one letter each:  3 x EUR 150 = EUR 450     together:  EUR 425
 *
 * And for a consumer lid 5 makes this dwingend recht — the excess cannot be agreed away. Overstating
 * the fee is the classic ground on which the whole incassokosten claim is struck, so the owner does
 * not lose the difference, they lose the lot.
 *
 * Pure. The caller supplies every invoice of this debtor that is currently in verzuim; this decides
 * the one hoofdsom and names the claims.
 */
export interface WikClaim {
  invoiceNumber: string | null;
  /** What is still owed on this invoice — after payments AND after credits. */
  open: number;
}

export function aggregateWikClaims(claims: readonly WikClaim[]): { principal: number; numbers: string[] } {
  let principal = 0;
  const numbers: string[] = [];
  for (const c of claims) {
    const open = cents(Number(c.open));
    if (!Number.isFinite(open) || open <= 0) continue;
    principal += open;
    const n = String(c.invoiceNumber ?? "").trim();
    if (n !== "") numbers.push(n);
  }
  return { principal: cents(principal), numbers };
}

/**
 * Is `tier` the LAST reminder in this owner's schedule? The final tier is the one that carries
 * the statutory letter: it is the moment the app stops nudging and starts protecting the owner's
 * claim. Earlier tiers stay the friendly reminders they are — nobody wants a first reminder that
 * opens with collection costs.
 */
export function isFinalTier(tier: number, offsets: readonly number[]): boolean {
  const schedule = [...new Set(offsets)].filter((n) => Number.isInteger(n) && n > 0);
  if (schedule.length === 0) return false;
  return tier === Math.max(...schedule);
}
