// src/app/api/billing/webhook/route.ts
// [BILLING] Stripe webhook — the ONLY writer of subscription state.
//
// Money is decided by Stripe. This endpoint is how Stripe tells us, and our
// profiles row is a cache of what it said. No other code path in the app may
// write subscription_status / subscription_plan / stripe_customer_id /
// current_period_end — the prevent_billing_self_grant trigger enforces that at
// the database, and this route is the one caller allowed through it (it runs on
// the service-role client, where auth.uid() is NULL).
//
// SECURITY: this endpoint is PUBLIC — Stripe calls it with no session and no
// bearer token. Its only guard is the HMAC signature over the raw body. Without
// that check anyone on the internet could POST `subscription.active` and grant
// themselves a paid plan, so an unverified payload is rejected before a single
// field is read, and is never logged in full.
//
// RAW BODY: the signature covers the exact bytes Stripe sent. `req.text()` is
// used, never `req.json()` — parsing and re-serialising changes key order and
// whitespace and the signature stops verifying. This is the single most common
// way a Stripe integration breaks. The app's middleware runs on /api/* but only
// calls supabase.auth.getUser() (cookies only) and returns early, so it never
// touches this body.
//
// ORDERING: webhooks arrive out of order and are re-delivered on our 5xx. So
// every handler RE-READS the subscription from Stripe and writes that, rather
// than trusting the (possibly stale) object inside the event. A late-arriving
// old event therefore rewrites the same current truth instead of regressing it,
// which makes the endpoint naturally idempotent without an events table.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  constructWebhookEvent,
  isWebhookConfigured,
  subscriptionPeriodEnd,
} from "@/lib/billing";
import { normalizeStripeStatus } from "@/lib/subscription";
import { createPipelineClient } from "@/lib/supabase-pipeline";

// Stripe's signature verification needs Node crypto and the raw body.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events we act on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: NextRequest) {
  // Not configured (no keys yet) → tell Stripe we are not ready. 503 makes
  // Stripe retry later rather than marking the event permanently failed.
  if (!isWebhookConfigured()) {
    console.error("[BILLING] webhook hit but STRIPE_WEBHOOK_SECRET/SECRET_KEY missing");
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    // Never log the body — an unverified payload is attacker-controlled.
    console.error(
      "[BILLING] webhook signature verification failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // 200 so Stripe stops retrying an event we deliberately ignore.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // 500 → Stripe retries with backoff. Better a retry than a customer who
    // paid and whose account never reflects it.
    console.error(`[BILLING] webhook handler failed (${event.type}):`, err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();

  // ── Resolve the subscription id this event is about ────────────────
  let subscriptionId: string | null = null;
  let sessionProfileId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;
    sessionProfileId = session.metadata?.profile_id ?? null;
  } else {
    const sub = event.data.object as Stripe.Subscription;
    subscriptionId = sub.id;
  }

  if (!subscriptionId) {
    console.warn(`[BILLING] ${event.type} carried no subscription id — ignored`);
    return;
  }

  // ── Re-read current truth from Stripe (see ORDERING in the header) ──
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // ── Find the BoekBrug profile this belongs to ──────────────────────
  // Three independent routes to the same answer, cheapest first. Money events
  // must not be dropped because one link went missing.
  const profileId =
    sub.metadata?.profile_id ??
    sessionProfileId ??
    (await profileIdFromCustomer(stripe, customerId)) ??
    (await profileIdFromDatabase(customerId));

  if (!profileId) {
    // Loud: a real payment we cannot attribute needs a human, now.
    console.error(
      `[BILLING] UNATTRIBUTED subscription ${sub.id} (customer ${customerId}) — no profile_id found`
    );
    return;
  }

  const status = normalizeStripeStatus(sub.status);

  // Plan mirrors status: only a live subscription is 'pro'. A lapsed customer
  // falls back to 'free' so the two columns can never disagree about whether
  // this account is paying.
  const plan = status === "active" || status === "trialing" || status === "past_due" ? "pro" : "free";

  const patch = {
    subscription_status: status,
    subscription_plan: plan,
    subscription_stripe_id: sub.id,
    stripe_customer_id: customerId,
    current_period_end: subscriptionPeriodEnd(sub),
  };

  const pipeline = createPipelineClient();
  // The billing columns are added by billing_subscription.sql and are not in
  // the generated types → relaxed client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (pipeline as any).from("profiles").update(patch).eq("id", profileId);

  if (error) {
    // Throw → 500 → Stripe retries. Swallowing this would leave a paying
    // customer looking unpaid with nothing to replay the event.
    throw new Error(`profiles update failed for ${profileId}: ${error.message}`);
  }

  console.log(`[BILLING] ${event.type} → profile ${profileId} is ${status}/${plan}`);
}

/** Read profile_id off the Stripe customer's metadata (set at creation). */
async function profileIdFromCustomer(
  stripe: Stripe,
  customerId: string
): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return customer.metadata?.profile_id ?? null;
  } catch {
    return null;
  }
}

/** Last resort: find the profile we previously linked to this customer. */
async function profileIdFromDatabase(customerId: string): Promise<string | null> {
  try {
    const pipeline = createPipelineClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (pipeline as any)
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
