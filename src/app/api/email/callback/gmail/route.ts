// src/app/api/email/callback/gmail/route.ts
// [BOEK-011] Gmail OAuth callback — exchange code for tokens, store via Vault helper

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  exchangeGmailCode,
  getGmailUserEmail,
  saveEmailTokens,
} from "@/lib/email-integration";
import { verifyOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

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

  // [MH1] Verify the CSRF nonce: the returned state must match the HttpOnly cookie set at
  // /connect, and the authoritative userId comes from that cookie — never from the state
  // param, which is attacker-forgeable. This still survives a lost Supabase session cookie
  // (BOEK-015): the nonce cookie is our own first-party cookie and rides the redirect back.
  const stateCheck = verifyOAuthState(
    state,
    req.cookies.get(OAUTH_STATE_COOKIE)?.value,
    "gmail",
  );
  if (!stateCheck.ok) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=invalid_state`
    );
  }
  const userId = stateCheck.userId;

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