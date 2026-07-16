// src/app/api/email/connect/route.ts
// [BOEK-011] Initiate Gmail or Outlook OAuth flow
// GET /api/email/connect?provider=gmail|outlook

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildGmailOAuthUrl, buildOutlookOAuthUrl } from "@/lib/email-integration";
import { makeOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const provider = req.nextUrl.searchParams.get("provider");

  if (provider !== "gmail" && provider !== "outlook") {
    return NextResponse.json(
      { error: "Provider moet gmail of outlook zijn" },
      { status: 400 }
    );
  }

  // [MH1] CSRF-safe state: a random nonce goes in the `state` param AND in an HttpOnly
  // cookie that also carries the initiating userId. The callback trusts the cookie's
  // userId only when its nonce matches the returned state — a forged state has no cookie.
  const { state, cookieValue } = makeOAuthState(user.id, provider);

  const redirectUrl =
    provider === "gmail"
      ? buildGmailOAuthUrl(state)
      : buildOutlookOAuthUrl(state);

  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // survives the top-level redirect back from the provider
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return res;
}