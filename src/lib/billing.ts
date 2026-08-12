// ─────────────────────────────────────────────────────────
// src/lib/billing.ts
// [BILLING] — Stripe boundary. Import from here only.
// Do not construct a Stripe client anywhere else in the app.
//
// Same discipline as src/lib/ai.ts is to Claude: one module owns the vendor,
// one place to change a key, a price or an API version.
//
// Usage:
//   /api/billing/checkout  → getStripe, resolveCustomerId, createCheckoutSession
//   /api/billing/portal    → getStripe, createPortalSession
//   /api/billing/webhook   → getStripe, constructWebhookEvent
//
// The DECISION about who may use the app is NOT here — that is the pure,
// vendor-free src/lib/subscription.ts. This file only talks to Stripe.
// ─────────────────────────────────────────────────────────
//
// Rule: Stripe is the source of truth for money. Our database is a cache of
// what Stripe told us, written by the webhook and by nothing else.
// ─────────────────────────────────────────────────────────

import Stripe from "stripe";

// ── Configuration ────────────────────────────────────────────────────
//
// [MODEL-CONFIG lesson, applied to billing] ai.ts records what a hard-coded
// vendor identifier once cost this app: an unverified model id shipped, every
// invoice classification 404'd, and only a redeploy could undo it. The same
// trap exists here — a price id is per-account and differs between test and
// live mode — so the price is ENV-CONFIGURED with no code-level fallback. Swap
// test↔live, or correct a wrong price, by changing an environment variable.

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
// Stripe Tax on both checkout flows. Raw value; automaticTaxParams() decides,
// and only the exact string "true" turns it on (the RETENTION_PURGE_ENABLED
// convention: a deliberate human switch, not a truthiness accident).
const STRIPE_AUTOMATIC_TAX = (process.env.STRIPE_AUTOMATIC_TAX || "").trim();
// Twee prijzen, want wij verkopen twee dingen:
//   • Plus — het maandabonnement voor wie structureel boven het eerlijk gebruik uitkomt;
//   • Bewaarkluis — het archief dat DOORLOOPT nadat iemand is gestopt (de fiscale
//     bewaarplicht van 7 jaar overleeft de klantrelatie; zie src/lib/bewaarkluis.ts).
// Beide zijn per Stripe-account én per modus verschillend, dus beide staan in de omgeving
// zonder fallback in code.
const STRIPE_PRICE_ID_PLUS = (process.env.STRIPE_PRICE_ID_PLUS || "").trim();
/** Prijs van ÉÉN bewaarjaar. Het aantal jaren gaat als `quantity` mee. */
const STRIPE_PRICE_ID_KLUIS_YEAR = (process.env.STRIPE_PRICE_ID_KLUIS_YEAR || "").trim();

// Er is hier bewust GEEN "dark switch" (BILLING_ENFORCED). Op de billing-tak schakelde die
// een betaalmuur aan of uit; wij hebben geen betaalmuur, dus er is niets om donker te
// verschepen. Ontbreken de Stripe-sleutels, dan is de uitkomst simpelweg dat de knop
// "Plus nemen" een nette 503 geeft en de rest van de app volledig blijft werken — wat zij
// sowieso doet, want gratis is hier het volwaardige plan.

/**
 * Is Stripe usable at all? Routes call this FIRST and answer with a clean 503
 * rather than throwing, so a missing key is a disabled checkout button — never
 * a 500 in the user's face.
 */
export function isBillingConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_PRICE_ID_PLUS !== "";
}

/** Kan de Bewaarkluis worden afgerekend? Los van Plus: de een kan leven zonder de ander. */
export function isKluisBillingConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_PRICE_ID_KLUIS_YEAR !== "";
}

/** Is the webhook usable? Without the signing secret we must reject events. */
export function isWebhookConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_WEBHOOK_SECRET !== "";
}

// ── Plan display constants ───────────────────────────────────────────
// Live in the PURE src/lib/plan.ts (no Stripe import) because client components
// and the public homepage need them. Re-exported here so server-side callers can
// still get everything billing-related from one import.
export { PLUS, KLUIS, OFFER_NL, OFFER_SHORT_NL } from "@/lib/plan";

// ── Client ───────────────────────────────────────────────────────────

let cached: Stripe | null = null;

/**
 * The one Stripe client. Lazy so that merely importing this module never
 * throws — a route can check isBillingConfigured() and bail politely.
 *
 * The API version is pinned to whatever the installed SDK was built against
 * (apiVersion omitted). Pinning a literal here would silently diverge from the
 * SDK's types on the next upgrade, which is the billing equivalent of the
 * hard-coded-model bug this file's header warns about.
 *
 * That policy means an SDK bump IS an API bump — so treat it as its own change
 * with its own gate run, and re-read subscriptionPeriodEnd() below when you do.
 */
