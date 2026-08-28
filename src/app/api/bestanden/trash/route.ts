// src/app/api/bestanden/trash/route.ts
// [BOEK-033] Prullenbak — GET trashed files, PATCH restore
// [COHERENCE-TRASH] DELETE added — permanent-delete a trashed document. Previously the
//   Trash UI called the deprecated DELETE /api/files/[id] (410 Gone) and removed rows
//   without checking res.ok, so "permanently deleted" files silently stayed trashed=true
//   and reappeared on reload — the owner was told sensitive docs were gone when they were
//   not. This is the real, audited purge, guarded to documents that are actually in the
//   trash (must be soft-deleted first — never a one-click hard delete of a live record).

import { NextRequest, NextResponse } from "next/server";
// [VOL-GELEZEN] PostgREST kapt stil af op ~1000 rijen — zie supabase-paginate.ts.
import { fetchAllRows } from "@/lib/supabase-paginate";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { deleteDocument } from "@/lib/documents";
import { logAuditAction, getClientIP } from "@/lib/audit";

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // [VOL-GELEZEN] Gepagineerd. De prullenbak is het scherm waarop de eigenaar iets terugzoekt dat
  // hij per ongeluk weggooide, en juist die bak groeit: er wordt zelden geleegd. Achter de stille
  // rijlimiet van PostgREST verdween alles ouder dan de laatste duizend — hij zag geen foutmelding,
  // hij zag een prullenbak zonder zijn bestand, en de enige conclusie daaruit is "dan is het echt weg".
  //
  // trashed_at is nullable (oudere soft-deletes lieten hem leeg) en DESC zet NULL bovenaan; id
  // erachter maakt de volgorde totaal, zodat geen rij zich op een paginagrens verstopt of verdubbelt.
  const prullenbak = () =>
    supabase
      .from("documents")
      .select("id, file_name, file_url, file_size, file_type, doc_type, created_at, folder_id, trashed, trashed_at, starred")
      .eq("user_id", user.id)
      .eq("trashed", true);
  type WeggegooidBestand = NonNullable<Awaited<ReturnType<typeof prullenbak>>["data"]>[number];

  try {
    const data = await fetchAllRows<WeggegooidBestand>((from, to) =>
      prullenbak()
        .order("trashed_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return NextResponse.json(data);
  } catch (e) {
    // [NO-SILENT-EMPTY] fetchAllRows THROWS on a failed page — en een halve prullenbak leest
    // precies als een prullenbak waarin het bestand niet meer staat.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fout" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  const body = await req.json() as { restore?: boolean };
  if (!body.restore) return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });

  const { error } = await supabase
    .from("documents")
    .update({ trashed: false, trashed_at: null })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// [COHERENCE-TRASH] Permanent-delete a document that is IN the trash. Guarded to
// trashed=true (a live document can never be hard-deleted through here — it must be
// soft-deleted first), owner-scoped, and audited. Deletes the DB row + storage object
// via deleteDocument. Returns 404 when the id is not a trashed document of this user,
// so the UI can tell the owner the purge did NOT happen instead of lying about success.
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id vereist" }, { status: 400 });

  // Only proceed if this is genuinely a trashed doc owned by the caller.
  const { data: doc } = await supabase
    .from("documents")
    .select("id, file_name, trashed, invoice_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!doc) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  if (!doc.trashed) {
    return NextResponse.json(
      { error: "Alleen bestanden in de prullenbak kunnen permanent worden verwijderd." },
      { status: 409 }
    );
  }

  const { error: delErr } = await deleteDocument(id, user.id);
  if (delErr) return NextResponse.json({ error: delErr }, { status: 500 });

  await logAuditAction({
    userId: user.id,
    action: "document.deleted",
    entityType: "document",
    entityId: id,
    oldValue: { file_name: doc.file_name, invoice_id: doc.invoice_id ?? null, via: "prullenbak_permanent_delete" },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, deleted: id });
}