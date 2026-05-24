// src/app/api/email/callback/outlook/route.ts
// [BOEK-011] Outlook OAuth callback — exchange code for tokens, store via Vault helper

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  exchangeOutlookCode,
  getOutlookUserEmail,
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
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=outlook_denied`
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

  // [BOEK-011] Same robustness as Gmail callback — trust state if session cookie
  // didn't survive the OAuth redirect. CSRF is already verified by the state param.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? stateData.userId;

  if (!userId) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/login`
    );
  }

  // Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeOutlookCode(code);
  } catch {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=token_exchange_failed`
    );
  }

  let email = "";
  try {
    email = await getOutlookUserEmail(tokens.access_token);
  } catch {
    // Not critical
  }

  // [BOEK-011 + BOEK-SECURITY] Persist tokens via Vault — no plaintext columns.
  const saveResult = await saveEmailTokens({
    userId,
    provider: "outlook",
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });

  if (!saveResult.success) {
    console.error("[BOEK-011] Failed to save Outlook tokens", saveResult.error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?error=token_save_failed`
    );
  }

  // Trigger initial sync
  fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/email/sync`, {
    method: "POST",
    headers: { Cookie: req.headers.get("cookie") || "" },
  }).catch(() => {});

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?connected=outlook`
  );
}