export function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("[BILLING] Missing STRIPE_SECRET_KEY");
  }
  if (!cached) {
    cached = new Stripe(STRIPE_SECRET_KEY, {
      // Identifies BoekBrug in Stripe's logs — makes support tickets tractable.
      appInfo: { name: "BoekBrug", url: "https://boekbrug.nl" },
      // The app runs on Vercel's Node runtime; retry a failed network call once
      // so a blip does not surface as a broken checkout button.
      maxNetworkRetries: 1,
    });
  }
  return cached;
}

// ── Customers ────────────────────────────────────────────────────────

/**
 * Return the Stripe customer id for this profile, creating the customer on
 * first use.
 *
 * `existingId` is what our database already knows. When it is present we trust
 * it and do NOT call Stripe — the webhook keeps it accurate, and a lookup per
 * checkout is latency we do not need.
 *
 * The profile id is written into customer metadata so that a webhook holding
 * only a Stripe object can always find its way back to a BoekBrug user, even
 * if the stripe_customer_id column were somehow lost.
 */
export async function resolveCustomerId(params: {
  existingId: string | null;
  profileId: string;
  email: string | null;
  name: string | null;
}): Promise<string> {
  if (params.existingId) return params.existingId;

  const customer = await getStripe().customers.create({
    email: params.email ?? undefined,
    name: params.name ?? undefined,
    metadata: { profile_id: params.profileId },
  });
  return customer.id;
}

// ── Checkout ─────────────────────────────────────────────────────────

// ── Checkout flow labels ─────────────────────────────────────────────
//
// Stripe groups sessions by `integration_identifier` in the Dashboard, so the
// two flows can be compared to each other instead of averaged together — a
// monthly subscription and a one-off archive purchase have nothing in common
// but the account they run in.
//
// ⚠️ THESE STRINGS MUST NOT CHANGE. Editing one does not rename anything; it
// starts a THIRD series and orphans the history under the old label. The random
// suffix is Stripe's convention (it keeps labels distinct across accounts), and
// it was rolled once, here, on purpose — do not "regenerate" it.
const FLOW_PLUS = "plus-checkout-qmxvhtbd";
const FLOW_KLUIS = "kluis-checkout-rfnwzkpj";

/**
 * The Stripe Tax part of a Checkout Session, as a spreadable object.
 *
 * Behind an env switch (STRIPE_AUTOMATIC_TAX=true) and NOT unconditional,
 * because turning it on has a hard prerequisite in the Stripe account itself,
 * per environment (sandbox and live each have their own Tax settings and
 * registrations):
 *
 *   1. Without a head office address (Dashboard → Tax → Settings), Stripe
 *      REJECTS every session that asks for automatic tax — the checkout button
 *      would be broken for every customer. Missing configuration has to read
 *      as "feature off", never as a broken button; that rule is this module's
 *      oldest (see isBillingConfigured).
 *   2. With the address set but NO active NL registration (Dashboard → Tax →
 *      Locations), Stripe silently calculates € 0 tax — no error, charged
 *      amount unchanged (prices are btw-inclusive), and the invoice still
 *      misses the btw line this feature exists to add. Flip the switch only
 *      after BOTH dashboard steps; the order is spelled out in
 *      docs/BILLING.md §3.4.
 *
 * Pure — the truth table lives in billing.test.ts.
 */
export function automaticTaxParams(
  flagValue: string | null | undefined
): { automatic_tax?: { enabled: boolean } } {
  return (flagValue || "").trim() === "true" ? { automatic_tax: { enabled: true } } : {};
}

/**
 * A hosted Checkout session for BoekBrug Plus.
 *
 * Hosted (not embedded Elements) on purpose: Stripe then owns the card form,
 * SCA/3-D Secure, iDEAL's bank redirect and PCI scope. For a first paying
 * customer that is the whole point — no card data ever touches BoekBrug.
 */
