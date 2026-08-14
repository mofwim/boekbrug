// src/lib/read-line.ts
// [MIN-REGEL] An invoice line as it comes back from a READING — a scan, or a model writing from a
// prompt. Pure. Run: npx tsx --test src/lib/read-line.test.ts
//
// Two places turn a reading into a line the owner can edit: the free invoice tool, which carries a
// scanned document into its line table, and generateInvoiceFromPrompt, which turns "twee uur
// advies" into a row. Both wrote the same guard:
//
//     quantity: typeof q === 'number' && q > 0 ? q : 1
//
// `> 0` is doing two jobs at once, and only one of them is wanted. It rejects a quantity that is
// absent, null or unusable — right, and the fallback of 1 is right too, because a scan that gives
// only a line total means "one of this thing". But it ALSO rejects a NEGATIVE quantity, and that is
// not an unusable reading: it is a credit line. A wholesaler settles a return on the next invoice
// (ATAPACK 26304787: -3 x EUR 23,95 = -71,85), and this is what happened to it:
//
//     the paper        -3 x EUR 23,95  =  EUR -71,85
//     what was carried  1 x EUR 23,95  =  EUR  23,95
//
// EUR 95,80 of swing on one row, in the direction of charging the customer, with nothing on the
// screen saying a number had been changed. The owner sees a plausible line at a plausible price.
//
// ── AND THE SIGN GOES IN THE QUANTITY ──
//
// A reading can put the minus in either field — a model transcribing "-71,85" against a quantity of
// 3 will sometimes write the price negative. That form cannot be issued: EN 16931 BR-27 forbids a
// negative cbc:PriceAmount, so the e-factuur would be refused by the access point while the PDF
// looked perfect. So it is normalised here, once, into the form the rest of the app uses
// (negative-line.ts): the quantity carries the sign, the price is a magnitude.

/** Is this a number we can compute with at all? */
const usable = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The quantity of a read line.
 *
 * A missing, unreadable or zero quantity becomes `fallback` (1 by default): a reading that gives
 * only a line total describes one of the thing. A NEGATIVE quantity is kept — that is a credit
 * line, and it is the whole reason this function exists.
 */
export function readQuantity(value: unknown, fallback = 1): number {
  return usable(value) && value !== 0 ? value : fallback;
}

/**
 * Move the minus out of the price and into the quantity.
 *
 * Returns the pair unchanged when the price is not negative — which is almost every line — so this
 * is invisible to every reading that was already in the right shape.
 */
export function signInQuantity(
  quantity: number,
  unitPrice: number,
): { quantity: number; unit_price: number } {
  if (!usable(quantity) || !usable(unitPrice) || unitPrice >= 0) {
    return { quantity, unit_price: unitPrice };
  }
  return { quantity: -quantity, unit_price: -unitPrice };
}

/**
 * The quantity and unit price of a read line, in the form the app stores.
 *
 * `amount` is the line total, which a scan often gives INSTEAD of a unit price. It is only used
 * when there is no usable price of its own, and then the arithmetic still reproduces what the paper
 * said: amount ÷ quantity, with the sign moved afterwards.
 *
 * Returns null when there is no price to be had at all. What to do about that is the caller's:
 * the free tool drops the line, and the prompt writer keeps it at zero.
 */
export function readLineAmounts(input: {
  quantity?: unknown;
  unit_price?: unknown;
  amount?: unknown;
}): { quantity: number; unit_price: number } | null {
  const quantity = readQuantity(input.quantity);
  const price = usable(input.unit_price) && input.unit_price !== 0
    ? input.unit_price
    : usable(input.amount) && quantity !== 0
      ? input.amount / quantity
      : null;
  if (price === null || !Number.isFinite(price)) return null;
  return signInQuantity(quantity, price);
}
