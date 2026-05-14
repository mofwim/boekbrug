// app/api/search/route.ts
// Full-text search API (BOEK-012)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { searchAll, type SearchTarget } from "@/lib/search";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";
  const target = (req.nextUrl.searchParams.get("target") ?? "all") as SearchTarget;

  if (query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Get role from profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role === "accountant" ? "accountant" : "zzper";

  const results = await searchAll(user.id, query, target, 8, role);
  return NextResponse.json({ results });
}