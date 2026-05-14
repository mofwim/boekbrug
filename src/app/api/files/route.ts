// app/api/files/route.ts
// Document upload (POST) + list (GET) (BOEK-010)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { uploadDocument, getDocumentUrl } from "@/lib/documents";

// GET /api/files?year=2026&quarter=1&doc_type=invoice
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = req.nextUrl.searchParams.get("year");
  const quarter = req.nextUrl.searchParams.get("quarter");
  const docType = req.nextUrl.searchParams.get("doc_type");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const cursor = req.nextUrl.searchParams.get("cursor"); // created_at for pagination

  let q = supabase
    .from("documents")
    .select("id, file_name, file_url, file_size, file_type, doc_type, period, year, notes, invoice_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (year) q = q.eq("year", Number(year));
  if (quarter && year) q = q.eq("period", `${year}-Q${quarter}`);
  if (docType) q = q.eq("doc_type", docType);
  if (cursor) q = q.lt("created_at", cursor);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    documents: data,
    hasMore: data.length === limit,
  });
}

// POST /api/files — multipart/form-data
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }

  const year = Number(formData.get("year") ?? new Date().getFullYear());
  const quarter = Number(formData.get("quarter") ?? Math.ceil((new Date().getMonth() + 1) / 3));
  const invoiceId = formData.get("invoice_id") as string | null;
  const notes = formData.get("notes") as string | null;

  const { id, error } = await uploadDocument(user.id, file, {
    year,
    quarter,
    invoiceId: invoiceId ?? undefined,
    notes: notes ?? undefined,
  });

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ id }, { status: 201 });
}