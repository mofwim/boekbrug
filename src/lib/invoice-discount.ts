// src/lib/invoice-discount.ts
// [KORTING] A discount on the whole invoice — a percentage or a fixed amount. Pure, no I/O.
// Run: npx tsx --test src/lib/invoice-discount.test.ts
//
// WHY A DOCUMENT-LEVEL DISCOUNT IS NOT A SUBTRACTION
// "Trek er 10% af" reads like one line of arithmetic and is not, because BTW is owed PER TARIEF.
// An invoice with EUR 1.000 at 21% and EUR 1.000 at 9% and a EUR 200 discount does not owe
// (2.000 − 200) × some blended rate — it owes 21% over its reduced 21%-part and 9% over its
// reduced 9%-part. Subtract the discount from the total and both boxes of the aangifte are wrong,
// in opposite directions, on every mixed-rate invoice.
//
// So the discount is APPORTIONED over the rate groups, pro rata to what each group contributes.
// That is also the only shape a compliant e-invoice can carry it in: Peppol BIS 3.0 puts a
// document-level discount in AllowanceCharge, and each AllowanceCharge carries exactly ONE
// TaxCategory — so a mixed-rate invoice needs one allowance per rate, which is precisely what
// this module produces.
//
// THE CENT HAS TO LAND SOMEWHERE
// Pro rata splitting produces fractions. Rounding each part on its own loses or gains a cent
// against the discount the owner typed, and then the invoice does not add up — the failure this
// codebase already has a scar from ([REGEL-AFRONDING]: a UBL where the line sum and
// LegalMonetaryTotal disagreed by a cent is REJECTED at the receiving access point under BR-CO-10).
// The remainder is therefore assigned deliberately, to the largest group, and the parts are
// asserted to sum to the whole.

import { round2 } from "./invoice-totals";

export type DiscountType = "percent" | "amount";

export interface Discount {
  type: DiscountType;
  /** Percent: 0–100. Amount: euros, excl. BTW. */
  value: number;
}

export interface DiscountLine {
  line_total?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  btw_rate?: number | null;
  // [REGEL-KORTING] The line's OWN discount. Only read when line_total is absent — see lineEx.
  // The value is `number | string` because the editor holds RAW input: a half-typed "12," must
  // stay half-typed rather than snap to zero under the owner's fingers. parseDiscount reads both,
  // so the screen and the stored row go through one definition instead of two.
  discount_type?: string | null;
  discount_value?: number | string | null;
}

/** What the discount takes off one BTW rate group. */
export interface RateAllowance {
  rate: number;
  /** Positive euros removed from this group's excl. amount. */
  amount: number;
}

export interface DiscountedTotals {
  /** Excl.-BTW sum of the lines, BEFORE the discount. */
  subtotal_ex_btw: number;
  /** The discount actually applied, excl. BTW. Positive. */
  discount_ex_btw: number;
  /** One entry per rate group that the discount touched — the UBL AllowanceCharge set. */
  allowances: RateAllowance[];
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
}

const MAX_PERCENT = 100;

/**
 * [REGEL-KORTING] What one line is worth BEFORE its own discount: quantity × price.
 *
 * Rounded, because this is the number the discount is computed over and the number the PDF prints
 * as the line's base. An unrounded base would put a fraction of a cent into the allowance and from
 * there into a UBL file that has to add up exactly (BR-CO-10).
 */
export function lineGrossEx(l: DiscountLine): number {
  return round2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
}

/**
 * [REGEL-KORTING] What a line's own discount takes off it. Signed, and never more than the line.
 *
 * The same shape as the document discount one level down, and deliberately the same arithmetic:
 * a percentage of the magnitude, or a fixed amount, capped at the line and carrying the line's
 * sign. A credit line (negative quantity — see negative-line.ts) therefore mirrors its discount
 * exactly like a creditnota mirrors the document's, which is what lets a credit note reproduce
 * the invoice it reverses line for line.
 *
 * Returns 0 for no discount, so a caller can subtract unconditionally.
 */
