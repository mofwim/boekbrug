// src/lib/payment-difference.ts
// [BETALINGSVERSCHIL] The remainder that is not a debt. Pure detectors; no I/O.
// Run: npx tsx src/lib/payment-difference.test.ts
//
// ── The gap this closes ───────────────────────────────────────────────────────────────────────
//
// A customer owes €1.000 and €995 arrives, because his bank took €5, or he rounded, or he
// deducted a discount nobody agreed. BoekBrug handles that correctly as far as it goes: the
// amount does not match to the cent, so nothing auto-books; the owner records a deelbetaling of
// €995; €5 stays open.
//
// And then €5 stays open FOREVER. Nobody will ever transfer it. It sits on the debtor list, the
// reminder cron chases it, and "Te ontvangen" is overstated by an amount that is not receivable.
// Repeat that over a year of card fees and rounding and the headline figure is quietly wrong in
// the one direction an owner never checks — too high.
//
// Every serious package has a name and a rule for this. AFAS calls it the maximaal
// betalingsverschil; SnelStart writes off up to 3% of the invoice; Dynamics 365 Business Central
// exposes it as TWO numbers — a Payment Tolerance % AND a Max Payment Tolerance Amount — and
// posts the difference to a named account so that, in its own words, "no remaining amount is left
// on the applied invoice entry".
//
// ── What this module does, and deliberately does not ─────────────────────────────────────────
//
// It DETECTS. It never books.
//
// That is the same line bad-debt.ts draws for artikel 29, and for the same reason: whether a
// €5 shortfall is a bank charge to shrug at, a disputed discount, or the first instalment of a
// customer in trouble is a judgement about a relationship, and the app cannot see the
// relationship. What it CAN see is that the remainder is too small and too old to be a real
// debt — and saying so is what turns a wrong total into an honest one.
//
// Business Central posts the difference to a tolerance account. BoekBrug has no general ledger to
// post it to (see docs/BANK_LINK.md on the aggregation model), so the equivalent honest act is to
// name the amount and let the owner decide. A flag the owner can act on beats a booking he did
// not ask for.
//
// ── Why the quiet period, which Business Central does not have ───────────────────────────────
//
// A tolerance alone cannot tell a payment difference from a first instalment. €5 outstanding on a
// €1.000 invoice paid ten minutes ago may simply be a transfer still in flight, or a payment plan
// whose next term is due. The same €5 untouched for a month is not going to arrive. Business
// Central does not need this test because a human is applying a specific payment in front of it;
// here the question is asked of a whole debtor list, unattended, so the age is what keeps an
// active payment plan out of the answer.

import { CENT_EPSILON, openAmount, toCents, totalAmount, type PartialPayInvoice } from "./partial-payment";

/**
 * The two numbers Business Central exposes, plus the one this context needs.
 *
 * A percentage alone scales wrongly at both ends: 2% of €50 is a cent nobody cares about, and 2%
 * of €50.000 is €1.000, which is a debt. So the percentage is capped by an absolute amount —
 * exactly the pair Business Central asks for (Payment Tolerance % and Max Pmt. Tolerance Amount).
 */
export interface PaymentDifferenceOpts {
  /** Share of the invoice that may count as a difference rather than a debt. */
  percent: number;
  /** Hard ceiling in euro, whatever the percentage works out to. */
  maxAmount: number;
  /** How long the remainder must have stood untouched before it stops looking like an instalment. */
  quietDays: number;
}

/**
 * Deliberately conservative. 2% sits under SnelStart's 3%; €10 keeps the absolute exposure small
 * for an owner who accepts every suggestion without looking. Both are policy, not law — the
 * detector takes them as arguments so a caller can tighten them, and no caller may loosen them
 * silently, because the defaults live here in one place.
 */
export const DEFAULT_PAYMENT_DIFFERENCE: PaymentDifferenceOpts = {
  percent: 2,
  maxAmount: 10,
  quietDays: 30,
};

