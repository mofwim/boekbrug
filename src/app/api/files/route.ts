// app/api/files/route.ts
// [BOEK-010] Document upload (POST) + list (GET, owner-scoped)
// [BRUG-FILES-SHARED] POST restored. The live "Mijn bestanden" (BestandenPage) uploads
//   through this route, so it must work. uploadDocument does NOT write documents.shared,
//   so uploading here never silently shares — sharing is a separate, explicit step
//   (the documents.shared flag, handled in the bestanden PATCH route). GET kept;
//   DELETE on [id] stays disabled.
// [FIN-UNIFY] The old ?clientId= accountant listing (and its shared/ storage-path
//   filter) is retired. The accountant reads a client's shared files on /brug and in
//   the closing package via the documents.shared flag (RLS) — one source of truth,
//   no path/flag split. This route is now owner-scoped only.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { uploadDocument, listDocuments } from "@/lib/documents";

// GET /api/files?year=2026&quarter=1&doc_type=pdf  ← the caller's OWN files
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const p         = req.nextUrl.searchParams;
  const year      = p.get("year")     ? Number(p.get("year"))    : undefined;
  const quarter   = p.get("quarter")  ? Number(p.get("quarter")) : undefined;
  const docType   = p.get("doc_type") ?? undefined;
  const limit     = Number(p.get("limit") ?? "30");
  const cursor    = p.get("cursor")   ?? undefined;

  try {
    const result = await listDocuments(user.id, { year, quarter, docType, limit, cursor });
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
  // [L9] Validate year/quarter — a non-numeric value would otherwise become NaN and
  // flow into the storage path ("…/NaN/QNaN/…") and period ("NaN-QNaN"). Fall back to
  // the current quarter for anything missing/out-of-range.
  const rawYear    = Number(formData.get("year"));
  const rawQuarter = Number(formData.get("quarter"));
  const year      = Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= 2100
    ? rawYear : now.getFullYear();
  const quarter   = Number.isInteger(rawQuarter) && rawQuarter >= 1 && rawQuarter <= 4
    ? rawQuarter : Math.ceil((now.getMonth() + 1) / 3);
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