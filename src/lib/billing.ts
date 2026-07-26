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
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || "").trim();

// The dark switch (isBillingEnforced) deliberately lives in the pure
// src/lib/subscription.ts, NOT here: the middleware needs it, the middleware
// runs on the Edge runtime, and importing this module there would drag the
// whole Stripe SDK into the edge bundle. Re-exported for convenience so
// server-side callers can still get everything billing-related from one import.
export { isBillingEnforced } from "@/lib/subscription";

/**
 * Is Stripe usable at all? Routes call this FIRST and answer with a clean 503
 * rather than throwing, so a missing key is a disabled checkout button — never
 * a 500 in the user's face.
 */
export function isBillingConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_PRICE_ID !== "";
}

/** Is the webhook usable? Without the signing secret we must reject events. */
export function isWebhookConfigured(): boolean {
  return STRIPE_SECRET_KEY !== "" && STRIPE_WEBHOOK_SECRET !== "";
}

// ── Plan display constants ───────────────────────────────────────────
// Live in the PURE src/lib/plan.ts (no Stripe import) because client components
// and the public homepage need them. Re-exported here so server-side callers can
// still get everything billing-related from one import.
export { PLAN, PLAN_OFFER_NL, PLAN_OFFER_SHORT_NL } from "@/lib/plan";

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

/**
 * A hosted Checkout session for the single Pro plan.
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
  if (!STRIPE_PRICE_ID) {
    throw new Error("[BILLING] Missing STRIPE_PRICE_ID");
  }

  return getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: params.customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    // NL market: iDEAL is how the Dutch actually pay. Offering card only would
    // lose real customers at the last click. SEPA direct debit follows later —
    // it needs a mandate flow we deliberately keep out of v1.
    payment_method_types: ["ideal", "card"],
    // Legally required in NL: the customer must be able to reach the terms
    // before paying, and we must be able to prove they accepted them.
    consent_collection: { terms_of_service: "required" },
    // A subscription is a distance contract — collect a billing address so the
    // BTW invoice Stripe issues is a valid one.
    billing_address_collection: "required",
    // Business customers can put their BTW number on the invoice.
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
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
 * subscription. On the API version this SDK ships with (2026-06-24.dahlia) it
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
