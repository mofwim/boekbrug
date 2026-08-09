// src/lib/unit-price-display.ts
// [PRIJS-KOLOM] How many decimals a unit price needs so the line adds up on paper. Pure, no I/O.
// Run: npx tsx --test src/lib/unit-price-display.test.ts
//
// THE PROBLEM, MEASURED ON A REAL QUOTE
// invoice_lines.unit_price holds the EXACT price, deliberately: someone selling at "EUR 0,90 all-in"
// stores 0,90 / 1,09 = 0,825688… so the customer pays the amount that was promised (see the header
// of price-mode.ts). Every surface then printed that with two decimals, next to a line total
// computed from the exact value:
//
//     Worstjes    150 x EUR 0,83  = EUR 124,50      the line said EUR 123,85    65 cent apart
//     Kip spies   100 x EUR 1,74  = EUR 174,00      the line said EUR 174,31    31 cent
//     Broodjes     38 x EUR 1,61  = EUR  61,18      the line said EUR  61,01    17 cent
//     Sauzen        2 x EUR 1,61  = EUR   3,22      the line said EUR   3,21     1 cent
//
// EUR 1,14 of visible nonsense on a four-line document — on the PDF the customer keeps, and on the
// screen the owner reads back. The e-invoice had the same defect and was fixed with cbc:BaseQuantity
// ("EUR 123,85 per 150 stuks"), which is exact but is not how a person reads a price column.
//
// THE ANSWER FOR A HUMAN DOCUMENT is to print the price with enough digits to be true. A unit price
// with four or five decimals is ordinary in trades that sell by the hundred — and it is a great deal
// better than a column that does not multiply.
//
// So: use the FEWEST decimals that reproduce the line total, starting at two. Almost every invoice
// in this product has round unit prices, and for those the answer is two and nothing changes.
//
// WHY IT IS QUANTITY-DEPENDENT AND NOT A FIXED NUMBER
// The rounding error of the price is multiplied by the quantity. At two decimals the price is off by
// at most half a cent, which on 150 units is 75 cents. To land within half a cent of the line total
// you need d such that quantity x 0,5 x 10^-d < 0,005 — for 150 units that is five decimals, for two
// units it is two. A fixed "always four" is wrong in both directions: noisy on small quantities and
// still false on large ones.

/** Beyond this a price column stops being readable, and the remaining error is under a cent anyway. */
const MAX_DECIMALS = 6;
const MIN_DECIMALS = 2;

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f + 1e-9) / f;
}

/**
 * The number of decimals to print a unit price with, so that quantity x price equals the line total.
 *
 * Returns 2 for everything that already works — which is nearly every line — so an existing invoice
 * is unchanged to the digit. Returns MAX_DECIMALS when no precision in range reconciles (an enormous
 * quantity); that is the closest available answer, not a claim that it is exact.
 */
export function unitPriceDecimals(
  unitPrice: number | null | undefined,
  quantity: number | null | undefined,
  lineTotal: number | null | undefined,
): number {
  const p = Number(unitPrice);
  const q = Number(quantity);
  if (!Number.isFinite(p) || !Number.isFinite(q)) return MIN_DECIMALS;

  // A line total that was never stored: the column is then quantity x price by definition, and no
  // amount of precision can disagree with it.
  const target = lineTotal === null || lineTotal === undefined || !Number.isFinite(Number(lineTotal))
    ? round2(q * p)
    : round2(Number(lineTotal));

  for (let d = MIN_DECIMALS; d <= MAX_DECIMALS; d++) {
    if (round2(q * roundTo(p, d)) === target) return d;
  }
  return MAX_DECIMALS;
}

/**
 * A unit price in Dutch notation, with exactly the precision the line needs.
 *
 * Kept here rather than in format-nl.ts because the decision and the formatting are one thing: a
 * caller that could pick its own decimal count would be able to reintroduce the column that does
 * not add up.
 */
export function formatUnitPriceNL(
  unitPrice: number | null | undefined,
  quantity: number | null | undefined,
  lineTotal: number | null | undefined,
): string {
  const p = Number(unitPrice);
  const value = Number.isFinite(p) ? p : 0;
  const decimals = unitPriceDecimals(value, quantity, lineTotal);
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(value)
    // Intl uses a non-breaking space after the € sign; the PDF font renders it as a box.
    .replace(/ /g, " ");
}