export interface PaymentDifferenceInvoice extends PartialPayInvoice {
  id?: string | null;
  invoice_number?: string | null;
  /** The day the last money landed on this invoice. Null when nothing has been paid at all. */
  last_payment_date?: string | null;
}

export interface PaymentDifference {
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** What is still open — the amount that is not going to arrive. */
  remainder: number;
  /** The invoice's own magnitude, for context in the owner-facing sentence. */
  total: number;
}

/** Whole days between two ISO dates, or null when either is unusable. */
function daysBetween(fromIso: string | null | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/** The euro ceiling for THIS invoice: the percentage of its total, capped by the absolute. */
export function differenceCeiling(
  invoice: PartialPayInvoice,
  opts: PaymentDifferenceOpts = DEFAULT_PAYMENT_DIFFERENCE,
): number {
  return toCents(Math.min((totalAmount(invoice) * opts.percent) / 100, opts.maxAmount));
}

/**
 * Is this invoice's remainder a payment difference rather than a debt?
 *
 * Every condition is a way of being wrong if it is dropped:
 *   · something must already have been paid — an invoice nobody paid at all is a debt, however
 *     small, and calling a €4 invoice a "difference" would write off real revenue;
 *   · the remainder must be genuinely open — a settled invoice has nothing to report;
 *   · it must sit under the ceiling — above it, it is a short payment to chase, not a rounding;
 *   · and it must have stood still, or a live payment plan would be declared uncollectible on the
 *     day of its first instalment.
 */
export function detectPaymentDifference(args: {
  invoice: PaymentDifferenceInvoice;
  today: string;
  opts?: PaymentDifferenceOpts;
}): PaymentDifference | null {
  const { invoice, today } = args;
  const opts = args.opts ?? DEFAULT_PAYMENT_DIFFERENCE;

  const remainder = openAmount(invoice);
  if (remainder <= CENT_EPSILON) return null; // nothing open — settled, or settled by status

  const paid = Math.max(0, invoice.amount_paid ?? 0);
  if (paid <= CENT_EPSILON) return null; // never paid at all: a debt, not a difference

  if (remainder > differenceCeiling(invoice, opts)) return null; // too large to shrug at

  const quiet = daysBetween(invoice.last_payment_date, today);
  if (quiet == null || quiet < opts.quietDays) return null; // still moving, or we cannot tell

  return {
    invoiceId: invoice.id ?? null,
    invoiceNumber: invoice.invoice_number ?? null,
    remainder,
    total: totalAmount(invoice),
  };
}

export interface PaymentDifferenceReport {
  differences: PaymentDifference[];
  /** What "openstaand" overstates by, if none of these will ever arrive. */
  total: number;
}

/** Run the detector over a whole debtor list. Order preserved; totals in cents. */
export function detectPaymentDifferences(args: {
  invoices: readonly PaymentDifferenceInvoice[];
  today: string;
  opts?: PaymentDifferenceOpts;
}): PaymentDifferenceReport {
  const differences: PaymentDifference[] = [];
  for (const invoice of args.invoices) {
    const hit = detectPaymentDifference({ invoice, today: args.today, opts: args.opts });
    if (hit) differences.push(hit);
  }
  return {
    differences,
    total: toCents(differences.reduce((s, d) => s + d.remainder, 0)),
  };
}

/**
 * The owner-facing sentence, or null when there is nothing to say.
 *
 * Dutch, and careful about what it claims: it says these amounts are probably not coming, never
 * that they have been written off — because nothing here writes anything off.
 */
export function paymentDifferenceNote(report: PaymentDifferenceReport): string | null {
  const n = report.differences.length;
  if (n === 0) return null;
  const bedrag = report.total.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
  return n === 1
    ? `Eén factuur staat nog open voor ${bedrag}. Dat is te weinig om nog een betaling te zijn — waarschijnlijk bankkosten of een afronding. Je kunt hem afsluiten.`
    : `${n} facturen staan samen nog open voor ${bedrag}. Dat zijn restjes die niet meer binnenkomen — waarschijnlijk bankkosten of afrondingen. Je kunt ze afsluiten.`;
}
