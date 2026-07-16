// src/app/api/email/callback/outlook/route.ts
// [BOEK-011] Outlook OAuth callback — exchange code for tokens, store via Vault helper

import { NextRequest, NextResponse } from "next/server";
import {
  exchangeOutlookCode,
  getOutlookUserEmail,
  saveEmailTokens,
} from "@/lib/email-integration";
import { verifyOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
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

  // [MH1] Verify the CSRF nonce against the HttpOnly cookie set at /connect; the
  // authoritative userId comes from the cookie, never from the forgeable state param.
  const stateCheck = verifyOAuthState(
    state,
    req.cookies.get(OAUTH_STATE_COOKIE)?.value,
    "outlook",
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
    tokens = await exchangeOutlookCode(code);
  } catch (err) {
    // [BOEK-011 TEMP-LOG] Was an empty catch — the real error never surfaced.
    // Log it so we can see Microsoft's rejection. Remove after confirmation.
    console.error("[BOEK-011 TEMP] Outlook exchange threw in callback:", err);
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