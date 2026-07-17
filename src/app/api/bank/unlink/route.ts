// src/app/api/bank/unlink/route.ts
// [BANK-UNLINK] Undo a confirmed bank↔invoice match — the reverse of /api/bank/confirm.
// "Quiet by default" means the app books near-certain payments on its own; that is only
// trustworthy if the owner can undo any single booking. This detaches the bank line and
// puts the invoice back to unpaid, so a wrong auto-booking is one tap to reverse.
//
// Scope: SINGLE-invoice transactions (reference lists ≤ 1 invoice number) — exactly the set
// auto-confirm books. A multi-invoice batch is not unlinked here (its per-slot state is more
// involved); it is refused with a clear message.
//
// Guards mirror confirm: owner-pinned, and a 'verwerkt' invoice (the accountant already
// processed it, B.4) is refused — you must ask the accountant to undo processing first.
// BTW/omzet are on accrual (invoice date), so this only resets the paid/linked status.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { parseReferenceNumbers } from "@/lib/bank-matching";
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

  // Multi-invoice batches are out of scope for a one-tap unlink.
  if (parseReferenceNumbers(tx.reference).length > 1) {
    return NextResponse.json({ error: "multi_invoice_unlink_unsupported" }, { status: 409 });
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

  // 3. Restore the invoice to unpaid. SESSION client so the B.4 trigger has auth context.
  //    Only touch a still-'paid' invoice (idempotent). incoming → 'received', else 'sent'.
  const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
  if (inv.status === "paid") {
    const { error: payErr } = await supabase
      .from("invoices")
      .update({ status: restoredStatus, payment_method: null, marked_paid_at: null })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (payErr) {
      if (payErr.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      }
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
  }

  // 4. Detach the bank line → back to pending, no invoice_id.
  const { error: unlinkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "pending", invoice_id: null })
    .eq("id", transactionId)
    .eq("user_id", user.id);
  if (unlinkErr) {
    return NextResponse.json({ error: "unlink_failed", detail: unlinkErr.message }, { status: 500 });
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
