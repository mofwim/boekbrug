// src/app/api/bank/delete-statement/route.ts
// [BANK-STATEMENT-DELETE] Delete ONE uploaded bank statement file. The owner
// uploaded a wrong/overlapping statement and wants to replace it with the right
// version — a correction of entry, not a loss of evidence.
//
// POST { documentId }  → { ok: true } | { error }
//
// What it deletes (in a SAFE order):
//   1. the documents row  (doc_type='bankafschrift', owned by this user)
//   2. the Storage file    (bucket 'documents', path = file_url)
//
// Order rationale (see ticket "kritische punten" #2): we remove the documents row
// FIRST so the statement disappears from the closing-package ZIP immediately
// (the package is built fresh each time from a documents query — no cache). The
// Storage delete is best-effort AFTER: an orphan file in Storage is far less
// harmful than a documents row pointing at a missing file (a broken link the
// accountant would see in the package). A failed Storage delete → warning, not
// a hard error; the row is already gone, which is what matters for the package.
//
// What it NEVER touches: bank_transactions. The transactions are the protected
// financial record (Bewaarplicht) and carry all the owner's work (linked
// invoices, confirmed payments, ignores). Deleting the raw statement file does
// not remove a single transaction — dedup already protects against re-import.
//
// Auth: SESSION client (RLS). The owner deletes their OWN statement only; we
// additionally verify ownership and doc_type explicitly before any delete.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction, getClientIP } from "@/lib/audit";

export async function POST(req: NextRequest) {
  // 1. Auth — the owner acting on their own data.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // 2. Body
  let documentId: string | undefined;
  try {
    const body = await req.json();
    documentId = body?.documentId;
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }
  if (!documentId) {
    return NextResponse.json({ error: "Geen document opgegeven" }, { status: 400 });
  }

  // 3. The document must exist, belong to the user, and be a bank statement.
  //    This is the guard that prevents this route from deleting any other
  //    document type (an invoice PDF, a receipt) — only 'bankafschrift'.
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, user_id, doc_type, file_url, file_name")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (docErr) {
    return NextResponse.json({ error: "lookup_failed", detail: docErr.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Bankafschrift niet gevonden" }, { status: 404 });
  }
  if (doc.doc_type !== "bankafschrift") {
    // Defense: never let this endpoint delete a non-statement document.
    return NextResponse.json({ error: "Dit is geen bankafschrift" }, { status: 422 });
  }

  // 4. Delete the documents row FIRST (removes it from the closing package at once).
  //    RLS already scopes to the user; the explicit user_id eq is belt-and-braces.
  const { error: delRowErr } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", user.id);
  if (delRowErr) {
    return NextResponse.json(
      { error: "Verwijderen mislukt", detail: delRowErr.message },
      { status: 500 }
    );
  }

  // 5. Delete the Storage file (best-effort). The row is already gone, so a
  //    failure here leaves an orphan file (harmless) — log it, don't fail the
  //    request. Never leave a row pointing at a deleted file (avoided by order).
  let storageWarning = false;
  if (doc.file_url) {
    const { error: storageErr } = await supabase.storage
      .from("documents")
      .remove([doc.file_url]);
    if (storageErr) {
      console.error("[BANK-STATEMENT-DELETE] storage delete failed (orphan file):", storageErr.message);
      storageWarning = true;
    }
  }

  // 6. Audit trail — a deletion of a financial-adjacent file is worth recording.
  try {
    await logAuditAction({
      userId: user.id,
      action: "document.deleted",
      entityType: "document",
      entityId: documentId,
      oldValue: { file_name: doc.file_name, doc_type: doc.doc_type, path: "bank_statement_delete" },
      ipAddress: getClientIP(req),
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({ ok: true, ...(storageWarning ? { warning: "storage_orphan" } : {}) });
}