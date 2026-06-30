// src/app/api/bestanden/route.ts
// [BOEK-033] Bestanden API — folder contents, search, PATCH
// [BOEK-033] Smart structure: is_system + folder_type in select

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { searchBestanden, ensureSharedFolder } from "@/lib/bestanden";
import type { Database } from "@/types/database.types";

type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];
const FOLDER_SELECT = "id, user_id, name, parent_id, color, created_at, starred, is_system, folder_type";
const DOC_SELECT    = "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, starred, trashed, trashed_at, source";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const search        = p.get("search") ?? "";
  const starred       = p.get("starred") === "true";
  const folderIdParam = p.get("folder_id");

  // ── Starred view ──
  if (starred) {
    const { data, error } = await supabase
      .from("documents").select(DOC_SELECT)
      .eq("user_id", user.id).eq("starred", true).eq("trashed", false)
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

  // ── Normal folder contents ──
  const folderId = folderIdParam === "root" || !folderIdParam ? null : folderIdParam;

  try {
    await ensureSharedFolder(user.id);

    // Folders — include is_system + folder_type
    let folderQ = supabase
      .from("folders").select(FOLDER_SELECT)
      .eq("user_id", user.id).order("name", { ascending: true });
    if (folderId === null) folderQ = folderQ.is("parent_id", null);
    else folderQ = folderQ.eq("parent_id", folderId);
    const { data: folders, error: fErr } = await folderQ;
    if (fErr) throw new Error(fErr.message);

    // Documents — exclude trashed
    let docQ = supabase
      .from("documents").select(DOC_SELECT)
      .eq("user_id", user.id).eq("trashed", false)
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

  const patch: DocumentUpdate = {};
  if (typeof body.file_name === "string") patch.file_name = body.file_name.trim();
  if (typeof body.starred === "boolean")   patch.starred   = body.starred;
  if (typeof body.trashed === "boolean") {
    patch.trashed    = body.trashed;
    patch.trashed_at = body.trashed ? new Date().toISOString() : null;
  }

  // [BRUG-FILES-SHARED] Magic shared folder. When a file is moved INTO a folder of
  // type 'shared' (the "Gedeeld met boekhouder" folder), it is automatically shared
  // with the accountant: shared=true is the field the accountant RLS reads, and
  // period/year tie it to the CURRENT quarter so the closing-package ZIP can place
  // it. Moving the file OUT of the shared folder un-shares it (shared=false).
  // This is the explicit owner action: dropping a file in the accountant folder.
  if ("folder_id" in body) {
    const newFolderId = body.folder_id ?? null;
    patch.folder_id = newFolderId;

    let isSharedTarget = false;
    if (newFolderId) {
      const { data: folder } = await supabase
        .from("folders")
        .select("folder_type")
        .eq("id", newFolderId)
        .eq("user_id", user.id)
        .maybeSingle();
      isSharedTarget = folder?.folder_type === "shared";
    }

    if (isSharedTarget) {
      const now = new Date();
      const y = now.getFullYear();
      patch.shared = true;
      patch.period = `${y}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
      patch.year   = y;
    } else {
      // Moved out of (or never into) the shared folder → not shared anymore.
      patch.shared = false;
    }
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("documents")
    .update(patch).eq("id", docId).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}