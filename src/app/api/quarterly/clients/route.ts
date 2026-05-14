// app/api/quarterly/clients/route.ts
// Returns list of clients for accountant (BOEK-013)

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const { data, error } = await supabase
    .from("accountant_clients")
    .select("zzper_id, profiles:zzper_id(id, full_name, company_name)")
    .eq("accountant_id", user.id);

  if (error) return NextResponse.json([], { status: 500 });

  const clients = (data ?? []).map((row: any) => row.profiles).filter(Boolean);
  return NextResponse.json(clients);
}