// src/app/api/bestanden/folders/route.ts
// [BOEK-033] Folder CRUD — create, rename, delete, move, star

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createFolder, renameFolder, deleteFolder, moveFolder } from "@/lib/bestanden";

// POST /api/bestanden/folders
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json() as { name?: string; parent_id?: string | null; color?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "Naam vereist" }, { status: 400 });

  try {
    const folder = await createFolder(user.id, body.name, body.parent_id, body.color);
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/bestanden/folders?id=<folderId>
// Body: { name?, parent_id?, starred? }
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const folderId = req.nextUrl.searchParams.get("id");
  if (!folderId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as { name?: string; parent_id?: string | null; starred?: boolean };

  try {
    if (typeof body.name === "string") {
      await renameFolder(folderId, user.id, body.name);
    }
    if ("parent_id" in body) {
      await moveFolder(folderId, body.parent_id ?? null, user.id);
    }
    if (typeof body.starred === "boolean") {
      const { error } = await supabase
        .from("folders")
        .update({ starred: body.starred })
        .eq("id", folderId)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/bestanden/folders?id=<folderId>
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const folderId = req.nextUrl.searchParams.get("id");
  if (!folderId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  try {
    await deleteFolder(folderId, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}