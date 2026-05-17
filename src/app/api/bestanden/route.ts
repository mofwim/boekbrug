// src/app/api/bestanden/route.ts
// [BOEK-033] Bestanden API — folder contents, search, PATCH (move/rename/star/trash)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { searchBestanden, ensureSharedFolder } from "@/lib/bestanden";

// GET /api/bestanden?folder_id=<id>&search=<q>&starred=true
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const search      = p.get("search") ?? "";
  const starred     = p.get("starred") === "true";
  const folderIdParam = p.get("folder_id");

  // ── Starred view ──
  if (starred) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, starred, trashed, trashed_at, source")
      .eq("user_id", user.id)
      .eq("starred", true)
      .eq("trashed", false)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ documents: data ?? [] });
  }

  // ── Search ──
  if (search.trim()) {
    try {
      const results = await searchBestanden(user.id, search);
      return NextResponse.json({ results });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Fout" }, { status: 500 });
    }
  }

  // ── Normal folder contents — [BOEK-033] Fix 3: exclude trashed documents ──
  const folderId = folderIdParam === "root" || !folderIdParam ? null : folderIdParam;

  try {
    await ensureSharedFolder(user.id);

    // Folders
    let folderQ = supabase
      .from("folders")
      .select("id, user_id, name, parent_id, color, created_at, starred")
      .eq("user_id", user.id)
      .order("name", { ascending: true });
    if (folderId === null) folderQ = folderQ.is("parent_id", null);
    else folderQ = folderQ.eq("parent_id", folderId);
    const { data: folders, error: fErr } = await folderQ;
    if (fErr) throw new Error(fErr.message);

    // Documents — exclude trashed
    let docQ = supabase
      .from("documents")
      .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, starred, trashed, source")
      .eq("user_id", user.id)
      .eq("trashed", false)   // [BOEK-033] Fix 3 — never show trashed in normal view
      .order("created_at", { ascending: false });
    if (folderId === null) docQ = docQ.is("folder_id", null);
    else docQ = docQ.eq("folder_id", folderId);
    const { data: documents, error: dErr } = await docQ;
    if (dErr) throw new Error(dErr.message);

    return NextResponse.json({ folders: folders ?? [], documents: documents ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fout" }, { status: 500 });
  }
}

// PATCH /api/bestanden?id=<documentId>
// Body: { folder_id?, file_name?, starred?, trashed? }
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const docId = req.nextUrl.searchParams.get("id");
  if (!docId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as {
    folder_id?: string | null;
    file_name?: string;
    starred?: boolean;
    trashed?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.file_name === "string") patch.file_name = body.file_name.trim();
  if ("folder_id" in body)               patch.folder_id = body.folder_id ?? null;
  if (typeof body.starred  === "boolean") patch.starred   = body.starred;
  if (typeof body.trashed  === "boolean") {
    patch.trashed    = body.trashed;
    patch.trashed_at = body.trashed ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase
    .from("documents")
    .update(patch)
    .eq("id", docId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}