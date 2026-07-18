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
// Deleting a statement is a TRUE UNDO of that import: before removing the file it reverses the
// statement's own bookings — restores every invoice it paid to unpaid, then deletes exactly this
// statement's transactions (via the statement_document_id link), including the pos_income lines
// whose card-commission is a live read. This closes the old wrong-number gap (a re-import used to
// ADD corrected lines on top of the stranded originals → doubled omzet + commission) and the
// reversibility gap (a deleted statement's payments were unreachable to undo). Bewaarplicht rests
// on the INVOICES, which remain; the statement file was a convenience copy. A 'verwerkt' invoice
// blocks the reversal (ask the accountant to undo processing first).
//
// Auth: SESSION client (RLS). The owner deletes their OWN statement only; we
// additionally verify ownership and doc_type explicitly before any delete.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { invoiceIdsForTransactions } from "@/lib/bank-tx-links";
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

  // 3b. [BANK-STATEMENT-DELETE-CASCADE] Reverse this statement's own bookings BEFORE removing it.
  //     Deleting the file used to strand its derived state: paid invoices, matched links, and
  //     pos_income card-commission lived on, pointing at a gone file — and a re-import then ADDED
  //     the corrected lines on top (dedup only skips identical rows) → doubled omzet + commission.
  //     Now a delete is a true "undo this import": restore every invoice this statement paid, then
  //     remove this statement's transactions (incl. pos_income, whose triangle effect is a live
  //     read). The invoices themselves remain — Bewaarplicht is on the invoices, the file was a
  //     convenience copy. Requires the statement_document_id link (bank_tx_statement_link.sql).
  //
  //     [BANK-TX-INVOICES] Which invoices did this statement pay? The AUTHORITATIVE, collision-free
  //     answer is the join table — the exact invoice ids recorded at booking time, reversed by id,
  //     never by invoice NUMBER (numbers are not unique across suppliers/directions, so a
  //     number-based reversal could un-pay an unrelated invoice — a wrong-number event). We also
  //     union the direct tx.invoice_id (a legacy single link the backfill covers) so nothing this
  //     statement paid is missed.
  const pipeline = createPipelineClient();
  const { data: stmtTx } = await pipeline
    .from("bank_transactions")
    .select("id, invoice_id, reference, amount, category")
    .eq("user_id", user.id)
    .eq("statement_document_id", documentId);
  const txs = stmtTx ?? [];
  if (txs.length > 0) {
    const txIds = txs.map((t) => t.id as string);
    const linkIds = await invoiceIdsForTransactions(pipeline, user.id, txIds);
    const reversalIds = new Set<string>(linkIds);
    for (const t of txs) if (t.invoice_id) reversalIds.add(t.invoice_id as string);

    let toRestore: { id: string; direction: string | null; accountant_status: string | null }[] = [];
    if (reversalIds.size > 0) {
      const { data: paidInvs, error: invErr } = await pipeline
        .from("invoices")
        .select("id, direction, status, accountant_status")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .eq("status", "paid")
        .eq("payment_method", "bank")
        .in("id", [...reversalIds]);
      if (invErr) {
        // Never delete a statement while we cannot read what it paid — that would strand paid
        // invoices with no bank line. Abort cleanly; nothing was touched.
        return NextResponse.json({ error: "reversal_lookup_failed", detail: invErr.message }, { status: 500 });
      }
      toRestore = paidInvs ?? [];
    }
    // A 'verwerkt' (accountant-locked) invoice blocks the whole reversal — nothing is touched.
    if (toRestore.some((i) => i.accountant_status === "verwerkt")) {
      return NextResponse.json({ error: "verwerkt", detail: "Een factuur van dit afschrift is al verwerkt door de boekhouder. Vraag eerst om ontwerken." }, { status: 409 });
    }

    // Restore each invoice to unpaid — SESSION client so the B.4 verwerkt trigger has auth context.
    // [HIGH-2] Every write is checked. On the FIRST failure we re-pay what we already restored and
    // abort WITHOUT deleting any transaction, so a failed reversal can never land in the half-state
    // this cascade exists to prevent (a restored invoice beside a still-'matched' bank line, or a
    // paid invoice with its bank line deleted). All-or-nothing, mirroring unlink's discipline.
    const restored: { id: string; direction: string | null }[] = [];
    const repay = async () => {
      for (const r of restored) {
        await supabase
          .from("invoices")
          .update({ status: "paid", payment_method: "bank" })
          .eq("id", r.id)
          .neq("status", "paid");
      }
    };
    for (const inv of toRestore) {
      const { error: restoreErr } = await supabase
        .from("invoices")
        .update({ status: inv.direction === "incoming" ? "received" : "sent", payment_method: null, marked_paid_at: null, payment_date: null })
        .eq("id", inv.id)
        .eq("status", "paid");
      if (restoreErr) {
        await repay();
        if (restoreErr.message?.toLowerCase().includes("verwerkt")) {
          return NextResponse.json({ error: "verwerkt", detail: "Een factuur van dit afschrift is al verwerkt door de boekhouder. Vraag eerst om ontwerken." }, { status: 409 });
        }
        return NextResponse.json({ error: "reversal_failed", detail: restoreErr.message }, { status: 500 });
      }
      restored.push({ id: inv.id, direction: inv.direction });
    }

    // [MED-3] Audit snapshot BEFORE the destructive delete — record exactly which transactions
    // (incl. the pos_income lines whose card-commission is a live read) and which invoices this
    // reversal touched, so the deletion is reconstructable from the trail, not just observed.
    try {
      await logAuditAction({
        userId: user.id,
        action: "bank.unlinked",
        entityType: "document",
        entityId: documentId,
        newValue: {
          reversed_invoice_ids: restored.map((r) => r.id),
          removed_transaction_ids: txIds,
          removed_transactions: txs.length,
          pos_income_lines: txs.filter((t) => t.category === "pos_income").length,
          reason: "statement_deleted_cascade",
        },
        ipAddress: getClientIP(req),
      });
    } catch { /* non-blocking */ }

    // Remove this statement's transactions — clears the linked lines AND the pos_income lines that
    // feed the card triangle (their join rows cascade via the FK), so the deleted statement
    // contributes nothing to the result anymore. If the delete fails after we've un-paid the
    // invoices, re-pay them so we never leave unpaid invoices beside still-'matched' bank lines.
    const { error: delTxErr } = await pipeline
      .from("bank_transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("statement_document_id", documentId);
    if (delTxErr) {
      await repay();
      return NextResponse.json({ error: "transaction_delete_failed", detail: delTxErr.message }, { status: 500 });
    }
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