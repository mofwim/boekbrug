// app/api/quarterly/clients/route.ts
// [BOEK-013] Accountant client list for quarterly selector — May 2026
// GET /api/quarterly/clients
// Returns: list of clients linked to the authenticated accountant

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // Only accountants can call this endpoint
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "accountant") {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  // [BOEK-013] Step 1: get all linked zzper IDs
  const { data: links, error: linksError } = await supabase
    .from("accountant_clients")
    .select("zzper_id")
    .eq("accountant_id", user.id);

  if (linksError) {
    return NextResponse.json({ error: linksError.message }, { status: 500 });
  }

const ids = (links ?? [])
  .map((l) => l.zzper_id)
  .filter((id) => id !== null) as string[];
  if (ids.length === 0) {
    return NextResponse.json([]);
  }

  // [BOEK-013] Step 2: fetch profiles for those IDs
  const { data: clients, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, company_name")
    .in("id", ids)
    .order("company_name", { ascending: true });

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  return NextResponse.json(clients ?? []);
}