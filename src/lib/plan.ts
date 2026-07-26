// src/lib/plan.ts
// [BILLING] The plan's DISPLAY facts â pure strings, no Stripe, no I/O.
//
// Separate from billing.ts on purpose, and for the same reason isBillingEnforced
// lives in subscription.ts: these strings are needed by CLIENT components (the
// signup form) and by the public homepage, and billing.ts does
// `import Stripe from "stripe"`. Importing it from a 'use client' file would drag
// the whole Stripe SDK into the browser bundle.
//
// â ï¸ THIS IS THE ONLY PLACE THE PRICE MAY BE WRITTEN.
// It was not, and the drift was not hypothetical â it had already happened:
// billing.ts said â¬ 12,00, /prijzen's <title> and OG description each hard-coded
// "â¬ 12" separately, and the binding terms of service at /voorwaarden published
// Pro at â¬25 and Pro+ at â¬45 while ALSO promising the app was free during the
// launch period. Checkout forces acceptance of those terms
// (consent_collection.terms_of_service), so a customer paying â¬12 was agreeing
// to a contract that said â¬25 â and ambiguity in your own standard terms is
// construed against you.
//
// So: no component, page, metadata string, e-mail or legal document may retype
// this number. Derive from here, or do not state it.

/** The one plan. Dutch consumer convention: BTW included in the sticker price. */
export const PLAN = {
  id: "pro",
  name: "BoekBrug Pro",
  /** Display string, Dutch formatting. The single source of truth. */
  priceLabel: "€ 12,00",
  /** Bare amount, for prose where "€ 12,00 per maand" reads clumsily. */
  priceShort: "€ 12",
  period: "per maand",
  /** Dutch B2C prices are quoted incl. BTW; the Stripe price must match. */
  btwNote: "incl. 21% btw",
  /**
   * 30 days, matching every leader in SMB accounting (QuickBooks/Xero/
   * FreshBooks 30, Jortt 30, MoneyMonk 30, Moneybird 60) and the finding that
   * finance is a category where short trials underperform — people evaluate
   * bookkeeping across several sessions, and a ZZP’er needs a full month to
   * meet the BTW quarter, the bank statement and the accountant hand-off that
   * make this product worth paying for.
   *
   * Must stay in sync with the DEFAULT in
   * supabase/migrations/trial_30_days.sql.
   */
  trialDays: 30,
} as const;

/**
 * The offer, in one sentence, ready to paste anywhere a visitor is asked to
 * commit — the signup page, the homepage, the terms.
 *
 * Exists because "Gratis" appeared ALONE on both acquisition pages while a trial
 * clock started silently at registration (trial_ends_at has a column DEFAULT)
 * and the middleware later redirected the user away from their own bookkeeping.
 * A person who reads "Gratis", signs up, and comes back after the trial has to
 * have been told the clock existed. Everything a buyer needs is in this string:
 * length, price, BTW, no card, no silent charge.
 */
export const PLAN_OFFER_NL =
  `${PLAN.trialDays} dagen gratis proberen — daarna ${PLAN.priceShort} per maand ${PLAN.btwNote}. ` +
  `Geen creditcard nodig, geen automatische afschrijving.`;

/** Short form for a subtitle or a button caption. */
export const PLAN_OFFER_SHORT_NL =
  `${PLAN.trialDays} dagen gratis · daarna ${PLAN.priceShort} p/m · geen creditcard`;
