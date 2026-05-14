// app/api/onboarding/route.ts
// Save onboarding progress (BOEK-015)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// PATCH /api/onboarding  { step: 2 } or { done: true }
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json();

  const patch: Record<string, unknown> = {};
  if (typeof body.step === "number") patch.onboarding_step = body.step;
  if (typeof body.done === "boolean") patch.onboarding_done = body.done;
  if (typeof body.role === "string" && ["zzp", "accountant"].includes(body.role)) {
    patch.role = body.role;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Geen geldige velden" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}