// src/app/api/email/confirm/[id]/route.ts
// [BOEK-011] Confirm incoming invoice payment or dismiss it
// POST → mark as paid (visible to accountant)
// DELETE → dismiss (archive without processing)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// POST /api/email/confirm/[id] — mark as paid
export async function POST(
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

  // Verify invoice belongs to this user
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, sender_id, status, direction")
    .eq("id", id)
    .single();

  if (!invoice || invoice.sender_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  if (invoice.direction !== "incoming") {
    return NextResponse.json(
      { error: "Alleen inkomende facturen kunnen hier bevestigd worden" },
      { status: 400 }
    );
  }

  // Mark as paid + record when client confirmed
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      marked_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("sender_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Create notification — invoice now visible to accountant
  await supabase.from("notifications").insert({
    user_id: user.id,
    title: "Factuur bevestigd",
    body: "De factuur is gemarkeerd als betaald en doorgezet naar je boekhouder.",
    type: "payment",
    read: false,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/email/confirm/[id] — dismiss / ignore
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

  // Archive the invoice (not delete — legal compliance)
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("sender_id", user.id)
    .eq("direction", "incoming");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}