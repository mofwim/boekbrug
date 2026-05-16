// app/api/bestanden/route.ts
// [BOEK-033] Bestanden API — folder contents + document move/rename

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getFolderContents,
  searchBestanden,
  moveDocument,
  renameDocument,
  ensureSharedFolder,
} from "@/lib/bestanden";

// GET /api/bestanden?folder_id=<id>&search=<query>
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const search = p.get("search") ?? "";
  const folderIdParam = p.get("folder_id");

  // Search mode
  if (search.trim()) {
    try {
      const results = await searchBestanden(user.id, search);
      return NextResponse.json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fout";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Normal folder contents
  const folderId = folderIdParam === "root" || folderIdParam === null ? null : folderIdParam;

  try {
    // Ensure shared folder exists on every load (idempotent)
    await ensureSharedFolder(user.id);

    const contents = await getFolderContents(user.id, folderId);
    return NextResponse.json(contents);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/bestanden?id=<documentId>
// Body: { folder_id?: string | null, file_name?: string }
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const docId = req.nextUrl.searchParams.get("id");
  if (!docId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as { folder_id?: string | null; file_name?: string };

  try {
    if (typeof body.file_name === "string") {
      await renameDocument(docId, user.id, body.file_name);
    }
    if ("folder_id" in body) {
      await moveDocument(docId, body.folder_id ?? null, user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}