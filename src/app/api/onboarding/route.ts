// src/app/api/onboarding/route.ts
// [BOEK-015] Save onboarding progress + company data
// Body: step, done, role, company_name, kvk_number, btw_number, iban, address

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};

  // Progress
  if (typeof body.step === "number") patch.onboarding_step = body.step;
  if (typeof body.done === "boolean") patch.onboarding_done = body.done;
  if (typeof body.role === "string" && ["zzp", "accountant"].includes(body.role)) {
    patch.role = body.role;
  }

  // Company fields — null clears the field
  if ("company_name" in body) patch.company_name = body.company_name ?? null;
  if ("kvk_number" in body) patch.kvk_number = body.kvk_number ?? null;
  if ("btw_number" in body) patch.btw_number = body.btw_number ?? null;
  // [BOEK-015] Added: iban and address from AI extraction
  if ("iban" in body) patch.iban = body.iban ?? null;
  if ("address" in body) patch.address = body.address ?? null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Geen geldige velden" }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}