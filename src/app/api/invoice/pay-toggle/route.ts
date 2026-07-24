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

  // [PAY-GUARD] 'paid' may only be entered from a genuinely PAYABLE state: a
  // verified incoming Crediteur ('received') or a delivered outgoing invoice
  // ('sent'; stored-'overdue' included defensively for legacy rows). A row in
  // the verify queue ('processing'), a never-sent 'draft', or an 'archived'
  // one must NEVER become paid — that would inject unverified AI-extracted
  // amounts straight into the BTW figures (voorbelasting/omzet count 'paid'),
  // and a later undo would launder it into a verified 'received'/'sent'.
  const PAYABLE = isIncoming ? ["received"] : ["sent", "overdue"];

  if (action === "pay") {
    if (inv.status === "paid") {
      return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
    }
    if (!inv.status || !PAYABLE.includes(inv.status)) {
      return NextResponse.json(
        { error: "not_payable", detail: `status '${inv.status}' kan niet als betaald worden gemarkeerd`, status: inv.status },
        { status: 409 }
      );
    }
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
      // Race-proof mirror of the PAY-GUARD above: the row must STILL be in a
      // payable state at write time, not merely at pre-check time.
      .in("status", PAYABLE)
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
  // [PAY-GUARD] Undo is only meaningful on a PAID invoice. Guarding here also
  // prevents the destructive bank-link detach below from running for a row
  // that was never paid (a stray undo used to silently strip its links).
  if (inv.status !== "paid") {
    return NextResponse.json(
      { error: "not_paid", detail: "alleen een betaalde factuur kan worden teruggezet" },
      { status: 409 }
    );
  }

  // [BANK-UNLINK] If a bank transaction is matched to this invoice, DETACH it so we never leave
  // a paid-undone invoice beside a still-'matched' tx (which the pending-only matcher could
  // never resurface). Cover both the direct invoice_id link and any bank_tx_invoices join rows.
  //
  // [UNDO-SCOPED] Two hardenings over the old blunt detach:
  //  1. SCOPED to this invoice: a tx that also paid OTHER invoices (a batch booked via
  //     book_bank_batch) keeps its status and the siblings' join rows — only OUR link goes.
  //     The old clearPaymentLinks(tx) wiped the whole batch's reversal index and flipped a
  //     still-partially-valid payment back to 'pending'.
  //  2. ROLLBACK on a failed status write (mirrors /api/bank/unlink): the join rows are
  //     snapshotted WITH amount_applied and restored, tx status/invoice_id restored, and
  //     amount_paid recomputed — never "links destroyed but invoice still paid".

  // Snapshot this invoice's join rows (amount_applied included — a rollback must restore it,
  // it is what recompute_invoice_amount_paid sums).
  const { data: myLinkRowsRaw } = await pipeline
    .from("bank_tx_invoices")
    .select("transaction_id, amount_applied")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId);
  const myLinks = (myLinkRowsRaw ?? []) as { transaction_id: string; amount_applied: number | null }[];

  const { data: directTx } = await pipeline
    .from("bank_transactions").select("id").eq("user_id", user.id).eq("invoice_id", invoiceId).eq("status", "matched");

  const linkedTxIds = new Set<string>();
  for (const t of directTx ?? []) if (t.id) linkedTxIds.add(t.id);
  for (const l of myLinks) if (l.transaction_id) linkedTxIds.add(l.transaction_id);

  // Per-tx prior state + "does it also pay other invoices?" (batch detection).
  const txPrev = new Map<string, { status: string | null; invoice_id: string | null; hasOthers: boolean }>();
  for (const txId of linkedTxIds) {
    const [{ data: txRow }, { data: otherRows }] = await Promise.all([
      pipeline.from("bank_transactions").select("status, invoice_id").eq("id", txId).eq("user_id", user.id).maybeSingle(),
      pipeline.from("bank_tx_invoices").select("id").eq("user_id", user.id).eq("transaction_id", txId).neq("invoice_id", invoiceId).limit(1),
    ]);
    if (!txRow) continue;
    txPrev.set(txId, {
      status: (txRow as { status: string | null }).status,
      invoice_id: (txRow as { invoice_id: string | null }).invoice_id,
      hasOthers: (otherRows ?? []).length > 0,
    });
  }

  // Detach — scoped. Batch tx (hasOthers): keep it 'matched' for the siblings, only drop a
  // direct pointer at US. Single-invoice tx: full detach back to 'pending'.
  for (const [txId, prev] of txPrev) {
    if (prev.hasOthers) {
      if (prev.invoice_id === invoiceId) {
        await pipeline.from("bank_transactions").update({ invoice_id: null }).eq("id", txId).eq("user_id", user.id);
      }
    } else {
      await pipeline.from("bank_transactions")
        .update({ status: "pending", invoice_id: null })
        .eq("id", txId).eq("user_id", user.id);
    }
  }
  // Remove ONLY this invoice's join rows (never the whole tx's set).
  await pipeline.from("bank_tx_invoices").delete().eq("user_id", user.id).eq("invoice_id", invoiceId);
  // Reconcile amount_paid from surviving links (0 once all are cleared). Atomic + best-effort.
  try { await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId }); } catch { /* non-fatal */ }

  // [UNDO-SCOPED] Restore the captured bank state — called when the invoice write below fails,
  // so the detach never survives a failed undo. Best-effort (service role).
  const rollbackBankState = async () => {
    try {
      if (myLinks.length > 0) {
        await pipeline.from("bank_tx_invoices").upsert(
          myLinks.map((l) => ({
            user_id: user.id, transaction_id: l.transaction_id,
            invoice_id: invoiceId, amount_applied: l.amount_applied,
          })),
          { onConflict: "transaction_id,invoice_id" }
        );
      }
      for (const [txId, prev] of txPrev) {
        await pipeline.from("bank_transactions")
          .update({ status: prev.status, invoice_id: prev.invoice_id })
          .eq("id", txId).eq("user_id", user.id);
      }
      await pipeline.rpc("recompute_invoice_amount_paid", { p_user_id: user.id, p_invoice_id: invoiceId });
    } catch { /* best-effort */ }
  };

  const restoredStatus = isIncoming ? "received" : "sent";
  const { data: undoData, error: undoErr } = await supabase
    .from("invoices")
    .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null, payment_prepared_at: null })
    .eq("id", invoiceId)
    .eq("status", "paid")
    .select("id");
  if (undoErr) {
    await rollbackBankState();
    if (undoErr.message?.toLowerCase().includes("verwerkt")) {
      return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
    }
    return NextResponse.json({ error: "undo_failed", detail: undoErr.message }, { status: 500 });
  }
  // [PAY-GUARD] Honest zero-row report: if the row raced away from 'paid'
  // between the pre-check and this write, say so instead of claiming success.
  if (!undoData || undoData.length === 0) {
    await rollbackBankState();
    return NextResponse.json({ error: "status_conflict", detail: "factuur is niet (meer) betaald" }, { status: 409 });
  }

  await logAuditAction({
    userId: user.id, action: "invoice.status_changed", entityType: "invoice", entityId: invoiceId,
    oldValue: { status: "paid" }, newValue: { status: restoredStatus, via: "manual_undo_toggle", detached_transactions: [...linkedTxIds] },
    ipAddress: getClientIP(req),
  });
  try { await reconcileCashSettlements(supabase, user.id); } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true, status: restoredStatus, detached: linkedTxIds.size });
}
