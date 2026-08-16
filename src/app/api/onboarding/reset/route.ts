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
// [SEC-STORAGE-PATH] A row check is not a path check — see the header of storage-path.ts.
import { toStoragePath, pathBelongsToOwner } from "@/lib/storage-path";

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
      // [SEC-STORAGE-PATH] These rows are this user's — and file_url is ordinary text on a row
      // they may write, while serviceSupabase bypasses the bucket policy. This call is
      // storage.remove(), so an unattributable key here is not a leak but a DELETION of somebody
      // else's bytes, with nothing to undo it. Only keys inside this owner's own folder are
      // removed; anything else keeps its row deleted and leaves an orphan object, which is
      // reclaimable and is the direction this route already chose for a failed remove.
      const paths = docs
        .map((d) => toStoragePath(d.file_url))
        .filter((p) => p && pathBelongsToOwner(p, user.id)) as string[];
      const ids = docs.map((d) => d.id);

      // [reset#2] Delete the DB rows FIRST, scoped by user_id (defense-in-depth),
      // aborting on error — mirrors the hardened order in deleteDocument. Doing storage
      // first (the old order, with unchecked results) risked dangling rows pointing at
      // removed objects (404 signed URLs) or orphaned objects on a silent failure.
      const { error: delErr } = await serviceSupabase
        .from("documents").delete().in("id", ids).eq("user_id", user.id);
      if (delErr) {
        console.error("[BOEK-015] reset row delete failed:", delErr);
        return NextResponse.json({ error: "Reset mislukt" }, { status: 500 });
      }

      // Then remove the storage objects. A failed remove leaves orphans (reclaimable)
      // but never a dangling row.
      if (paths.length > 0) {
        await serviceSupabase.storage.from("documents").remove(paths);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[BOEK-015] reset failed:", error);
    return NextResponse.json({ error: "Reset mislukt" }, { status: 500 });
  }
}