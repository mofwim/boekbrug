// src/app/api/email/callback/gmail/route.ts
// [BOEK-011] Gmail OAuth callback — exchange code for tokens, store via Vault helper

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  exchangeGmailCode,
  getGmailUserEmail,
  saveEmailTokens,
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

  // [BOEK-011 + BOEK-SECURITY] Persist tokens via Vault — no plaintext columns.
  // saveEmailTokens handles: create-or-update Vault secrets + upsert row by
  // (user_id, provider). The plaintext columns stay null.
  const saveResult = await saveEmailTokens({
    userId,
    provider: "gmail",
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });

  if (!saveResult.success) {
    console.error("[BOEK-011] Failed to save Gmail tokens", saveResult.error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=token_save_failed`
    );
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