export function lineDiscountEx(grossEx: number, discount: Discount | null): number {
  const gross = round2(grossEx);
  if (!discount || gross === 0) return 0;
  const sign = gross < 0 ? -1 : 1;
  const magnitude = Math.abs(gross);
  const wanted = discount.type === "percent"
    ? round2((magnitude * discount.value) / 100)
    : round2(discount.value);
  // Capped at the line, never through it. A EUR 80 discount on a EUR 50 line is a typo, and
  // letting it turn the line negative would invent a credit inside a delivery — a different
  // document (negative-line.ts) reached by arithmetic nobody asked for.
  return round2(sign * Math.min(wanted, magnitude));
}

/**
 * [REGEL-KORTING] What a line is worth after its own discount — the amount that gets STORED.
 *
 * Both operands are already rounded to cents, so the subtraction is exact and the stored line
 * total is reproducible from the three fields beside it. That exactness is what the e-factuur
 * needs: PEPPOL-EN16931-R120 recomputes quantity × price − allowance and compares it to the line
 * amount, and a rounding done in the wrong order is a rejected file.
 */
export function lineNetEx(l: DiscountLine): number {
  const gross = lineGrossEx(l);
  return round2(gross - lineDiscountEx(gross, parseDiscount(l.discount_type, l.discount_value)));
}

/**
 * The excl.-BTW amount of one line, as every summation here reads it.
 *
 * WHEN line_total IS PRESENT IT IS ALREADY NET. That is the whole contract of
 * invoice_line_discount.sql: the stored column carries the amount after the line's own discount,
 * so a reader that knows nothing about the discount columns still sums the right money. Subtracting
 * the discount again here would take it off twice — an invoice that undercharges, silently, on
 * exactly the lines that were meant to be cheaper.
 *
 * The fallback is the only place the discount is applied, because there the amount is being
 * computed from quantity × price and nothing has taken it off yet.
 */
function lineEx(l: DiscountLine): number {
  return typeof l.line_total === "number" ? l.line_total : lineNetEx(l);
}

/**
 * Read a discount the owner entered, or null when there is none.
 *
 * Null is the answer for an empty field, a zero, or anything unusable — a caller then computes
 * exactly the totals it computed before this feature existed. A discount of zero is not a
 * discount, and storing one would put "Korting: € 0,00" on a customer's invoice.
 */
export function parseDiscount(type: unknown, value: unknown): Discount | null {
  const t = String(type ?? "").trim();
  if (t !== "percent" && t !== "amount") return null;

  // EMPTY IS NOT ZERO — Number("") is 0, and an untouched field must not become a discount.
  const raw = typeof value === "number" ? value : String(value ?? "").trim().replace(",", ".");
  if (typeof raw === "string" && raw.length === 0) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (t === "percent" && n > MAX_PERCENT) return null;
  return { type: t, value: t === "percent" ? n : round2(n) };
}

/**
 * Apply a discount to a set of lines and return every figure the invoice needs.
 *
 * With no discount this returns exactly what computeInvoiceTotals returns, so a caller can use it
 * unconditionally rather than branching — one path, not two that can drift.
 *
 * A discount larger than the invoice is CAPPED at the invoice, not refused: the caller has already
 * accepted the number, and turning a EUR 500 discount on a EUR 400 invoice into a negative total
 * would invent a credit note out of a typo. The applied figure is returned, so a screen can show
 * what really came off.
 *
 * SIGN-SYMMETRIC, and that is not a nicety. A creditnota copies its lines from the invoice it
 * reverses and negates them; if the discount did not come along, a EUR 1.000 invoice discounted to
 * EUR 900 produced a credit note whose stored header said −900 while its LINES said −1.000. Every
 * surface that derives from lines — the PDF, the UBL export — then printed a refund of EUR 121 more
 * than was ever charged, on a legal document. Measured before this was fixed.
 *
 * So a negative document gets the mirror of the discount: the same percentage or amount, applied to
 * the magnitude, with the sign carried through. A credit note reversing a discounted invoice then
 * reproduces that invoice exactly, line for line and allowance for allowance, which is the form an
 * accountant can check against the original.
 *
 * Nothing lets an owner TYPE a discount onto a credit note — the screens exclude it, because a
 * discount on a correction is not something anyone asks for. The only source is a copy.
 */
