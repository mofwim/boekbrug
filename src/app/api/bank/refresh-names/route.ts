// src/app/api/bank/refresh-names/route.ts
// [BANK-REDERIVE] Upgrade older bank transactions whose stored name is still
// "Onbekende tegenpartij" (imported before the parser learned to read card
// store names) by re-deriving name + reference from their stored description —
// WITHOUT re-uploading or deleting anything (respects Bewaarplicht).
//
// POST /api/bank/refresh-names  → { ok: true, updated: <n>, scanned: <n> }
//
// Safety: we ONLY touch rows whose existing name is weak (null / "Onbekende" /
// "USTD"). A good name (e.g. a CNTP vendor like "Oz + Er Food B.V.") is never
// overwritten — the stored description is the REMI only and can't recover a CNTP
// name, so we must not clobber it. Reference is updated alongside the name only
// for those same weak rows. service_role, pinned to the user's own rows.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { rederiveFromDescription } from "@/lib/bank-parser";

// A name is "weak" if it tells the owner nothing — these are the rows worth
// upgrading from the description.
function isWeakName(name: string | null): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  return n === "" || n === "onbekende tegenpartij" || n === "onbekend" || n === "ustd" || n === "ust";
}

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();

  // 1. Pull this user's transactions that still have a weak name but DO have a
  //    description to derive from. (status is irrelevant — we fix matched/ignored
  //    rows too; we only ever change the display fields, never money or links.)
  //
  // [PAGINATE] Paged past the silent ~1000-row cap, with a stable order. This was a bare
  // `.select().eq(user_id)`, so the button scanned an ARBITRARY thousand rows and every weak
  // name beyond them was unreachable — pressing it again re-scanned the same thousand. Worse,
  // it then reported `scanned` from that truncated set, so the UI answered "Alle namen waren al
  // up-to-date" while hundreds of rows still read "Onbekende tegenpartij". This is the one
  // action whose whole purpose is the OLD rows, which is exactly what the cap was dropping.
  let rows: { id: string; counterpart_name: string | null; reference: string | null; description: string | null }[];
  try {
    rows = await fetchAllRows((from, to) =>
      pipeline
        .from("bank_transactions")
        .select("id, counterpart_name, reference, description")
        .eq("user_id", user.id)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    return NextResponse.json(
      { error: "lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const candidates = (rows ?? []).filter(
    (r) => isWeakName(r.counterpart_name) && !!(r.description && r.description.trim())
  );

  let updated = 0;
  for (const r of candidates) {
    const { name, reference } = rederiveFromDescription(r.description);
    // Only write if we actually derived a better (non-weak) name.
    if (name && !isWeakName(name)) {
      const patch: { counterpart_name: string; reference?: string | null } = {
        counterpart_name: name,
      };
      // Refresh reference too, but never blank out an existing one with null.
      if (reference) patch.reference = reference;

      const { error: upErr } = await pipeline
        .from("bank_transactions")
        .update(patch)
        .eq("id", r.id)
        .eq("user_id", user.id);
      if (!upErr) updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates.length,
    updated,
  });
}