// src/app/api/email/connect/route.ts
// [BOEK-011] Initiate Gmail or Outlook OAuth flow
// GET /api/email/connect?provider=gmail|outlook

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildGmailOAuthUrl, buildOutlookOAuthUrl } from "@/lib/email-integration";

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

  // State = userId — verified in callback to prevent CSRF
  const state = Buffer.from(JSON.stringify({ userId: user.id, provider })).toString("base64");

  const redirectUrl =
    provider === "gmail"
      ? buildGmailOAuthUrl(state)
      : buildOutlookOAuthUrl(state);

  return NextResponse.redirect(redirectUrl);
}