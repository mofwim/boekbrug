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

function lineEx(l: DiscountLine): number {
  return typeof l.line_total === "number" ? l.line_total : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
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
 * Credit notes (negative lines) are left alone: a discount on a correction is not a thing anyone
 * asks for, and halving a negative is the kind of arithmetic nobody can check by eye.
 */
export function applyDiscount(lines: DiscountLine[], discount: Discount | null): DiscountedTotals {
  const exByRate = new Map<number, number>();
  for (const l of lines) {
    const rate = Number(l.btw_rate) || 0;
    exByRate.set(rate, (exByRate.get(rate) ?? 0) + lineEx(l));
  }
  const subtotal = round2([...exByRate.values()].reduce((s, e) => s + e, 0));

  const positive = subtotal > 0;
  const wanted = !discount || !positive
    ? 0
    : discount.type === "percent"
      ? round2((subtotal * discount.value) / 100)
      : round2(discount.value);
  // The cap only means anything on a POSITIVE invoice. Math.min(0, −1000) is −1000, so on a credit
  // note this returned a negative "discount" — a surcharge, from an owner who typed a discount.
  // The test found it; `positive` was already computed two lines up and simply was not used here.
  const applied = positive ? Math.min(wanted, subtotal) : 0;

  const allowances: RateAllowance[] = [];
  if (applied > 0) {
    // Only groups with a positive share can carry part of a discount. A negative group on an
    // otherwise positive invoice would otherwise receive a negative allowance, which reads as a
    // surcharge in UBL and is not what anyone typed.
    const groups = [...exByRate.entries()].filter(([, e]) => e > 0).sort((a, b) => b[1] - a[1]);
    const base = groups.reduce((s, [, e]) => s + e, 0);
    let assigned = 0;
    for (let i = 0; i < groups.length; i++) {
      const [rate, ex] = groups[i];
      // The LAST group takes the remainder, so the parts always sum to `applied` to the cent. The
      // groups are sorted largest-first, so the remainder lands on the smallest share, where a
      // cent distorts least — and never outside the discount the owner typed.
      const part = i === groups.length - 1 ? round2(applied - assigned) : round2((applied * ex) / base);
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
