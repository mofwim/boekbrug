// src/lib/partial-payment.ts
// [PARTIAL-PAY] The shared, pure vocabulary of a partly-settled invoice. NO I/O.
//
// One definition of "openstaand" for every surface. Before this, each screen re-derived it
// (or forgot to): the debtor list showed the full total on a half-paid invoice while the
// reminder mail and the pay-QR already asked only the remainder. The rule, once:
//
//     openstaand = status 'paid' ? 0 : max(0, |total_inc_btw| − amount_paid)
//
// A fully-paid invoice reads 0 BY STATUS (its amount_paid is then irrelevant), so a legacy
// row that was marked paid before amount_paid existed can never report a phantom balance.
// Everything is a MAGNITUDE — a creditnota's negative total is abs()'d, exactly as the
// database functions do (apply_bank_payment, recompute_invoice_amount_paid).

import { round2 } from "./invoice-totals";

/** The invoice fields the partial-payment vocabulary reads. A subset of the invoices row. */
export interface PartialPayInvoice {
  status?: string | null;
  total_inc_btw?: number | null;
  amount_paid?: number | null;
}

/** Cents tolerance. OCR/xlsx totals can be a rounding tick off; within a cent counts as equal. */
export const CENT_EPSILON = 0.005;

/** Round to cents, killing float dust (0.1 + 0.2 style) before it reaches the UI. */
export function toCents(value: number): number {
  return round2(value);
}

/** What has actually been settled so far (magnitude, never negative). */
export function paidAmount(invoice: PartialPayInvoice): number {
  return Math.max(0, invoice.amount_paid ?? 0);
}

/** The invoice's own magnitude, sign-free (a creditnota's total is negative). */
export function totalAmount(invoice: PartialPayInvoice): number {
  return Math.abs(invoice.total_inc_btw ?? 0);
}

/**
 * The still-owed balance derived from the MONEY alone, ignoring the status. Only for write
 * paths that have already established the invoice is open (the confirm route rejects a 'paid'
 * invoice long before it asks this) and now need the figure a payment has to reach.
 * Screens must use openAmount() — a legacy row marked paid before amount_paid existed would
 * otherwise report a phantom balance.
 */
export function openBalanceFromAmounts(invoice: PartialPayInvoice): number {
  return toCents(Math.max(0, totalAmount(invoice) - paidAmount(invoice)));
}

/**
 * Openstaand: what is still owed on this invoice. 0 once the status says paid — the status
 * is the authority on completion, amount_paid only describes the road there.
 */
export function openAmount(invoice: PartialPayInvoice): number {
  if (invoice.status === "paid") return 0;
  return openBalanceFromAmounts(invoice);
}

/**
 * [OPEN-TOTAL] Openstaand WITH its sign — for adding several invoices together.
 *
 * openAmount above is a magnitude, and that is right for everything it was written for: a payment
 * has to reach a positive figure, a QR cannot request a negative one, "nog € X open" on a row is
 * an amount you hand over. Add a column of them, though, and a supplier's creditnota starts
 * INCREASING what you owe that supplier — which is the opposite of what a creditnota is, and the
 * opposite of what the same screen shows on that row, where the amount is printed with its minus.
 *
 * A total that does not add up to what the eye can add up is worse than no total, so summing uses
 * this one: the same magnitude, carrying the direction the invoice itself states.
 */
export function openAmountSigned(invoice: PartialPayInvoice): number {
  const open = openAmount(invoice);
  if (open === 0) return 0;
  return (invoice.total_inc_btw ?? 0) < 0 ? -open : open;
}

/**
 * [OPEN-TOTAL] The other half of the invoice: what has already been SETTLED on it, with the same
 * sign. Built so that, for every invoice,
 *
 *     openAmountSigned(inv) + settledAmountSigned(inv) === signed total
 *
 * exactly, in cents. That identity is the whole reason this function exists rather than "sum the
 * paid ones": a screen that prints "nog te betalen", "betaald" and "totaal" next to each other
 * invites the reader to add the first two, and on a partly-paid invoice a betaald-figure that only
 * counted invoices marked 'paid' would leave the €200 already transferred out of BOTH columns
 * while it sits inside the total. Three figures that do not add up cost more trust than the third
 * one buys.
 *
 * A 'paid' invoice settles its full magnitude even when amount_paid was never populated (legacy
 * rows predate partial payments), and an over-payment cannot settle more than the invoice is
 * worth — both are what keeps the identity true.
 */
