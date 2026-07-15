// src/app/api/bestanden/route.ts
// [BOEK-033] Bestanden API — folder contents, search, PATCH
// [BOEK-033] Smart structure: is_system + folder_type in select

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { searchBestanden, ensureSharedFolder } from "@/lib/bestanden";
import type { Database } from "@/types/database.types";

type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];
const FOLDER_SELECT = "id, user_id, name, parent_id, color, created_at, starred, is_system, folder_type";
const DOC_SELECT    = "id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at, folder_id, ai_processed, ai_doc_type, starred, trashed, trashed_at, source, shared";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const search        = p.get("search") ?? "";
  const starred       = p.get("starred") === "true";
  // [BESTANDEN-SMART] Drive/OneDrive-style smart views. One flat, cross-folder
  // list of the owner's own documents, filtered by a virtual axis instead of a
  // folder. 'recent' = latest first (capped), 'starred' = favourites, 'shared'
  // = everything the accountant can see. All read-only over the same RLS-bound
  // documents table (own rows, trashed=false). No new tables, no writes.
  const view          = p.get("view"); // 'recent' | 'starred' | 'shared'
  const stats         = p.get("stats") === "true";
  const folderIdParam = p.get("folder_id");

  // ── Storage usage (count + total bytes of the owner's live files) ──
  // [BESTANDEN-SMART] Powers the sidebar storage meter. Sums file_size over the
  // owner's non-trashed documents — a single indexed scan (documents_user_created).
  if (stats) {
    const { data, error } = await supabase
      .from("documents").select("file_size")
      .eq("user_id", user.id).eq("trashed", false);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    const bytes = rows.reduce((sum, d) => sum + (d.file_size ?? 0), 0);
    return NextResponse.json({ count: rows.length, bytes });
  }

  // ── Smart views: recent / starred / shared ──
  // [BESTANDEN-SMART] `starred=true` is the pre-existing param and stays working;
  // `view=starred` is its named alias. All three return the same { documents } shape
  // the client already renders for the starred/search lists.
  if (view === "recent" || view === "starred" || view === "shared" || starred) {
    let q = supabase
      .from("documents").select(DOC_SELECT)
      .eq("user_id", user.id).eq("trashed", false)
      .order("created_at", { ascending: false });
    if (view === "starred" || starred) q = q.eq("starred", true);
    else if (view === "shared")        q = q.eq("shared", true);
    else                               q = q.limit(50); // recent — latest 50
    const { data, error } = await q;
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
    // [BRUG-FILES-SHARED] Explicit share toggle (the "Delen met boekhouder" button).
    // shared=true makes the file visible to the accountant WITHOUT moving it — the
    // file stays in its original folder. shared=false un-shares it. period/year are
    // set automatically when sharing so the closing-package ZIP can place it.
    shared?: boolean;
    // [FIN-9] Optional quarter the owner is sharing FOR ('YYYY-Qn'). When present
    // it overrides the current-quarter default so a receipt shared after its
    // quarter closes still lands in the right closing package.
    period?: string;
  };

  const patch: DocumentUpdate = {};
  if (typeof body.file_name === "string") patch.file_name = body.file_name.trim();
  if (typeof body.starred === "boolean")   patch.starred   = body.starred;
  if (typeof body.trashed === "boolean") {
    patch.trashed    = body.trashed;
    patch.trashed_at = body.trashed ? new Date().toISOString() : null;
  }

  // [BRUG-FILES-SHARED] Explicit share toggle. A file can be shared (or un-shared)
  // in place via the "Delen met boekhouder" / "Niet meer delen" button — no move.
  // When sharing, stamp the current quarter so the ZIP can place it.
  if (typeof body.shared === "boolean") {
    patch.shared = body.shared;
    if (body.shared) {
      // [FIN-9] Prefer the quarter the owner explicitly chose: a Q1 receipt is
      // usually shared AFTER Q1 closes (in Q2), so stamping the *current* quarter
      // made the file miss the Q1 closing package and wrongly land in Q2's. When
      // the client sends a validated 'YYYY-Qn' we honour it; otherwise we fall
      // back to the current quarter (unchanged legacy behaviour). Backward-
      // compatible: callers sending only { shared: true } are unaffected.
      const chosen =
        typeof body.period === "string" && /^\d{4}-Q[1-4]$/.test(body.period)
          ? body.period
          : null;
      if (chosen) {
        patch.period = chosen;
        patch.year = Number(chosen.slice(0, 4));
      } else {
        const now = new Date();
        const y = now.getFullYear();
        patch.period = `${y}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
        patch.year = y;
      }
    }
  }

  // [BRUG-FILES-SHARED] Magic shared folder. Moving a file INTO the "Gedeeld met
  // boekhouder" folder (folder_type='shared') auto-shares it (shared=true + current
  // quarter). Moving it elsewhere does NOT un-share — un-sharing is an explicit
  // action (the toggle above), so an ordinary reorganizing move never silently
  // removes the accountant's access.
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
    }
    // else: plain move — leave shared untouched.
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { error } = await supabase.from("documents")
    .update(patch).eq("id", docId).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}