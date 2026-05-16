// app/api/bestanden/folders-tree/route.ts
// [BOEK-033] Returns flat list of all folders for the current user

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ensureSharedFolder } from "@/lib/bestanden";

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Ensure "Gedeeld met boekhouder" exists
  await ensureSharedFolder(user.id);

  const { data, error } = await supabase
    .from("folders")
    .select("id, user_id, name, parent_id, color, created_at")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}