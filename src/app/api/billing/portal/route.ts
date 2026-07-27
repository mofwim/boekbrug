// src/app/api/billing/portal/route.ts
// [BILLING] Open Stripe's hosted billing portal.
//
// One link that lets the customer change their card, download every BTW
// invoice, and cancel — without emailing anyone. Cancelling has to be exactly
// this easy: under EU consumer law it is not optional, and a subscription that
// is hard to leave is one people warn each other about.
//
// Returns { url } to redirect to. Stripe owns the whole screen; we own nothing
// here except the return address.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { isBillingConfigured, createPortalSession } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  if (!isBillingConfigured()) {
    return NextResponse.json(
      { error: "Betalingen zijn nog niet geconfigureerd." },
      { status: 503 }
    );
  }

  // stripe_customer_id is not in the generated types (billing_subscription.sql)
  // → relaxed client, and wrapped so a not-yet-applied migration reads as
  // "no customer" instead of throwing a 500.
  let customerId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();
    customerId = data?.stripe_customer_id ?? null;
  } catch (err) {
    console.error("[BILLING] portal profile read failed:", err);
  }

  // Never subscribed → there is no portal to open. Point them at the price
  // instead of showing an error they can do nothing about.
  if (!customerId) {
    return NextResponse.json(
      { error: "Je hebt nog geen abonnement.", redirect: "/prijzen" },
      { status: 400 }
    );
  }

  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
    const session = await createPortalSession({
      customerId,
      returnUrl: `${origin}/dashboard/settings/facturering`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[BILLING] portal session failed:", err);
    return NextResponse.json(
      { error: "Kon het abonnementenbeheer niet openen. Probeer het opnieuw." },
      { status: 500 }
    );
  }
}