export async function createCheckoutSession(params: {
  customerId: string;
  profileId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  if (!STRIPE_PRICE_ID_PLUS) {
    throw new Error("[BILLING] Missing STRIPE_PRICE_ID_PLUS");
  }

  return getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: params.customerId,
    line_items: [{ price: STRIPE_PRICE_ID_PLUS, quantity: 1 }],
    integration_identifier: FLOW_PLUS,
    // NO payment_method_types HERE — and that omission is the feature.
    //
    // This used to pin ["ideal", "card"]. iDEAL was the right instinct (the
    // Dutch pay with it, and card-only loses customers at the last click), but
    // pinning the list also froze it: Apple Pay, Google Pay and Link could only
    // be added by a deploy, and Stripe cannot re-rank per customer. Omitting the
    // parameter turns on dynamic payment methods — Stripe picks and orders the
    // eligible methods per customer, from Dashboard -> Settings -> Payment
    // methods, which is where that choice belongs. iDEAL keeps its place for
    // Dutch customers; it is simply enabled there rather than compiled in.
    //
    // To exclude a method, use excluded_payment_method_types or a payment method
    // configuration — never this parameter (Stripe's own guidance; the sole
    // exception is Terminal, which BoekBrug does not use).
    //
    // Load-bearing consequence: the Dashboard can now enable a
    // delayed-notification method (SEPA direct debit, bank transfer) with no
    // deploy, and those complete a Checkout Session BEFORE the money confirms.
    // The webhook already refuses to act on an unpaid session and waits for the
    // async verdict (kluisSessionAction). Do not remove that guard.
    // Legally required in NL: the customer must be able to reach the terms
    // before paying, and we must be able to prove they accepted them.
    consent_collection: { terms_of_service: "required" },
    // A subscription is a distance contract — collect a billing address so the
    // BTW invoice Stripe issues is a valid one.
    billing_address_collection: "required",
    // Business customers can put their BTW number on the invoice.
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    // Stripe Tax, behind its env switch (see automaticTaxParams). In
    // subscription mode this carries over to the created subscription, so the
    // renewal invoices get their btw line too — the address saved by
    // customer_update above is what those renewals are taxed against.
    ...automaticTaxParams(STRIPE_AUTOMATIC_TAX),
    // The webhook reads this to find the profile without trusting any URL.
    subscription_data: { metadata: { profile_id: params.profileId } },
    metadata: { profile_id: params.profileId },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    locale: "nl",
  });
}

// ── Billing portal ───────────────────────────────────────────────────

/**
 * Stripe's hosted portal: update the card, download BTW invoices, cancel.
 *
 * Cancelling must be exactly this easy. A self-serve cancel costs one customer;
 * a cancel-by-emailing-support costs the trust of everyone who hears about it —
 * and under EU consumer law it is not optional anyway.
 */
export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  return getStripe().billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
    locale: "nl",
  });
}

// ── Webhook ──────────────────────────────────────────────────────────

/**
 * Verify a webhook's signature and return the typed event.
 *
 * MUST be handed the RAW request body. Any parse-then-re-stringify in between
 * changes bytes (key order, whitespace, unicode escapes) and the signature will
 * not verify — the classic Stripe integration bug.
 *
 * Throws when the signature is absent, malformed, or outside the tolerance
 * window. Callers answer 400 and MUST NOT act on an unverified payload: this
 * endpoint is public, so without this check anyone on the internet could POST
 * "subscription.active" and help themselves to a free plan.
 */
