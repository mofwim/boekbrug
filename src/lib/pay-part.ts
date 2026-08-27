// src/lib/pay-part.ts
// [DEEL-BETALEN] Paying one supplier invoice in instalments — the decision, not the screen. Pure.
//
// ── THE REQUEST ──
//
// Reported on Enka Horeca B.V., € 3.819,82: "I want to pay this invoice, but only part of it for
// now — maybe in two or three goes." The pay sheet could not do it. It computed ONE figure, the
// full remaining balance, and put that in the QR, in the copy rows and in the transfer. An owner
// who wanted to send € 1.500 had to leave the app, type the details into their bank by hand, and
// hope they copied the kenmerk correctly — which is exactly the moment a payment becomes
// unallocatable.
//
// ── WHY THIS IS A MODULE AND NOT A FIELD ON THE SHEET ──
//
// It decides what goes in a QR that moves real money out of a real bank account, so it is a rule
// and rules live where a test can reach them. There are two payment sheets and more will follow;
// a rule typed into one of them is a rule the next one does not have.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──
//
// It writes nothing and it remembers nothing. What has actually been settled on an invoice stays
// what it has always been — the sum of the bank lines applied to it (amount_paid, maintained by
// recompute_invoice_amount_paid). Recording "the owner said they would pay € 1.500" as a second
// kind of paid amount would give this app two answers to the only question that matters, and the
// screens already have one. So this module answers a narrower question, which is the one actually
// being asked: WHAT AMOUNT GOES IN THIS QR, and what is left over after it lands.
//
// The ceiling is the outstanding balance and that is not tidiness. Money sent to a supplier comes
// back only if they choose to send it back; over-paying is the one direction the owner cannot undo
// alone. The same worry is already written into the sheet's own comment about a € 600 over-payment.

import { round2 } from "./invoice-totals";
import { CENT_EPSILON, openAmount, type PartialPayInvoice } from "./partial-payment";
import { parseAmountInput } from "./partial-payment";

export interface PartPayPlan {
  /** What the QR, the copy row and the transfer must carry. Always > 0, always ≤ openstaand. */
  amount: number;
  /** What is still owed after this payment lands. 0 when it settles the invoice. */
  remaining: number;
  /** Does this one payment finish the invoice? Then the sheet says nothing about a remainder. */
  settlesAll: boolean;
}

export type PartPayDecision =
  /** Dutch and owner-facing: a refusal that does not say WHY sends someone back to their bank app. */
  | { ok: false; error: string }
  | { ok: true; plan: PartPayPlan };

/** The full balance the sheet starts from, and the ceiling every part-payment is measured against. */
export function payableOpenAmount(invoice: PartialPayInvoice): number {
  return openAmount(invoice);
}

/**
 * What the owner typed, turned into a payment — or the reason it cannot be one.
 *
 * `typed` is the raw field content, not a number: the reading of a Dutch amount belongs to
 * parseAmountInput, which already knows that "1.500", "1500,00" and "1.500,50" are three different
 * things and that "1.2.3" is none of them.
 */
export function planPartPayment(invoice: PartialPayInvoice, typed: string | null | undefined): PartPayDecision {
  const open = payableOpenAmount(invoice);

  // A creditnota is money coming BACK, so there is no instalment to send and no QR that could
  // carry one — EPC refuses a negative amount outright.
  //
  // Asked on the SIGN, not on the balance, and a test is why: openAmount is deliberately a
  // MAGNITUDE (partial-payment.ts abs()'s the total, exactly as the database functions do), so a
  // creditnota of € 250 reports € 250 outstanding rather than nothing. Reading that as "there is
  // something to pay" would have offered the owner a QR to send money on a document that exists
  // to bring money back.
  if ((invoice.total_inc_btw ?? 0) < 0) {
    return { ok: false, error: "Dit is een creditnota — daar staat geld van jou op, dat betaal je niet." };
  }

  // Nothing left to pay: settled, or an invoice of nothing.
  if (open <= CENT_EPSILON) {
    return { ok: false, error: "Op deze factuur staat niets meer open." };
  }

  const raw = String(typed ?? "").trim();
  if (!raw) {
    return { ok: false, error: "Vul in hoeveel je nu wilt betalen." };
  }

  const value = parseAmountInput(raw);
  if (value === null) {
    return { ok: false, error: "Dit is geen bedrag. Schrijf het zoals op de factuur, bijvoorbeeld 1.500,00." };
  }

  const amount = round2(value);
  if (amount <= CENT_EPSILON) {
    return { ok: false, error: "Vul een bedrag boven € 0,00 in." };
  }

  // The ceiling, with the consequence named. "Te hoog" alone reads as a form being difficult; the
  // owner needs to know that this is the one mistake their own bank cannot undo for them.
  if (amount > open + CENT_EPSILON) {
    return {
      ok: false,
      error:
        `Er staat nog € ${open.toFixed(2).replace(".", ",")} open. Meer overmaken kun je niet ` +
        `terugdraaien — dat geld moet je bij de leverancier terugvragen. Klopt het bedrag op de ` +
        `factuur niet, corrigeer dan eerst de factuur.`,
    };
  }

  const remaining = round2(Math.max(0, open - amount));
  return {
    ok: true,
    plan: {
      amount,
      remaining,
      // Within a cent of the whole balance IS the whole balance — otherwise a rounding tick on the
      // last instalment would leave the sheet promising a remainder of € 0,00.
      settlesAll: remaining <= CENT_EPSILON,
    },
  };
}

/** The field's starting value: the full balance, written the way a Dutch owner reads it. */
export function defaultPartPayInput(invoice: PartialPayInvoice): string {
  return payableOpenAmount(invoice).toFixed(2).replace(".", ",");
}
