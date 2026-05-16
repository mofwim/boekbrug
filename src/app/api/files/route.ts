// app/api/files/route.ts
// [BOEK-010] Document upload (POST) + list (GET)
// [BOEK-010] Added ?clientId= support — accountant can view a linked client's shared folder

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

    // List only that client's shared documents
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
// Fields: file, year, quarter, invoice_id?, notes?, shared?
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
  const shared    = formData.get("shared") === "true";

  const { id, error } = await uploadDocument(user.id, file, {
    year,
    quarter,
    invoiceId,
    notes,
    shared,
  });

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ id }, { status: 201 });
}