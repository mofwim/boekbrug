// app/api/files/route.ts
// [BOEK-010] Document upload (POST) + list (GET)
// [BOEK-010] Added ?clientId= support — accountant can view a linked client's shared folder
// [DOCS-DISABLE-OLD] POST disabled (410 Gone) — this old file-system shared via the
//   documents.shared flag, but accountant RLS reads folder membership only, so uploads
//   here could silently never reach the accountant. GET is read-only and kept intact.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { listDocuments } from "@/lib/documents";

// GET /api/files
//   ?year=2026&quarter=1&doc_type=pdf&shared=true            ← ZZP own files
//   ?clientId=<uuid>&shared=true                             ← accountant viewing client's shared folder
// [DOCS-DISABLE-OLD] GET kept — read-only, creates no share. Live reads may still rely on it.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p         = req.nextUrl.searchParams;
  const clientId  = p.get("clientId") ?? null;  // [BOEK-010] accountant mode
  const year      = p.get("year")     ? Number(p.get("year"))    : undefined;
  const quarter   = p.get("quarter")  ? Number(p.get("quarter")) : undefined;
  const docType   = p.get("doc_type") ?? undefined;
  const limit     = Number(p.get("limit") ?? "30");
  const cursor    = p.get("cursor")   ?? undefined;
  const sharedOnly = p.get("shared") === "true";

  // [BOEK-010] If clientId is provided → accountant is viewing a specific client's files
  // Verify the requesting user is actually linked as accountant of that client
  if (clientId) {
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!link) {
      return NextResponse.json({ error: "Geen toegang tot deze klant" }, { status: 403 });
    }

    // List only that client's shared documents
    try {
      const result = await listDocuments(clientId, {
        year,
        quarter,
        docType,
        limit,
        cursor,
        sharedOnly: true, // accountant always sees shared only
      });
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Normal ZZP: list own documents
  try {
    const result = await listDocuments(user.id, {
      year,
      quarter,
      docType,
      limit,
      cursor,
      sharedOnly,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/files — multipart/form-data
// [DOCS-DISABLE-OLD] Disabled. Uploading here shared via documents.shared, which the
//   accountant RLS does not read -> silent shares that never reach the accountant.
//   The live owner system is /dashboard/bestanden. We return 410 Gone instead of
//   writing anything, so even a programmatic call cannot create a hidden share.
//   No code or data is deleted; uploadDocument stays available in @/lib/documents.
export async function POST() {
  return NextResponse.json(
    {
      error: "Deze uploadroute is uitgeschakeld. Gebruik 'Mijn bestanden' (/dashboard/bestanden).",
      code: "DOCS_DISABLE_OLD",
    },
    { status: 410 }
  );
}