export function settledAmountSigned(invoice: PartialPayInvoice): number {
  const total = totalAmount(invoice);
  const magnitude = invoice.status === "paid" ? total : Math.min(paidAmount(invoice), total);
  const settled = toCents(magnitude);
  if (settled === 0) return 0;
  return (invoice.total_inc_btw ?? 0) < 0 ? -settled : settled;
}

/**
 * Money left over that is too small to be another invoice. A customer who rounds €99,95 up to
 * €100 has not paid two invoices — keeping their bank line open "for the rest" would leave five
 * cents haunting the te-bevestigen list forever. Above this, a leftover is treated as money that
 * still belongs to someone: the bank line stays open until it is assigned.
 */
export const PAYMENT_DUST = 1;

/**
 * [PARTIAL-PAY-GUARD] Does this payment have MORE to give than this invoice can absorb?
 *
 * The single question that decides how a bank booking is written, and it is deliberately asked
 * in money. The alternative — "does the reference list several invoice numbers?" — is not a
 * fact about the payment at all, and it was wrong in both directions:
 *
 *   false positive: "Klantnr 884512 factuur 20260041" tokenises as two numbers, so a €500
 *     instalment on a €1.815 invoice took the amount-blind batch path and was booked as fully
 *     paid — €1.315 of revenue that never arrived, the debtor off the aging list, and under
 *     kasstelsel the whole sum declared in the wrong BTW quarter.
 *   false negative: a real bundle whose numbers the extractor mutilated ("2026-045, 2026-046"
 *     is stored as "045, 046") looked single, so the €1.100 that paid two invoices was
 *     swallowed by the first one — the second stayed open with its money already spent.
 *
 * NO → one invoice absorbs everything this payment has (in full, or as an honest deelbetaling)
 *      and the bank line is finished.
 * YES → settle this invoice and keep the bank line open for the rest of the money.
 *
 * An invoice with nothing left open returns false: it cannot absorb anything, and the caller's
 * own already-paid checks own that case.
 */
export function paymentExceedsOpenBalance(
  payAmount: number | null | undefined,
  invoice: PartialPayInvoice,
  dust: number = PAYMENT_DUST,
): boolean {
  const open = openBalanceFromAmounts(invoice);
  if (open <= 0) return false;
  return Math.abs(Number(payAmount ?? 0)) > open + Math.max(CENT_EPSILON * 2, dust);
}

/**
 * True only for the genuinely in-between state: still open, but part of it is already
 * settled. A fully-open invoice (nothing paid) and a completed one are both false — they
 * have their own, clearer UI (the plain amount, and the 'Betaald' chip).
 */
export function isPartiallyPaid(invoice: PartialPayInvoice): boolean {
  if (invoice.status === "paid") return false;
  const paid = paidAmount(invoice);
  const total = totalAmount(invoice);
  return paid > CENT_EPSILON && paid < total - CENT_EPSILON;
}

/**
 * Parse what a human typed into an amount field, or null when it isn't a usable amount.
 *
 * Dutch keyboards and Dutch habits produce "400", "400,50", "1.000,00" — and phones with an
 * English layout produce "1000.50". A naive Number(str.replace(',', '.')) turns "1.000,00"
 * into NaN, so it must decide which separator is the DECIMAL one:
 *   · both present  → the LAST one is the decimal separator, the other groups thousands
 *   · only a comma  → decimal (Dutch convention; nobody writes 1,000 for a thousand here)
 *   · only a dot    → thousands when it is followed by exactly three digits and the string
 *                     looks grouped ("1.000"); otherwise a decimal point ("10.50")
 * Returns null for empty, non-numeric, negative or non-finite input — never 0-by-accident,
 * so a caller can tell "typed nothing" from "typed zero".
 */
