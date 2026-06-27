// src/app/api/closing-package/summary/route.ts
// [BRIDGE-HUB Overzicht] Lightweight closing-package summary — counts, bank
// statement presence, and honest warnings — WITHOUT building the ZIP. Powers
// the Brug "Overzicht" tab so the accountant sees readiness before downloading.
//
// GET /api/closing-package/summary?year=2026&quarter=1            ← owner (self)
// GET /api/closing-package/summary?year=2026&quarter=1&clientId=… ← linked accountant
//
// Dual-path authorization mirrors /api/closing-package:
//   - owner: summarizes their OWN quarter (ownerId = user.id)
//   - accountant: only for a client they are linked to (accountant_clients)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { summarizeClosingPackage, type Quarter } from "@/lib/closing-package";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const quarterRaw = Number(req.nextUrl.searchParams.get("quarter"));
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!year || isNaN(year)) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(quarterRaw)) {
    return NextResponse.json({ error: "Ongeldig kwartaal" }, { status: 400 });
  }
  const quarter = quarterRaw as Quarter;

  // Resolve the owner whose quarter we summarize + authorize.
  let ownerId = user.id;

  if (clientId) {
    // Accountant path: must be linked to this client.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "accountant") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const { data: rel } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!rel) return NextResponse.json({ error: "Geen toegang tot deze klant" }, { status: 403 });
    ownerId = clientId;
  }

  // service_role pipeline client — every query inside is explicitly scoped to
  // ownerId, which we authorized above. service_role bypasses RLS for the
  // storage-backed document checks (same pattern as the package route).
  const pipeline = createPipelineClient();

  try {
    const summary = await summarizeClosingPackage({ ownerId, year, quarter, supabase: pipeline });
    return NextResponse.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}