// src/app/api/email/confirm/[id]/route.ts
// [BOEK-011] Incoming invoice actions
// POST   → mark as paid (with user-confirmed/edited amounts) → visible to accountant
// DELETE → ignore (archive — recoverable, never hard-deleted)
// PATCH  → restore an ignored invoice back to pending

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// ── POST — mark as paid ───────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // Verify ownership
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, receiver_id, direction, status")
    .eq("id", id)
    .single();

  if (!invoice || invoice.receiver_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  if (invoice.direction !== "incoming") {
    return NextResponse.json(
      { error: "Alleen inkomende facturen kunnen hier bevestigd worden" },
      { status: 400 }
    );
  }

  // [BOEK-011] Accept user-confirmed/edited amounts from the request body
  // The user reviewed Claude's extracted numbers and either confirmed or fixed them
  let body: {
    total_ex_btw?: number;
    btw_amount?: number;
    total_inc_btw?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    // No body — keep amounts already in DB
  }

  const updatePatch: Record<string, unknown> = {
    status: "paid",
    marked_paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Only overwrite amounts if the user actually sent valid numbers
  const validNum = (v: unknown): v is number =>
    typeof v === "number" && isFinite(v) && v >= 0;

  if (validNum(body.total_ex_btw)) updatePatch.total_ex_btw = body.total_ex_btw;
  if (validNum(body.btw_amount)) updatePatch.btw_amount = body.btw_amount;
  if (validNum(body.total_inc_btw)) updatePatch.total_inc_btw = body.total_inc_btw;

  const { error } = await supabase
    .from("invoices")
    .update(updatePatch)
    .eq("id", id)
    .eq("receiver_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // [BOEK-011] Notify the linked accountant — invoice is now visible to them
  const { data: link } = await supabase
    .from("accountant_clients")
    .select("accountant_id")
    .eq("zzper_id", user.id)
    .limit(1)
    .single();

  if (link?.accountant_id) {
    await supabase.from("notifications").insert({
      user_id: link.accountant_id,
      title: "Nieuwe betaalde factuur",
      body: "Een klant heeft een inkomende factuur als betaald gemarkeerd.",
      type: "invoice",
      read: false,
      link: "/dashboard",
    });
  }

  // Notify the user themselves — confirmation
  await supabase.from("notifications").insert({
    user_id: user.id,
    title: "Factuur bevestigd",
    body: "De factuur is gemarkeerd als betaald en doorgezet naar je boekhouder.",
    type: "payment",
    read: false,
  });

  return NextResponse.json({ ok: true });
}

// ── DELETE — ignore (archive) ─────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [BOEK-011] Archive — never hard-delete. Recoverable via PATCH.
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ── PATCH — restore an ignored invoice ────────────────────────────────────────

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [BOEK-011] Restore: archived → received (back to pending queue)
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "received",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "archived");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}