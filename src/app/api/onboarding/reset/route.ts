// src/app/api/onboarding/reset/route.ts
// [BOEK-015] Reset onboarding — clears all profile fields and uploaded documents
//
// What gets cleared:
//   profiles: role, company_name, kvk_number, btw_number, iban, address → null
//             onboarding_step → 1, onboarding_done → false
//
// What stays:
//   email_connections  → Gmail stays connected (user explicitly connected it)
//   auth.users         → login stays valid
//
// Safety:
//   - Race condition: single atomic DB update
//   - Double-click: client disables button immediately
//   - documents with notes='onboarding' → deleted from DB + Storage

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function DELETE(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  try {
    // [BOEK-015] Step 1: reset profile fields — single atomic update
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        onboarding_step: 1,
        onboarding_done: false,
        role: null,
        company_name: null,
        kvk_number: null,
        btw_number: null,
        iban: null,
        address: null,
      })
      .eq("id", user.id);

    if (profileError) {
      console.error("[BOEK-015] reset profile failed:", profileError.message);
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    // [BOEK-015] Step 2: delete onboarding documents (uploaded during Step 3A)
    // These files were only for AI extraction — not needed after reset
    const serviceSupabase = createServiceRoleClient();

    const { data: docs } = await serviceSupabase
      .from("documents")
      .select("id, file_url")
      .eq("user_id", user.id)
      .ilike("file_name", "onboarding-%");  // files named "onboarding-{timestamp}.ext"

    if (docs && docs.length > 0) {
      // Delete from Storage
      const paths = docs.map((d) => d.file_url).filter(Boolean);
      if (paths.length > 0) {
        await serviceSupabase.storage.from("documents").remove(paths);
      }

      // Delete from DB
      const ids = docs.map((d) => d.id);
      await serviceSupabase.from("documents").delete().in("id", ids);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[BOEK-015] reset failed:", error);
    return NextResponse.json({ error: "Reset mislukt" }, { status: 500 });
  }
}