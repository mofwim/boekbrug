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

  // Verify current user matches state userId
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== stateData.userId) {
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
        user_id: user.id,
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
      user_id: user.id,
      provider: "gmail",
    });
    await supabase.from("email_connections").insert({
      user_id: user.id,
      provider: "gmail",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      email,
      connected_at: new Date().toISOString(),
    });
  }

  // Trigger initial sync in background (fire and forget)
  fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/email/sync`, {
    method: "POST",
    headers: { Cookie: req.headers.get("cookie") || "" },
  }).catch(() => {});

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard/incoming?connected=gmail`
  );
}