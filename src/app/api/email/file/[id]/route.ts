// src/app/api/email/file/[id]/route.ts
// [BOEK-011] Generate a signed URL to view an incoming invoice PDF
// GET /api/email/file/[id] → { url: string }
// The PDF is stored privately in Supabase Storage — this creates a temp link

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [SEC-STORAGE-PATH] Normalising a stored value and deciding WHOSE bytes it names are the same
// question, so they live in one tested place — see the header of storage-path.ts for the hole
// this closes.
import { toStoragePath, pathBelongsToOwner } from "@/lib/storage-path";

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

  // Verify access and get the storage path.
  // Two authorized roles (BOEK-011 + ACC-INVOICE-VIEW cross-boundary fix):
  //   1. the receiver (the ZZP'er who owns the incoming invoice), or
  //   2. an accountant linked to that ZZP'er via accountant_clients.
  // Previously only (1) was allowed, so accountants opening a client's incoming
  // invoice (?from=client) got a 404 on both "Origineel PDF" and UBL.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, receiver_id, pdf_url")
    .eq("id", id)
    .single();

  if (!invoice) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  let authorized = invoice.receiver_id === user.id;

  if (!authorized && invoice.receiver_id) {
    const { data: link } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", invoice.receiver_id)
      .maybeSingle();
    authorized = !!link;
  }

  if (!authorized) {
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

  // [SEC-STORAGE-PATH] The authorization above proved the caller may read this ROW. It did NOT
  // prove anything about where the row POINTS — and pdf_url is plain text on a row the caller is
  // allowed to write (invoices_receiver_update / invoices_zzp_insert). Without this check a caller
  // could put another tenant's storage key on their own invoice and have the service-role client,
  // which bypasses the bucket policy, sign it for them. Every file this app writes is keyed
  // `<owner-uuid>/…`, and the owner covered by the check above is the invoice's receiver — so the
  // path must sit in THAT folder. Fails closed: an unattributable path is never signed.
  if (!pathBelongsToOwner(storagePath, invoice.receiver_id)) {
    console.error("[SEC-STORAGE-PATH] refused to sign a path outside the authorized owner", {
      invoiceId: id, receiverId: invoice.receiver_id, storagePath, callerId: user.id,
    });
    return NextResponse.json({ error: "Kon bestand niet openen" }, { status: 403 });
  }

  // [BOEK-011 + ACC-INVOICE-VIEW] Sign with service_role — same reasoning as
  // /dashboard/brug/page.tsx documents:
  //
  // Storage bucket policies are SEPARATE from table RLS. The policy
  // `documents_read` on storage.objects requires
  //   (storage.foldername(name))[1] = auth.uid()::text
  // i.e. only the file's owner can sign it. A linked accountant opening a
  // client's incoming invoice is authorized at the row level (we just checked
  // accountant_clients above), but is NOT the storage owner — so a session
  // client createSignedUrl returns an error and we crashed with 500.
  //
  // Switching to the pipeline client here bypasses Storage RLS *only*. Two separate proofs are
  // required before we get here, and BOTH matter: the dual-path row check (session client), and
  // the owner-segment check on the path itself. The row proof alone was the bug — it says the
  // caller may see the record, not that the record points at their own bytes.
  const pipeline = createPipelineClient();
  const { data: signed, error } = await pipeline.storage
    .from("documents")
    .createSignedUrl(storagePath, 300);

  if (error || !signed) {
    console.error("[BOEK-011] createSignedUrl failed", {
      invoiceId: id,
      storagePath,
      error,
    });
    return NextResponse.json(
      { error: "Kon bestand niet openen" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}