export function applyDiscount(lines: DiscountLine[], discount: Discount | null): DiscountedTotals {
  const exByRate = new Map<number, number>();
  for (const l of lines) {
    const rate = Number(l.btw_rate) || 0;
    exByRate.set(rate, (exByRate.get(rate) ?? 0) + lineEx(l));
  }
  const subtotal = round2([...exByRate.values()].reduce((s, e) => s + e, 0));

  // The document's own direction. A creditnota is negative throughout — lines, totals, allowances —
  // so the discount is mirrored rather than skipped. Everything below works on the MAGNITUDE and
  // multiplies the sign back in, which keeps the cap meaningful in both directions: Math.min against
  // a negative subtotal was how an earlier version turned a discount into a surcharge.
  const sign = subtotal < 0 ? -1 : 1;
  const magnitude = Math.abs(subtotal);
  const wanted = !discount || magnitude === 0
    ? 0
    : discount.type === "percent"
      ? round2((magnitude * discount.value) / 100)
      : round2(discount.value);
  const appliedMagnitude = Math.min(wanted, magnitude);
  const applied = round2(sign * appliedMagnitude);

  const allowances: RateAllowance[] = [];
  if (appliedMagnitude > 0) {
    // Only groups pointing the SAME WAY as the document carry part of the discount. A negative
    // group on an otherwise positive invoice would otherwise receive a negative allowance, which
    // reads as a surcharge in UBL — the opposite of what was meant.
    const groups = [...exByRate.entries()]
      .filter(([, e]) => sign * e > 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const base = groups.reduce((s, [, e]) => s + Math.abs(e), 0);
    let assigned = 0;
    for (let i = 0; i < groups.length; i++) {
      const [rate, ex] = groups[i];
      // The LAST group takes the remainder, so the parts always sum to `applied` to the cent. The
      // groups are sorted largest-first, so the remainder lands on the smallest share, where a
      // cent distorts least — and never outside the discount the owner agreed.
      const part = i === groups.length - 1
        ? round2(applied - assigned)
        : round2(sign * ((appliedMagnitude * Math.abs(ex)) / base));
      assigned = round2(assigned + part);
      if (part !== 0) allowances.push({ rate, amount: part });
    }
  }

  const removedByRate = new Map<number, number>();
  for (const a of allowances) removedByRate.set(a.rate, (removedByRate.get(a.rate) ?? 0) + a.amount);

  const ex = round2([...exByRate.entries()].reduce((s, [rate, e]) => s + e - (removedByRate.get(rate) ?? 0), 0));
  const btw = round2(
    [...exByRate.entries()].reduce(
      (s, [rate, e]) => s + round2(((e - (removedByRate.get(rate) ?? 0)) * rate) / 100),
      0,
    ),
  );

  return {
    subtotal_ex_btw: subtotal,
    discount_ex_btw: applied,
    allowances,
    total_ex_btw: ex,
    btw_amount: btw,
    total_inc_btw: round2(ex + btw),
  };
}

/** The Dutch label for the discount row on a document. Null when there is no discount. */
export function discountLabel(discount: Discount | null): string | null {
  if (!discount) return null;
  if (discount.type === "percent") {
    // Dutch decimal comma, and no trailing ",0" on a whole percentage.
    const pct = Number.isInteger(discount.value) ? String(discount.value) : String(discount.value).replace(".", ",");
    return `Korting (${pct}%)`;
  }
  return "Korting";
}
