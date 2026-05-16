// src/app/api/email/sync/route.ts
// [BOEK-011] Trigger email sync for the current user
// POST /api/email/sync
// Returns: { provider, fetched, classified, saved, errors }

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { syncUserEmails } from "@/lib/email-integration";

export async function POST(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const result = await syncUserEmails(user.id);

  if (!result) {
    return NextResponse.json(
      { error: "Geen e-mailverbinding gevonden. Verbind eerst Gmail of Outlook." },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
}

// GET /api/email/sync — check connection status + last sync info
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { data: connection } = await supabase
    .from("email_connections")
    .select("provider, email, connected_at")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  // Count pending incoming invoices
  const { count: pendingCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("sender_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received");

  return NextResponse.json({
    connected: !!connection,
    provider: connection?.provider || null,
    email: connection?.email || null,
    connected_at: connection?.connected_at || null,
    pending_count: pendingCount || 0,
  });
}

// DELETE /api/email/sync — disconnect email
export async function DELETE(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { error } = await supabase
    .from("email_connections")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}