export function parseAmountInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[\s €]/g, "");
  if (!cleaned) return null;
  if (!/^[0-9.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the rightmost separator is the decimal one, the other is grouping.
    const decimalAt = Math.max(lastComma, lastDot);
    const groupChar = decimalAt === lastComma ? "." : ",";
    normalized =
      cleaned.slice(0, decimalAt).split(groupChar).join("") + "." + cleaned.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    normalized = cleaned.split(",").join(".");
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1;
    const grouped = decimals === 3 && lastDot > 0;
    normalized = grouped ? cleaned.split(".").join("") : cleaned;
  } else {
    normalized = cleaned;
  }

  // A second separator would survive as a stray dot ("1.2.3") → reject rather than guess.
  if ((normalized.match(/\./g) ?? []).length > 1) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return toCents(value);
}

export interface AmountEntry {
  /** The amount to book, or null when the field is empty (= settle the whole open balance). */
  amount: number | null;
  /** True when the entry may be submitted. */
  valid: boolean;
  /** Dutch, UI-ready reason why it may not — null when valid. */
  error: string | null;
  /** What stays open after booking this amount. */
  remainingAfter: number;
  /** True when this entry settles the invoice completely. */
  settlesFully: boolean;
}

/**
 * Interpret the "Betaald bedrag" field against the invoice's open balance.
 *
 * EMPTY MEANS EVERYTHING — the common case costs zero keystrokes, and someone who has never
 * heard the word "deelbetaling" never meets it. A typed amount is capped at the open balance:
 * an invoice can never be over-paid (the database clamps with LEAST too, this is the honest
 * message before the tap rather than a silent correction after it).
 */
export function interpretAmountEntry(raw: string | null | undefined, open: number): AmountEntry {
  const openRounded = toCents(Math.max(0, open));
  const isBlank = raw == null || String(raw).trim() === "";

  if (isBlank) {
    return { amount: null, valid: openRounded > 0, error: null, remainingAfter: 0, settlesFully: true };
  }

  const parsed = parseAmountInput(raw);
  if (parsed == null) {
    return { amount: null, valid: false, error: "Vul een geldig bedrag in.", remainingAfter: openRounded, settlesFully: false };
  }
  if (parsed <= CENT_EPSILON) {
    return { amount: parsed, valid: false, error: "Het bedrag moet hoger zijn dan € 0,00.", remainingAfter: openRounded, settlesFully: false };
  }
  if (parsed > openRounded + CENT_EPSILON) {
    return {
      amount: parsed,
      valid: false,
      error: `Er kan maximaal ${formatEur(openRounded)} op deze factuur geboekt worden.`,
      remainingAfter: 0,
      settlesFully: false,
    };
  }

  const remainingAfter = toCents(Math.max(0, openRounded - parsed));
  // Within a cent of the balance counts as fully settled — the same epsilon the database
  // uses when deciding to flip the status to 'paid'.
  const settlesFully = remainingAfter <= CENT_EPSILON * 2;
  return {
    // Typing the exact open balance means the same as leaving the field empty: settle it all.
    // Reported as null so every caller has ONE representation of "the whole rest" — the
    // server then takes its full-settlement path (which cash supports) instead of treating
    // it as an instalment that merely happens to close the invoice.
    amount: settlesFully ? null : parsed,
    valid: true,
    error: null,
    remainingAfter,
    settlesFully,
  };
}

/** What apply_manual_payment / apply_bank_payment hand back. */
export interface AppliedPaymentRow {
  applied: number;
  amount_paid: number;
  total: number;
  is_paid: boolean;
  duplicate?: boolean;
}

export interface PaymentResult {
  ok: true;
  /** The invoice's status AFTER the booking — unchanged when it is only partly settled. */
  status: string;
  /** True when the invoice is still open for the rest. The clients branch on exactly this. */
  partial: boolean;
  applied: number;
  amountPaid: number;
  remaining: number;
  duplicate?: boolean;
}

