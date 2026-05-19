// src/app/api/email/file/[id]/route.ts
// [BOEK-011] Generate a signed URL to view an incoming invoice PDF
// GET /api/email/file/[id] → { url: string }
// The PDF is stored privately in Supabase Storage — this creates a temp link

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// [BOEK-011] Normalize a stored value to a relative storage path.
// Older invoices may have stored a full signed URL instead of a path.
// New invoices store the raw relative path. This handles both safely.
function toStoragePath(stored: string): string {
  if (stored.startsWith("http")) {
    const signMarker = "/object/sign/documents/";
    const publicMarker = "/object/public/documents/";
    let idx = stored.indexOf(signMarker);
    if (idx !== -1) {
      idx += signMarker.length;
    } else {
      idx = stored.indexOf(publicMarker);
      if (idx === -1) return stored; // unknown shape — return as-is
      idx += publicMarker.length;
    }
    // Strip query string (?token=...) and decode %20 etc.
    return decodeURIComponent(stored.slice(idx).split("?")[0]);
  }
  // Already a relative path
  return stored;
}

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
    .select("id, receiver_id, pdf_url")
    .eq("id", id)
    .single();

  if (!invoice || invoice.receiver_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  if (!invoice.pdf_url) {
    return NextResponse.json(
      { error: "Geen bestand gekoppeld aan deze factuur" },
      { status: 404 }
    );
  }

  // [BOEK-011] Normalize — handles both relative paths and legacy full URLs
  const storagePath = toStoragePath(invoice.pdf_url);

  // [BOEK-011] Create a signed URL valid for 5 minutes — enough to open/view
  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 300);

  if (error || !signed) {
    return NextResponse.json(
      { error: "Kon bestand niet openen" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}