// app/api/files/[id]/url/route.ts
// Returns a fresh signed URL for a private document (BOEK-010)
// Called by DocumentsClient PreviewModal

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getDocumentUrl } from "@/lib/documents";

// Next.js 15: params is a Promise
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // Verify ownership
  const { data: doc } = await supabase
    .from("documents")
    .select("file_url")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!doc) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });

  const url = await getDocumentUrl(doc.file_url);
  if (!url) return NextResponse.json({ error: "URL ophalen mislukt" }, { status: 500 });

  return NextResponse.json({ url });
}