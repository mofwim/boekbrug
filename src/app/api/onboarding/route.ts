// app/api/onboarding/route.ts
// [BOEK-015] Save onboarding progress + company data + language preference
// Body: step, done, role, company_name, kvk_number, btw_number, preferred_language

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// PATCH /api/onboarding
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const body = await req.json();
  const patch: Record<string, unknown> = {};

  // Progress fields
  if (typeof body.step === "number") patch.onboarding_step = body.step;
  if (typeof body.done === "boolean") patch.onboarding_done = body.done;
  if (
    typeof body.role === "string" &&
    ["zzp", "accountant"].includes(body.role)
  ) {
    patch.role = body.role;
  }

  // [BOEK-015] Language preference — saved in Step 1
  if (
    typeof body.preferred_language === "string" &&
    ["nl", "en", "ar", "tr"].includes(body.preferred_language)
  ) {
    patch.preferred_language = body.preferred_language;
  }

  // Company fields (Step 3) — null clears the field
  if ("company_name" in body) patch.company_name = body.company_name ?? null;
  if ("kvk_number" in body) patch.kvk_number = body.kvk_number ?? null;
  if ("btw_number" in body) patch.btw_number = body.btw_number ?? null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Geen geldige velden" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}