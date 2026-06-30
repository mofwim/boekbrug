// app/api/files/route.ts
// [BOEK-010] Document upload (POST) + list (GET)
// [BOEK-010] Added ?clientId= support — accountant can view a linked client's shared folder
// [BRUG-FILES-SHARED] POST restored. The live "Mijn bestanden" (BestandenPage) uploads
//   through this route, so it must work. uploadDocument does NOT write documents.shared,
//   so uploading here never silently shares — sharing is a separate, explicit step
//   (moving/uploading into the "Gedeeld met boekhouder" folder, handled in the bestanden
//   PATCH route). GET kept; DELETE on [id] stays disabled.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { uploadDocument, listDocuments } from "@/lib/documents";

// GET /api/files
//   ?year=2026&quarter=1&doc_type=pdf&shared=true            ← ZZP own files
//   ?clientId=<uuid>&shared=true                             ← accountant viewing client's shared folder
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p         = req.nextUrl.searchParams;
  const clientId  = p.get("clientId") ?? null;  // [BOEK-010] accountant mode
  const year      = p.get("year")     ? Number(p.get("year"))    : undefined;
  const quarter   = p.get("quarter")  ? Number(p.get("quarter")) : undefined;
  const docType   = p.get("doc_type") ?? undefined;
  const limit     = Number(p.get("limit") ?? "30");
  const cursor    = p.get("cursor")   ?? undefined;
  const sharedOnly = p.get("shared") === "true";

  // [BOEK-010] If clientId is provided → accountant is viewing a specific client's files
  // Verify the requesting user is actually linked as accountant of that client
  if (clientId) {
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!link) {
      return NextResponse.json({ error: "Geen toegang tot deze klant" }, { status: 403 });
    }

    try {
      const result = await listDocuments(clientId, {
        year,
        quarter,
        docType,
        limit,
        cursor,
        sharedOnly: true, // accountant always sees shared only
      });
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Normal ZZP: list own documents
  try {
    const result = await listDocuments(user.id, {
      year,
      quarter,
      docType,
      limit,
      cursor,
      sharedOnly,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onbekende fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/files — multipart/form-data
// Fields: file, year, quarter, invoice_id?, notes?
// [BRUG-FILES-SHARED] Restored. Uploads a file via uploadDocument. Note that
//   uploadDocument does not set documents.shared, so an upload is never a share by
//   itself — the magic "Gedeeld met boekhouder" folder turns it into a share, in the
//   bestanden PATCH route, when the file lands in that folder.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const formData  = await req.formData();
  const file      = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }

  const now       = new Date();
  const year      = Number(formData.get("year")    ?? now.getFullYear());
  const quarter   = Number(formData.get("quarter") ?? Math.ceil((now.getMonth() + 1) / 3));
  const invoiceId = (formData.get("invoice_id") as string | null) ?? undefined;
  const notes     = (formData.get("notes")     as string | null) ?? undefined;
  // [BESTANDEN-DUP] explicit "upload again" confirmation from the dup modal
  const allowDuplicate = formData.get("allowDuplicate") === "true";

  const { id, error, duplicate, existing } = await uploadDocument(user.id, file, {
    year,
    quarter,
    invoiceId,
    notes,
    allowDuplicate,
  });

  // [BRIDGE-EXTRACT] Duplicate → 409, surface WHERE the file already lives.
  if (duplicate) {
    return NextResponse.json(
      { error, duplicate: true, existing },
      { status: 409 }
    );
  }

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ id }, { status: 201 });
}