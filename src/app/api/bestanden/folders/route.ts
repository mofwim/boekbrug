// src/app/api/bestanden/folders/route.ts
// [BOEK-033] Folder CRUD — create, rename, delete, move
// [BOEK-033] Guard: is_system folders cannot be renamed or deleted

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createFolder, renameFolder, deleteFolder, moveFolder } from "@/lib/bestanden";

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
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fout" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const folderId = req.nextUrl.searchParams.get("id");
  if (!folderId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as { name?: string; parent_id?: string | null; starred?: boolean };

  try {
    if (typeof body.name === "string") {
      await renameFolder(folderId, user.id, body.name); // throws if is_system
    }
    if ("parent_id" in body) {
      await moveFolder(folderId, body.parent_id ?? null, user.id);
    }
    if (typeof body.starred === "boolean") {
      await supabase.from("folders")
        .update({ starred: body.starred })
        .eq("id", folderId).eq("user_id", user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fout";
    const status = msg.includes("Systeem") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const folderId = req.nextUrl.searchParams.get("id");
  if (!folderId) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  try {
    await deleteFolder(folderId, user.id); // throws if is_system
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fout";
    const status = msg.includes("Systeem") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}