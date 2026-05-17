// src/app/api/bestanden/trash/route.ts
// [BOEK-033] Prullenbak API — list trashed, restore

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/bestanden/trash
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_url, file_size, file_type, doc_type, created_at, folder_id, trashed, trashed_at, starred")
    .eq("user_id", user.id)
    .eq("trashed", true)
    .order("trashed_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// PATCH /api/bestanden/trash?id=<docId>
// Body: { restore: true }
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as { restore?: boolean };
  if (!body.restore) return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });

  const { error } = await supabase
    .from("documents")
    .update({ trashed: false, trashed_at: null })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}