// app/api/files/[id]/route.ts
// [BOEK-010] Single file operations — GET metadata + signed URL, DELETE
// [BOEK-033] Added /url sub-path for signed URL only

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getDocumentUrl, deleteDocument } from "@/lib/documents";

// GET /api/files/[id] — returns document metadata
// GET /api/files/[id]/url — returns { url: signedUrl } (handled by /url/route.ts)
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
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { error } = await deleteDocument(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json({ ok: true });
}