/**
 * Shape the API answer for a booked payment. ONE function, because the write path and the
 * idempotent-replay path must answer identically.
 *
 * This exists because they once did not: the replay branch returned the full shape while the
 * real booking returned a bare {ok, status:'paid'} — correct back when paying was
 * all-or-nothing, a lie the moment a deelbetaling became possible. The clients decide between
 * "still open for the rest" and "settled" purely on `partial`, so the omission made every
 * first instalment render as a completed payment while the database correctly disagreed.
 */
export function buildPaymentResult(
  row: AppliedPaymentRow,
  openStatus: string | null | undefined
): PaymentResult {
  const fullyPaid = row.is_paid === true;
  const remaining = toCents(Math.max(0, (row.total ?? 0) - (row.amount_paid ?? 0)));
  return {
    ok: true,
    status: fullyPaid ? "paid" : (openStatus ?? "sent"),
    partial: !fullyPaid,
    applied: row.applied ?? 0,
    amountPaid: row.amount_paid ?? 0,
    remaining,
    ...(row.duplicate === true ? { duplicate: true } : {}),
  };
}

const EUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

/** € 1.234,56 — the one formatter, so every partial-pay string reads the same. */
export function formatEur(value: number): string {
  return EUR.format(value);
}

// ── [BANK-SPLIT] How much of THIS bank line goes onto THIS invoice ───────────────────────────
//
// Every bookkeeping package solves one payment covering several invoices the same way: you pick an
// invoice and you say how much of the line it takes. Xero calls it Split, Moneybird "koppel
// openstaand bedrag" and then "koppel volgend bedrag", Odoo allocates during reconciliation. What
// they share is that the AMOUNT is the owner's to state, and the line keeps a visible remainder.
//
// BoekBrug already had the whole mechanism: apply_bank_payment takes p_amount, bank_tx_invoices
// records amount_applied per link, and /api/bank/confirm computes what the line has left after its
// other links. Only one thing was missing — the amount was always DERIVED ("everything left")
// instead of stated. That is fine while each invoice is settled in full, and wrong the moment a
// payment covers part of one invoice and all of another: the first invoice is big enough to absorb
// the entire line, so it does, and the second is left with its money already gone.
//
// Absent `requested`, this returns exactly what the route did before, so every existing caller and
// the automatic booking path are unchanged.

export type AllocationInput = {
  /** What the owner typed, or null/undefined for "whatever this line has left". */
  requested?: number | null;
  /** What this bank line still has to give, after its other links. */
  payAvailable: number;
  /** What this invoice still owes (magnitude). */
  invoiceOpen: number;
};

export type AllocationResult =
  | { ok: true; amount: number }
  /** The owner asked for nothing, or for a negative. */
  | { ok: false; reason: "not_positive" }
  /** More than the bank line has left — money that does not exist. */
  | { ok: false; reason: "exceeds_payment"; available: number }
  /** More than the invoice owes. Refused rather than clamped: a screen that says €500 and books
   *  €300 has told the owner something untrue, and this is the screen the accountant inherits. */
  | { ok: false; reason: "exceeds_invoice"; open: number };

export function resolveAllocation(input: AllocationInput): AllocationResult {
  const available = toCents(Math.max(0, input.payAvailable));
  if (input.requested == null) return { ok: true, amount: available };

  const want = Number(input.requested);
  if (!Number.isFinite(want) || want <= 0) return { ok: false, reason: "not_positive" };
  const amount = toCents(want);
  // CENT_EPSILON on both bounds: a figure the screen derived by subtraction can land a hair over
  // its own ceiling, and refusing the owner's own arithmetic would be absurd.
  if (amount > available + CENT_EPSILON) return { ok: false, reason: "exceeds_payment", available };
  const open = toCents(Math.max(0, input.invoiceOpen));
  if (amount > open + CENT_EPSILON) return { ok: false, reason: "exceeds_invoice", open };
  return { ok: true, amount };
}
