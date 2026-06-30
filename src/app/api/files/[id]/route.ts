// app/api/files/[id]/route.ts
// [BOEK-010] Single file operations — GET metadata + signed URL, DELETE
// [BOEK-033] Added /url sub-path for signed URL only
// [DOCS-DISABLE-OLD] DELETE disabled (410 Gone) — financial-record deletion belongs to
//   the live system; this old route is deprecated. GET metadata kept (read-only).
//   No code or data deleted; deleteDocument stays available in @/lib/documents.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/files/[id] — returns document metadata
// GET /api/files/[id]/url — returns { url: signedUrl } (handled by /url/route.ts)
// [DOCS-DISABLE-OLD] GET kept — read-only, no share created.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, source")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !doc) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });

  return NextResponse.json({ document: doc });
}

// DELETE /api/files/[id]
// [DOCS-DISABLE-OLD] Disabled. Return 410 Gone instead of deleting, so no programmatic
//   call can remove a document via this deprecated route. The live owner system is
//   /dashboard/bestanden. No code or data deleted; deleteDocument stays in @/lib/documents.
export async function DELETE() {
  return NextResponse.json(
    {
      error: "Deze route is uitgeschakeld. Beheer bestanden via 'Mijn bestanden' (/dashboard/bestanden).",
      code: "DOCS_DISABLE_OLD",
    },
    { status: 410 }
  );
}