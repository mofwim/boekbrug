// app/api/files/[id]/url/route.ts
// [BOEK-010] Returns a signed URL for a private document
// [BOEK-033] Used by PreviewModal and download action

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getDocumentUrl } from "@/lib/documents";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Fetch file_url from DB (with ownership check)
  const { data: doc } = await supabase
    .from("documents")
    .select("file_url")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });

  const url = await getDocumentUrl(doc.file_url);
  if (!url) return NextResponse.json({ error: "URL genereren mislukt" }, { status: 500 });

  return NextResponse.json({ url });
}