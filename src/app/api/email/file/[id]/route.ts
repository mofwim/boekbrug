// src/app/api/email/file/[id]/route.ts
// [BOEK-011] Generate a signed URL to view an incoming invoice PDF
// GET /api/email/file/[id] → { url: string }
// The PDF is stored privately in Supabase Storage — this creates a temp link

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // Verify the invoice belongs to this user and get the storage path
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, sender_id, pdf_url")
    .eq("id", id)
    .single();

  if (!invoice || invoice.sender_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  if (!invoice.pdf_url) {
    return NextResponse.json(
      { error: "Geen bestand gekoppeld aan deze factuur" },
      { status: 404 }
    );
  }

  // [BOEK-011] Create a signed URL valid for 5 minutes — enough to open/view
  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(invoice.pdf_url, 300);

  if (error || !signed) {
    return NextResponse.json(
      { error: "Kon bestand niet openen" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}