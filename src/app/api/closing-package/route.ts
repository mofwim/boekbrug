// src/app/api/closing-package/route.ts
// [CLOSING-PACKAGE] Download one quarterly ZIP for the accountant.
//
// GET /api/closing-package?year=2026&quarter=1[&clientId={uuid}]
//   → ZIP (Content-Disposition: attachment)
//
// Authorization (dual-path, same as export/UBL routes):
//   - owner (ZZP'er) exports their OWN quarter, OR
//   - a linked accountant exports a client's quarter (accountant_clients link).
// Auth on the SESSION client; the actual build uses the service_role pipeline
// client scoped explicitly to ownerId (service_role bypasses RLS).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { buildClosingPackageZip, type Quarter } from "@/lib/closing-package";

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // ── Params ──
  const now = new Date();
  const year = Number(req.nextUrl.searchParams.get("year") ?? now.getFullYear());
  const quarterRaw = Number(req.nextUrl.searchParams.get("quarter"));
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(quarterRaw)) {
    return NextResponse.json({ error: "Ongeldig kwartaal" }, { status: 400 });
  }
  const quarter = quarterRaw as Quarter;

  // ── Resolve ownerId + dual-path authorization ──
  let ownerId = user.id;

  if (clientId && clientId !== user.id) {
    // Only a linked accountant may export someone else's quarter.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "accountant") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Geen toegang tot deze klant" }, { status: 403 });
    }
    ownerId = clientId;
  }

  // ── Build (service_role, scoped to ownerId) ──
  let result;
  try {
    const pipeline = createPipelineClient();
    result = await buildClosingPackageZip({ ownerId, year, quarter, supabase: pipeline });
  } catch (err) {
    console.error("[CLOSING-PACKAGE] build failed", err);
    return NextResponse.json({ error: "Pakket genereren mislukt" }, { status: 500 });
  }

  // ── Filename ──
  let clientLabel = "klant";
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("company_name, full_name")
    .eq("id", ownerId)
    .maybeSingle();
  if (ownerProfile) clientLabel = ownerProfile.company_name || ownerProfile.full_name || "klant";

  const filename = `${safe(clientLabel)}_Q${quarter}_${year}.zip`;

  return new NextResponse(new Uint8Array(result.zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Package-Warnings": String(result.summary.warnings.length),
    },
  });
}