export function constructWebhookEvent(rawBody: string, signature: string | null): Stripe.Event {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("[BILLING] Missing STRIPE_WEBHOOK_SECRET");
  }
  if (!signature) {
    throw new Error("[BILLING] Missing stripe-signature header");
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

/** Epoch seconds (Stripe's unit) → ISO string for Postgres, null-safe. */
export function epochToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Minimal structural shape of a subscription's period data. Declared instead of
 * requiring a full Stripe.Subscription so this stays unit-testable with a plain
 * object literal — Stripe.Subscription satisfies it structurally.
 */
type PeriodBearingSubscription = {
  items?: { data?: Array<{ current_period_end?: number | null }> } | null;
};

/**
 * End of the currently-paid period, as ISO — the value `current_period_end` on
 * profiles caches.
 *
 * ⚠️ READ THIS BEFORE "SIMPLIFYING" IT TO `sub.current_period_end`.
 * Every Stripe tutorial written before 2026 reads that field off the
 * subscription. On the API version this SDK ships with (2026-07-29.dahlia) it
 * DOES NOT EXIST there any more — it lives on each subscription ITEM. Reading
 * the old path yields `undefined`, which would silently store NULL, which the
 * access decision reads as "no paid period", which would cut off paying
 * customers the moment their subscription is cancelled-but-still-running. The
 * failure is invisible until it hits a real customer, so it is pinned here with
 * this comment and a test.
 *
 * Takes the LATEST end across items: a multi-item subscription is paid for
 * until its last item's period closes, and access must not end before that.
 */
export function subscriptionPeriodEnd(sub: PeriodBearingSubscription): string | null {
  const ends = (sub.items?.data ?? [])
    .map((item) => item?.current_period_end)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  if (ends.length === 0) return null;
  return epochToIso(Math.max(...ends));
}

// ── Bewaarkluis ──────────────────────────────────────────────────────

/** What the webhook should do with a Bewaarkluis Checkout Session event. */
export type KluisSessionAction = "record" | "wait" | "abandon";

/**
 * Decide whether a Bewaarkluis session event may be recorded.
 *
 * A Checkout Session can complete BEFORE the money is confirmed: with a
 * delayed-notification payment method (SEPA-incasso, bank transfer) the
 * `checkout.session.completed` event arrives with `payment_status: "unpaid"`,
 * and the verdict follows later as `async_payment_succeeded` or
 * `async_payment_failed`. Recording the purchase on an unpaid completion would
 * promise seven years of storage for money that may never arrive — the exact
 * mirror of the bug the [KLUIS] webhook block exists to prevent (money taken,
 * obligation recorded nowhere).
 *
 * Today's hardcoded methods (iDEAL, card) confirm synchronously, so "wait" and
 * "abandon" are currently unreachable. They become reachable the moment the
 * method list changes — which Dashboard-managed dynamic payment methods can do
 * without a deploy (docs/BILLING.md §4.3). This guard exists so that day is a
 * non-event.
 *
 * Pure on purpose: the truth table lives in billing.test.ts next to the other
 * webhook-shape pins.
 *
 *   - "record"  → write the kluis_subscriptions row (idempotent via the unique
 *                 index on stripe_session_id, so paid-completed followed by
 *                 async_payment_succeeded records exactly once).
 *   - "wait"    → acknowledge and do nothing; the async verdict event decides.
 *   - "abandon" → the bank said no. Record nothing; Stripe already told the
 *                 customer.
 *
 * `no_payment_required` counts as record: Stripe's fulfillment contract treats
 * it as settled (nothing is owed), and refusing it would strand a session that
 * will never produce another event.
 */
export function kluisSessionAction(
  eventType: string,
  paymentStatus: string | null | undefined
): KluisSessionAction {
  if (eventType === "checkout.session.async_payment_failed") return "abandon";
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") return "record";
  return "wait";
}

/**
 * Een eenmalige betaling voor de resterende bewaarjaren van één archief.
 *
 * `mode: "payment"` en niet `"subscription"`, en dat is de kern van het product en niet een
 * implementatiedetail. Wie stopt met zijn zaak gaat geen nieuwe doorlopende incasso
 * aanmaken voor een bedrijf dat hij net verlaat; hij wil het één keer regelen en er vanaf
 * zijn. Belangrijker nog: vooruit betalen is de enige constructie waarin wij nooit opslag
 * beloven die niet betaald is — en dus de enige waarin een belofte van zeven jaar
 * geloofwaardig is uit de mond van een bedrijf dat zelf nog geen zeven jaar bestaat.
 *
 * `years` komt uit kluisQuote() in src/lib/bewaarkluis.ts en is nooit groter dan de
 * bewaarplicht zelf. Nul jaren betekent: de bewaarplicht is voorbij, er valt niets te
 * verkopen — dat weigeren wij hier hard, zodat er nooit geld wordt gevraagd voor lucht.
 */
export async function createKluisCheckoutSession(params: {
  customerId: string;
  profileId: string;
  years: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  if (!STRIPE_PRICE_ID_KLUIS_YEAR) {
    throw new Error("[BILLING] Missing STRIPE_PRICE_ID_KLUIS_YEAR");
  }
  if (!Number.isInteger(params.years) || params.years < 1) {
    throw new Error("[BILLING] kluis checkout needs at least one bewaarjaar");
  }

  return getStripe().checkout.sessions.create({
    mode: "payment",
    customer: params.customerId,
    line_items: [{ price: STRIPE_PRICE_ID_KLUIS_YEAR, quantity: params.years }],
    integration_identifier: FLOW_KLUIS,
    // Omitted on purpose — dynamic payment methods, exactly as in
    // createCheckoutSession() above; the reasoning is written out there.
    consent_collection: { terms_of_service: "required" },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    // Same shape as the Plus session, and load-bearing for tax: with
    // automatic_tax on, "auto" makes Stripe tax the address entered at THIS
    // checkout instead of a stale saved one, and saves it on the customer —
    // which is also the address later Plus renewal invoices are taxed against.
    customer_update: { address: "auto", name: "auto" },
    // Stripe Tax, behind its env switch (see automaticTaxParams).
    ...automaticTaxParams(STRIPE_AUTOMATIC_TAX),
    // Stripe stuurt bij een eenmalige betaling geen factuur tenzij je erom vraagt. Voor een
    // zakelijke klant die btw terugvraagt is die factuur het halve product.
    invoice_creation: { enabled: true },
    metadata: { profile_id: params.profileId, product: "bewaarkluis", years: String(params.years) },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    locale: "nl",
  });
}
