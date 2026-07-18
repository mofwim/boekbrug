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
import { invoiceIdsForTransactions, invoicesClaimedByOtherTx, clearPaymentLinks } from "@/lib/bank-tx-links";
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
    .select("id, user_id, invoice_id, status, reference, amount")
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
    // [PARTIAL-PAY] Also read amount_paid + total + payment_date so we can undo the EXACT amount
    // this payment applied (an instalment), not force the whole invoice back to unpaid.
    .select("id, direction, status, accountant_status, amount_paid, total_inc_btw, payment_date")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json({ error: "verwerkt" }, { status: 409 });
  }

  // [PARTIAL-PAY] How much did THIS payment apply to the invoice? The per-link amount_applied is
  // authoritative; fall back to the tx magnitude for a pre-migration link (amount_applied NULL).
  // Undoing a payment lowers amount_paid by exactly this — so an invoice fully paid by two
  // instalments drops back to "€400 van €1000" when you unlink the second one, not to fully unpaid.
  const { data: linkRow } = await pipeline
    .from("bank_tx_invoices")
    .select("amount_applied")
    .eq("transaction_id", transactionId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  const appliedAmount = Math.abs(Number(linkRow?.amount_applied ?? tx.amount ?? 0));
  const priorPaid = Math.max(0, Number(inv.amount_paid ?? 0));
  const newPaid = Math.max(0, priorPaid - appliedAmount);

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

  // 4. Restore the invoice. SESSION client so the B.4 trigger has auth context. incoming →
  //    'received', else 'sent'. 'overdue' is never stored (recomputed from due_date), and
  //    'processing' invoices are excluded from matching (isEligible), so by construction the
  //    prior open status was received/sent — restoring by direction is exact, not a guess.
  //
  //    [PARTIAL-PAY] Two cases:
  //      (a) the invoice was fully 'paid' → removing this payment un-completes it: back to the
  //          open status, amount_paid lowered by this payment's share. If instalments remain
  //          (newPaid > 0) it becomes a partial-open invoice again and keeps its first-instalment
  //          date + payment_method; if nothing remains it is a clean unpaid invoice (dates cleared).
  //      (b) the invoice was already partial-open (never 'paid') → status is untouched; we only
  //          lower amount_paid (to 0 when this was its only instalment).
  const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
  const stillHasPayment = newPaid > 0;
  if (inv.status === "paid") {
    const { error: payErr } = await supabase
      .from("invoices")
      .update({
        status: restoredStatus,
        amount_paid: newPaid,
        payment_method: stillHasPayment ? "bank" : null,
        marked_paid_at: null,
        payment_date: stillHasPayment ? inv.payment_date : null,
      })
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
  } else if (priorPaid > 0) {
    // Partial-open invoice: status stays open; just lower the running total by this instalment.
    const { error: payErr } = await supabase
      .from("invoices")
      .update({
        amount_paid: newPaid,
        payment_method: stillHasPayment ? "bank" : null,
        payment_date: stillHasPayment ? inv.payment_date : null,
      })
      .eq("id", invoiceId);
    if (payErr) {
      await pipeline
        .from("bank_transactions")
        .update({ status: tx.status, invoice_id: invoiceId })
        .eq("id", transactionId)
        .eq("user_id", user.id);
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
  }

  // [BANK-TX-INVOICES] The bank line is detached but the row survives (status pending), so the FK
  // cascade does NOT fire — clear the join row explicitly so a re-book starts from a clean index.
  await clearPaymentLinks(pipeline, user.id, transactionId);

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
  tx: { invoice_id: string | null; status: string | null; amount: number | null };
  refNums: string[];
}): Promise<NextResponse> {
  const { pipeline, payClient, userId, transactionId, tx, refNums } = args;
  const linkedInvoiceId = tx.invoice_id;
  if (!linkedInvoiceId) return NextResponse.json({ error: "not_linked" }, { status: 409 });

  // [BANK-TX-INVOICES] The reversal set is built id-first, number-second, so it is BOTH
  // collision-free AND complete:
  //  (1) the exact invoice ids this transaction paid, recorded in the join table at booking time —
  //      reversing by id can only ever touch the invoices this payment actually paid, never an
  //      unrelated invoice that shares a number (numbers are not unique across suppliers/directions).
  //  (2) GAP-FILL: a PRE-migration batch only backfilled its representative id (the migration can't
  //      reconstruct the older siblings). For any reference number NOT already covered by an id-link,
  //      we fall back to a number match — GUARDED to the batch's direction so a same-number invoice
  //      of the opposite direction is never wrongly un-paid (the MED-3 collision). A freshly-booked
  //      batch is fully id-covered, so (2) adds nothing for it → no number-collision surface at all.
  const linkIds = await invoiceIdsForTransactions(pipeline, userId, [transactionId]);
  const idSet = new Set(linkIds);
  idSet.add(linkedInvoiceId); // the linked representative is always part of the batch

  // The user's paid-by-bank invoices (owner-pinned). We resolve the batch from these in code.
  const { data: paidRows, error: invErr } = await pipeline
    .from("invoices")
    .select("id, invoice_number, direction, status, accountant_status, marked_paid_at, payment_date")
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq("status", "paid")
    .eq("payment_method", "bank");
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  const paid = paidRows ?? [];

  // (1) exact id-linked part
  const byId = new Map<string, (typeof paid)[number]>();
  for (const inv of paid) if (idSet.has(inv.id)) byId.set(inv.id, inv);
  // (2) direction-guarded number gap-fill for reference numbers no id-link covers.
  //     Direction = the representative invoice's direction, or (if it is no longer paid-by-bank —
  //     e.g. re-marked cash — so `rep` is undefined) the bank movement's sign, so the gap-fill can
  //     never silently disable itself. A null/zero amount with no representative → skip (we don't
  //     guess a direction). A batch is one supplier/customer → exactly one direction.
  const rep = paid.find((i) => i.id === linkedInvoiceId);
  const signDir: "incoming" | "outgoing" | null =
    (tx.amount ?? 0) < 0 ? "incoming" : (tx.amount ?? 0) > 0 ? "outgoing" : null;
  const batchDir = (rep?.direction as "incoming" | "outgoing" | null) ?? signDir;
  const coveredNums = new Set<string>();
  for (const inv of byId.values()) coveredNums.add(normalizeRef(inv.invoice_number ?? ""));
  const uncovered = new Set(refNums.filter((n) => !coveredNums.has(n)));
  if (batchDir && uncovered.size > 0) {
    // Candidates: paid-by-bank invoices in the batch direction whose number is an uncovered ref
    // number. Exclude any that are id-linked to ANOTHER transaction — those provably belong to a
    // different payment (a same-number stray), never to this batch. Only a genuinely un-linked
    // pre-migration sibling survives the exclusion.
    const candidates = paid.filter(
      (inv) => inv.direction === batchDir && uncovered.has(normalizeRef(inv.invoice_number ?? "")),
    );
    const claimed = await invoicesClaimedByOtherTx(pipeline, userId, candidates.map((c) => c.id), [transactionId]);
    for (const inv of candidates) if (!claimed.has(inv.id)) byId.set(inv.id, inv);
  }
  const batch = [...byId.values()];

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
  // [MED-2] Re-pay restores the ORIGINAL marked_paid_at + payment_date, not just paid/bank, so a
  // rollback never loses the settlement date (which attributes the payment to the right quarter).
  const restored: { id: string; marked_paid_at: string | null; payment_date: string | null }[] = [];
  for (const inv of batch) {
    const restoredStatus = inv.direction === "incoming" ? "received" : "sent";
    const { error: payErr } = await payClient
      .from("invoices")
      .update({ status: restoredStatus, payment_method: null, marked_paid_at: null, payment_date: null })
      .eq("id", inv.id)
      .eq("status", "paid");
    if (payErr) {
      for (const r of restored) {
        await payClient
          .from("invoices")
          .update({ status: "paid", payment_method: "bank", marked_paid_at: r.marked_paid_at, payment_date: r.payment_date })
          .eq("id", r.id)
          .neq("status", "paid");
      }
      await pipeline.from("bank_transactions").update({ status: tx.status ?? "matched", invoice_id: linkedInvoiceId }).eq("id", transactionId).eq("user_id", userId);
      if (payErr.message?.toLowerCase().includes("verwerkt")) return NextResponse.json({ error: "verwerkt" }, { status: 409 });
      return NextResponse.json({ error: "restore_failed", detail: payErr.message }, { status: 500 });
    }
    restored.push({ id: inv.id, marked_paid_at: inv.marked_paid_at, payment_date: inv.payment_date });
  }

  // [BANK-TX-INVOICES] Row survives the detach (status pending) → clear its join rows explicitly.
  await clearPaymentLinks(pipeline, userId, transactionId);

  await logAuditAction({
    userId,
    action: "bank.unlinked",
    entityType: "bank_transaction",
    entityId: transactionId,
    newValue: { transaction_id: transactionId, invoice_ids: restored.map((r) => r.id), invoice_count: restored.length, batch: true },
  });

  return NextResponse.json({ ok: true, batch: true, restored: restored.length });
}
