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

// [MANUAL-PARTIAL-PAY] Idempotency keys are uuids — reject anything else rather than
// letting a junk key through as "no key" (which would silently re-enable double booking).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // [MANUAL-PARTIAL-PAY] amount_paid decides whether an undo is allowed on an invoice
    // that is partly settled but still open.
    .select("id, invoice_number, status, direction, accountant_status, sender_id, receiver_id, amount_paid")
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

    // [MANUAL-PARTIAL-PAY] An optional amount turns this into a DEELBETALING. Absent (the
    // empty field — the common case) it means "settle the whole remaining balance", which is
    // exactly what this toggle always did. Rejected here rather than silently coerced: a
    // number we cannot trust must never reach the money path.
    const rawAmount = (body as { amount?: unknown }).amount;
    let payAmount: number | null = null;
    if (rawAmount != null && rawAmount !== "") {
      const parsed = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
      }
      payAmount = Math.round(parsed * 100) / 100;
    }
    // Idempotency key: LEAST() clamps over-payment but does NOT deduplicate, so without
    // this a double tap or a retried POST would book the instalment twice.
    const rawKey = (body as { clientKey?: unknown }).clientKey;
    const clientKey = typeof rawKey === "string" && UUID_RE.test(rawKey) ? rawKey : null;

    // Session client so the B.4 'verwerkt' trigger sees a real auth.uid(); the RPC also
    // re-checks verwerkt AND the payable status under its own row lock.
    const { data: applyRows, error } = await supabase.rpc("apply_manual_payment", {
      p_user_id: user.id,
      p_invoice_id: invoiceId,
      p_amount: payAmount,
      p_pay_date: paymentDate,
      p_method: paymentMethod,
      p_payable_statuses: PAYABLE,
      p_client_key: clientKey,
    });
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (msg.includes("already fully paid") || msg.includes("already covered")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      if (msg.includes("not payable")) {
        return NextResponse.json(
          { error: "not_payable", detail: `status '${inv.status}' kan niet als betaald worden gemarkeerd`, status: inv.status },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "pay_failed", detail: error.message }, { status: 500 });
    }
    const row = Array.isArray(applyRows)
      ? (applyRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean; duplicate: boolean } | undefined)
      : undefined;
    if (!row) return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });

    const fullyPaid = row.is_paid === true;
    const remaining = Math.max(0, Math.round(((row.total ?? 0) - (row.amount_paid ?? 0)) * 100) / 100);

    // A replayed request changed nothing — report the already-booked state, never a second
    // audit row or a second kasboek reconcile.
    if (row.duplicate === true) {
      return NextResponse.json({
        ok: true, status: fullyPaid ? "paid" : inv.status, partial: !fullyPaid,
        applied: row.applied, amountPaid: row.amount_paid, remaining, duplicate: true,
      });
    }

    // Only a COMPLETED payment clears the prepared marker; a partial one leaves the
    // invoice open, so the "Heb je betaald?" CTA must stay where the owner expects it.
    if (fullyPaid) {
      await supabase.from("invoices").update({ payment_prepared_at: null }).eq("id", invoiceId);
    }

    await logAuditAction({
      userId: user.id,
      action: fullyPaid ? "invoice.status_changed" : "invoice.partial_payment",
      entityType: "invoice", entityId: invoiceId,
      oldValue: { status: inv.status, amount_paid_before: Math.max(0, (row.amount_paid ?? 0) - (row.applied ?? 0)) },
      newValue: fullyPaid
        ? { status: "paid", payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle", applied: row.applied }
        : { status: inv.status, applied: row.applied, amount_paid: row.amount_paid, total: row.total, remaining, payment_method: paymentMethod, payment_date: paymentDate, via: "manual_pay_toggle" },
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
  // [MANUAL-PARTIAL-PAY] A PARTLY paid invoice must be undoable too — it is still 'sent' /
  // 'received', so the old `status !== 'paid'` guard made every deelbetaling permanent: one
  // mistyped instalment and the owner could never correct it. Undo is all-or-nothing by
  // design ("Deelbetalingen wissen" resets to zero paid, never half): the join rows for this
  // invoice are all removed below and amount_paid recomputes to 0.
  const paidSoFar = Math.max(0, Number((inv as { amount_paid?: number | null }).amount_paid ?? 0));
  const wasFullyPaid = inv.status === "paid";
  if (!wasFullyPaid && paidSoFar <= 0.005) {
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
  // [MANUAL-PARTIAL-PAY] `id` and the manual columns come along: a manual instalment has
  // transaction_id NULL, so a rollback keyed on (transaction_id, invoice_id) would be
  // meaningless for it — NULLs never conflict, so the upsert would INSERT duplicates and
  // inflate amount_paid. Keyed on the primary key instead, the restore is exact for both
  // kinds of row.
  const { data: myLinkRowsRaw } = await pipeline
    .from("bank_tx_invoices")
    .select("id, transaction_id, amount_applied, paid_on, method, client_key")
    .eq("user_id", user.id)
    .eq("invoice_id", invoiceId);
  const myLinks = (myLinkRowsRaw ?? []) as {
    id: string; transaction_id: string | null; amount_applied: number | null;
    paid_on: string | null; method: string | null; client_key: string | null;
  }[];

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
        // Restore by PRIMARY KEY — see the snapshot comment: a manual row's NULL
        // transaction_id makes the (transaction_id, invoice_id) target useless, and a
        // failed undo would then duplicate instalments instead of restoring them.
        await pipeline.from("bank_tx_invoices").upsert(
          myLinks.map((l) => ({
            id: l.id, user_id: user.id, transaction_id: l.transaction_id,
            invoice_id: invoiceId, amount_applied: l.amount_applied,
            paid_on: l.paid_on, method: l.method, client_key: l.client_key,
          })),
          { onConflict: "id" }
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
  // [MANUAL-PARTIAL-PAY] Two shapes of undo:
  //  · a FULLY paid invoice returns to its open status (unchanged behaviour, and the
  //    `.eq('status','paid')` keeps it race-proof: two undos, only one wins).
  //  · a PARTLY paid one is already open — only the payment traces are wiped. Requiring
  //    status 'paid' there would match zero rows and report a false failure, and the
  //    payment fields (a first instalment stamps payment_date) would linger on an
  //    invoice that is back to nothing-paid.
  // amount_paid itself is already recomputed to 0 by the RPC above, once its links are gone.
  const undoQuery = supabase
    .from("invoices")
    .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null, payment_prepared_at: null })
    .eq("id", invoiceId);
  const { data: undoData, error: undoErr } = await (wasFullyPaid
    ? undoQuery.eq("status", "paid")
    : undoQuery.in("status", isIncoming ? ["received"] : ["sent", "overdue"])
  ).select("id");
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
