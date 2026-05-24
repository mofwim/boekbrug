// src/app/api/onboarding/route.ts
// [BOEK-015] Save onboarding progress + company data
// Body: step, done, role, company_name, kvk_number, btw_number, iban, address

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Database } from "@/types/database.types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
// [BOEK-015] fix: DB CHECK constraint = 'zzper' | 'accountant' | 'client'
// UI sends 'zzp' → must map to 'zzper' before saving
type UserRole = "zzper" | "accountant" | "client";
const ROLE_MAP: Record<string, UserRole> = {
  zzp: "zzper",
  accountant: "accountant",
};

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json();
const patch: ProfileUpdate = {};
  // Progress fields
  if (typeof body.step === "number") patch.onboarding_step = body.step;
  if (typeof body.done === "boolean") patch.onboarding_done = body.done;

  // [BOEK-015] fix: map 'zzp' → 'zzper' to match DB CHECK constraint
if (typeof body.role === "string" && ROLE_MAP[body.role]) {
  patch.role = ROLE_MAP[body.role];  // ← هذا type: string عام
}

  // [BOEK-015] fix: only include fields with real values — no nulls to DB
  if (typeof body.company_name === "string" && body.company_name.trim()) {
    patch.company_name = body.company_name.trim();
  }
  if (typeof body.kvk_number === "string" && body.kvk_number.trim()) {
    patch.kvk_number = body.kvk_number.trim();
  }
  if (typeof body.btw_number === "string" && body.btw_number.trim()) {
    patch.btw_number = body.btw_number.trim();
  }
  if (typeof body.iban === "string" && body.iban.trim()) {
    patch.iban = body.iban.trim();
  }
  if (typeof body.address === "string" && body.address.trim()) {
    patch.address = body.address.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Geen geldige velden" }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);

  if (error) {
    console.error("[BOEK-015] profiles update failed:", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      patch,
    });
    return NextResponse.json(
      { error: error.message, details: error.details, hint: error.hint },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}