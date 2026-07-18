// src/app/api/bank/unlink/route.ts
// [BANK-UNLINK] Undo a confirmed bank↔invoice match — the reverse of /api/bank/confirm.
// "Quiet by default" means the app books near-certain payments on its own; that is only
// trustworthy if the owner can undo any single booking. This detaches the bank line and
// puts the invoice back to unpaid, so a wrong auto-booking is one tap to reverse.
//
// Scope: BOTH single-invoice and multi-invoice batch payments. A single line detaches + restores
// its one invoice; a batch (reference lists >1 number, auto-booked or manually multi-confirmed)
// is reversed as a whole via unlinkBatch — every invoice this payment paid goes back to unpaid.
// Auto-booking is only trustworthy if EVERYTHING it books is one tap to undo, batches included.
//
// Guards mirror confirm: owner-pinned, and a 'verwerkt' invoice (the accountant already
// processed it, B.4) is refused — you must ask the accountant to undo processing first.
// BTW/omzet are on accrual (invoice date), so this only resets the paid/linked status.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { parseReferenceNumbers, normalizeRef } from "@/lib/bank-matching";
import { logAuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transactionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const transactionId = body.transactionId;
  if (!transactionId) return NextResponse.json({ error: "missing_transaction" }, { status: 400 });

  const pipeline = createPipelineClient();

  // 1. The transaction — owner-pinned. Must currently be linked to an invoice.
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, user_id, invoice_id, status, reference")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) return NextResponse.json({ error: "transaction_lookup_failed", detail: txErr.message }, { status: 500 });
  if (!tx) return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  if (!tx.invoice_id) return NextResponse.json({ error: "not_linked" }, { status: 409 });

  // [BANK-BATCH-UNLINK] A multi-invoice batch (auto-booked by runBankAutoConfirm or manually
  // multi-confirmed) is reversed as a WHOLE: every invoice whose number is in this payment's
  // reference and is currently paid-by-bank is put back to unpaid, and the bank line detached.
  // Without this, an auto-booked batch would be irreversible — violating the "everything the app
  // books, the owner can undo" rule that makes quiet auto-booking trustworthy.
  const refNums = parseReferenceNumbers(tx.reference);
  if (refNums.length > 1) {
    return unlinkBatch({ pipeline, payClient: supabase, userId: user.id, transactionId, tx, refNums });
  }

  // 2. The invoice — need its direction (to restore the right unpaid status) and the
  //    verwerkt guard.
  const invoiceId = tx.invoice_id as string;
  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    .select("id, direction, status, accountant_status")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json({ error: "verwerkt" }, { status: 409 });
  }

  // 3. Detach the bank line FIRST → back to pending, no invoice_id. Order matters: if the
  //    invoice restore (step 4) then fails we roll THIS back, so we never end on the worse
  //    half-state the reviewer flagged — a restored (unpaid) invoice with a bank line still
  //    'matched' pointing at it, which the matcher (pending-only) would never resurface.
  //    Only detach OUR link (invoice_id guard) so a concurrent re-link is never clobbered.
  const { data: detachData, error: unlinkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "pending", invoice_id: null })
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId)
    .select("id");
  if (unlinkErr) {
    return NextResponse.json({ error: "unlink_failed", detail: unlinkErr.message }, { status: 500 });
  }
  // [BANK-UNLINK-RACE] A 0-row detach (no error) means the tx was re-linked away from this
  // invoice between our fetch and this write. We must NOT then un-pay the invoice — its bank
  // line was never detached here, so restoring it would leave an inconsistent state. Bail as a
  // conflict; nothing was changed, so the owner can safely retry once the state settles.
  if (!detachData || detachData.length === 0) {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  // 4. Restore the invoice to unpaid. SESSION client so the B.4 trigger has auth context.
  //    Only touch a still-'paid' invoice (idempotent). incoming → 'received', else 'sent'.
  //    'overdue' is never stored (recomputed from due_date), and 'processing' invoices are
  //    excluded from matching (isEligible), so by construction the prior status was
  //    received/sent — restoring by direction is exact, not a guess.
  //    Also clear payment_date (confirm/auto-confirm set it) so no stale settlement date lingers.
  const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
  if (inv.status === "paid") {
    const { error: payErr } = await supabase
      .from("invoices")
      .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (payErr) {
      // Restore failed → re-link the bank line to its captured prior state so we don't leave
      // a detached line beside a still-paid invoice. Then surface the reason.
      await pipeline
        .from("bank_transactions")
        .update({ status: tx.status, invoice_id: invoiceId })
        .eq("id", transactionId)
        .eq("user_id", user.id);
      if (payErr.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      }
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
  }

  await logAuditAction({
    userId: user.id,
    action: "bank.unlinked",
    entityType: "invoice",
    entityId: invoiceId,
    newValue: { transaction_id: transactionId, restored_status: restoredStatus },
  });

  return NextResponse.json({ ok: true });
}

// [BANK-BATCH-UNLINK] Reverse a whole multi-invoice batch: put every invoice this payment paid
// back to unpaid and detach the bank line. The batch's invoices are exactly the ones, owned by
// this user and currently paid-by-bank, whose number appears in the payment's reference — the
// same reference-coverage identity the manual confirm + auto-book used to create the batch.
async function unlinkBatch(args: {
  pipeline: ReturnType<typeof createPipelineClient>;
  payClient: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  transactionId: string;
  tx: { invoice_id: string | null; status: string | null };
  refNums: string[];
}): Promise<NextResponse> {
  const { pipeline, payClient, userId, transactionId, tx, refNums } = args;
  const linkedInvoiceId = tx.invoice_id;
  if (!linkedInvoiceId) return NextResponse.json({ error: "not_linked" }, { status: 409 });
  const refSet = new Set(refNums);

  // The batch's paid invoices (owner-pinned). Filter to the referenced numbers in code so a
  // number that resolves to several rows, or an unrelated same-number invoice, is handled by the
  // exact normalized match — never a substring.
  const { data: paidRows, error: invErr } = await pipeline
    .from("invoices")
    .select("id, invoice_number, direction, status, accountant_status")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq("status", "paid")
    .eq("payment_method", "bank");
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  const batch = (paidRows ?? []).filter((i) => refSet.has(normalizeRef(i.invoice_number ?? "")));

  // A 'verwerkt' invoice anywhere in the batch blocks the whole reversal (accrual is locked by the
  // accountant) — refuse before touching anything.
  if (batch.some((i) => i.accountant_status === "verwerkt")) {
    return NextResponse.json({ error: "verwerkt" }, { status: 409 });
  }

  // Detach the bank line FIRST (same ordering as the single path), guarded to OUR link so a
  // concurrent re-link is never clobbered. A 0-row detach → the link moved under us → conflict.
  const { data: detachData, error: unlinkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "pending", invoice_id: null })
    .eq("id", transactionId)
    .eq("user_id", userId)
    .eq("invoice_id", linkedInvoiceId)
    .select("id");
  if (unlinkErr) return NextResponse.json({ error: "unlink_failed", detail: unlinkErr.message }, { status: 500 });
  if (!detachData || detachData.length === 0) return NextResponse.json({ error: "conflict" }, { status: 409 });

  // Restore each invoice to unpaid (idempotent via .eq('status','paid')). On any failure, re-pay
  // what we already restored and re-link the bank line, so we never leave a half-reversed batch.
  const restored: string[] = [];
  for (const inv of batch) {
    const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
    const { error: payErr } = await payClient
      .from("invoices")
      .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null })
      .eq("id", inv.id)
      .eq("status", "paid");
    if (payErr) {
      for (const rid of restored) {
        await payClient.from("invoices").update({ status: "paid", payment_method: "bank" }).eq("id", rid).neq("status", "paid");
      }
      await pipeline.from("bank_transactions").update({ status: tx.status ?? "matched", invoice_id: linkedInvoiceId }).eq("id", transactionId).eq("user_id", userId);
      if (payErr.message?.toLowerCase().includes("verwerkt")) return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
    restored.push(inv.id);
  }

  await logAuditAction({
    userId,
    action: "bank.unlinked",
    entityType: "bank_transaction",
    entityId: transactionId,
    newValue: { transaction_id: transactionId, invoice_ids: restored, invoice_count: restored.length, batch: true },
  });

  return NextResponse.json({ ok: true, batch: true, restored: restored.length });
}
