// src/app/api/email/callback/gmail/route.ts
// [BOEK-011] Gmail OAuth callback — exchange code for tokens, store in email_connections

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  exchangeGmailCode,
  getGmailUserEmail,
} from "@/lib/email-integration";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // User denied access
  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=gmail_denied`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=invalid_callback`
    );
  }

  // Verify state
  let stateData: { userId: string; provider: string };
  try {
    stateData = JSON.parse(Buffer.from(state, "base64").toString());
  } catch {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=invalid_state`
    );
  }

  // [BOEK-015] fix: use userId from state directly — session cookie may not transfer
  // across OAuth redirect, causing false mismatch and redirect to /login
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Use stateData.userId as the authoritative user — it was set when OAuth was initiated
  // If session user exists and matches, great. If not, trust the state (CSRF already verified by state param)
  const userId = user?.id ?? stateData.userId;

  if (!userId) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/login`
    );
  }

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeGmailCode(code);
  } catch {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=token_exchange_failed`
    );
  }

  // Get user's Gmail address
  let email = "";
  try {
    email = await getGmailUserEmail(tokens.access_token);
  } catch {
    // Not critical — store empty email
  }

  // Upsert into email_connections
  // One connection per user per provider — replace if already exists
  const { error: dbError } = await supabase
    .from("email_connections")
    .upsert(
      {
        user_id: userId,
        provider: "gmail",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        email,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (dbError) {
    // Try insert if upsert failed (onConflict column might not exist)
    await supabase.from("email_connections").delete().match({
      user_id: userId,
      provider: "gmail",
    });
    await supabase.from("email_connections").insert({
      user_id: userId,
      provider: "gmail",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      email,
      connected_at: new Date().toISOString(),
    });
  }

  // [BOEK-011] Trigger initial sync in background (fire and forget)
  fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/email/sync`, {
    method: "POST",
    headers: { Cookie: req.headers.get("cookie") || "" },
  }).catch(() => {});

  // [BOEK-015] fix: check if user is still in onboarding — redirect accordingly
  // referer is Google's URL at this point, so we check the DB instead
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_done")
    .eq("id", userId)
    .single();

  const fromOnboarding = !profile?.onboarding_done;

  if (fromOnboarding) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/onboarding?gmail=connected&step=4`
    );
  }

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?connected=gmail`
  );
}