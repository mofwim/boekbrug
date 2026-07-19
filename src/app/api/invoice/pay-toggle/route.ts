// src/app/api/invoice/pay-toggle/route.ts
// [PAY-TOGGLE] The server-authoritative "mark paid" / "undo paid" for a manually-handled invoice
// (the Crediteuren + Facturen "Betaald" toggle). It replaces the old direct client-side write for
// two audited-truth reasons the audit surfaced:
//   [16] every money mutation must be AUDITED — the client write left no audit row.
//   [15] an UNDO of a bank-matched invoice must DETACH its bank transaction — the client toggle
//        undid the invoice side only, stranding the tx as 'matched' (invoice payable a second time,
//        the payment unreachable to re-link). Here the undo runs the same reversal the /bank/unlink
//        path does: detach the tx → pending, clear the join rows, recompute amount_paid.
// The invoice status write uses the SESSION client so the B.4 'verwerkt' trigger fires with a real
// auth.uid(); bank/join writes + audit use the service-role pipeline.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { clearPaymentLinks } from "@/lib/bank-tx-links";
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { logAuditAction, getClientIP } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { invoiceId?: string; action?: string; paymentMethod?: string; paymentDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const invoiceId = body.invoiceId;
  const action = body.action;
  if (!invoiceId || (action !== "pay" && action !== "undo")) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // Ownership + state. The user must own the invoice (sender OR receiver).
  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    .select("id, invoice_number, status, direction, accountant_status, sender_id, receiver_id")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
  }

  const isIncoming = inv.direction === "incoming";

  if (action === "pay") {
    const paymentMethod = body.paymentMethod === "kas" ? "kas" : "bank";
    const paymentDate = typeof body.paymentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate)
      ? body.paymentDate : new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("invoices")
      .update({
        status: "paid", payment_method: paymentMethod,
        marked_paid_at: new Date().toISOString(), payment_date: paymentDate,
        payment_prepared_at: null,
      })
      .eq("id", invoiceId)
      .neq("status", "paid")
      .select("id");
    if (error) {
      if (error.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      return NextResponse.json({ error: "pay_failed", detail: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });

    await logAuditAction({
      userId: user.id, action: "invoice.status_changed", entityType: "invoice", entityId: invoiceId,
      oldValue: { status: inv.status }, newValue: { status: "paid", payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle" },
      ipAddress: getClientIP(req),
    });
    // Keep the kasboek in sync when paid in cash (create/heal the 'betaling' entry). Best-effort.
    try { await reconcileCashSettlements(supabase, user.id); } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true, status: "paid" });
  }

  // ── action === 'undo' ──────────────────────────────────────────────────────
  // [BANK-UNLINK] If a bank transaction is matched to this invoice, DETACH it first so we never
  // leave a paid-undone invoice beside a still-'matched' tx (which the pending-only matcher could
  // never resurface). Cover both the direct invoice_id link and any bank_tx_invoices join rows.
  const linkedTxIds = new Set<string>();
  const { data: directTx } = await pipeline
    .from("bank_transactions").select("id").eq("user_id", user.id).eq("invoice_id", invoiceId).eq("status", "matched");
  for (const t of directTx ?? []) if (t.id) linkedTxIds.add(t.id);
  const { data: joinRows } = await pipeline
    .from("bank_tx_invoices").select("transaction_id").eq("user_id", user.id).eq("invoice_id", invoiceId);
  for (const r of joinRows ?? []) if (r.transaction_id) linkedTxIds.add(r.transaction_id);

  for (const txId of linkedTxIds) {
    await pipeline.from("bank_transactions")
      .update({ status: "pending", invoice_id: null })
      .eq("id", txId).eq("user_id", user.id);
    await clearPaymentLinks(pipeline, user.id, txId);
  }
  // Reconcile amount_paid from surviving links (0 once all are cleared). Atomic + best-effort.
  try { await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId }); } catch { /* non-fatal */ }

  const restoredStatus = isIncoming ? "received" : "sent";
  const { error: undoErr } = await supabase
    .from("invoices")
    .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null, payment_prepared_at: null })
    .eq("id", invoiceId)
    .eq("status", "paid");
  if (undoErr) {
    if (undoErr.message?.toLowerCase().includes("verwerkt")) {
      return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
    }
    return NextResponse.json({ error: "undo_failed", detail: undoErr.message }, { status: 500 });
  }

  await logAuditAction({
    userId: user.id, action: "invoice.status_changed", entityType: "invoice", entityId: invoiceId,
    oldValue: { status: "paid" }, newValue: { status: restoredStatus, via: "manual_undo_toggle", detached_transactions: [...linkedTxIds] },
    ipAddress: getClientIP(req),
  });
  try { await reconcileCashSettlements(supabase, user.id); } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true, status: restoredStatus, detached: linkedTxIds.size });
}
