// src/app/api/bank/confirm/route.ts
// [BOEK-016] Confirm a bank match (phase 4). The HUMAN confirms; this executes.
// [BANK-MULTI-CONFIRM] One transaction can cover SEVERAL invoices (a supplier
//   combines two invoices in one transfer; the bank's reference then lists both
//   numbers, e.g. "26302050, 26302362"). Confirming ONE invoice must NOT hide the
//   transaction while another listed invoice is still unpaid. So:
//     - We always pay + link the confirmed invoice (as before).
//     - We only flip the transaction to 'matched' when EVERY number in the
//       reference has a paid invoice owned by this user in the right direction
//       (allCovered). Otherwise the transaction stays 'pending' so it remains in
//       "Te bevestigen" with the open numbers still actionable.
//   No amount arithmetic gates the hide decision (decision: amount is for display
//   confidence, never a subset-sum reconciliation). allCovered = presence check only.
//
// Writes two things, in legal-priority order:
//   (a) invoice → status 'paid' + payment_method 'bank' + marked_paid_at   (reuses B.3 semantics)
//   (b) bank_transactions → status 'matched' + invoice_id                  (only when allCovered)
//
// Atomicity: Supabase has no REST transaction. We write (a) first (legally the important one).
// If (b) fails, we DO NOT roll back (a) — same philosophy as B.11 ("email failure does not
// block invoice completion"). The only possible half-state is invoice=paid + tx=pending, which
// is benign and self-healing (re-running /api/bank/match surfaces it again). A true-atomic RPC
// can replace the two writes later if desired (no rollback gaps in Dutch tax law).
//
// ⚠️ CRITICAL: the invoice UPDATE uses the SESSION client, never the pipeline (service_role).
//    The verwerkt guard trigger early-returns when auth.uid() IS NULL, so a service_role write
//    would SILENTLY BYPASS the B.4 Conflict Guard. The session client sets auth.uid() → guard fires.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [BANK-MULTI-LINK-PERSIST] Coverage logic (parseReferenceNumbers + isFullyCovered)
// now lives in bank-matching.ts so this confirm path and the match path share ONE
// definition — no drift between "is this tx done?" answered in two places.
import { isEligible, normalizeRef, isFullyCovered, parseReferenceNumbers } from "@/lib/bank-matching";
import { recordPaymentLinks } from "@/lib/bank-tx-links";
import { logAuditAction } from "@/lib/audit";

export async function POST(req: NextRequest) {
  // 1. Auth
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Body
  let transactionId: string | undefined;
  let invoiceId: string | undefined;
  try {
    const body = await req.json();
    transactionId = body?.transactionId;
    invoiceId = body?.invoiceId;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!transactionId || !invoiceId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // 3. Ownership + state checks (point 3): the user must own BOTH rows.
  //    [BANK-MULTI-CONFIRM] Also fetch `reference` (the expected invoice numbers)
  //    so we can decide allCovered after the payment.
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, user_id, amount, reference, date")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }
  if (tx.status !== "pending") {
    return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
  }

  const { data: inv, error: invErr } = await pipeline
    .from("invoices")
    .select("id, invoice_number, status, accountant_status, sender_id, receiver_id, direction, total_inc_btw")
    .eq("id", invoiceId)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .maybeSingle();
  if (invErr) {
    return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  }
  if (!inv) {
    return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  }
  if (inv.status === "paid") {
    return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
  }
  // Pre-empt B.4 (the trigger is the real guard, but fail fast with a clear signal for the UI).
  if (inv.accountant_status === "verwerkt") {
    return NextResponse.json(
      { error: "verwerkt", invoiceNumber: inv.invoice_number },
      { status: 409 }
    );
  }

  // Defense-in-depth: the write path must enforce the SAME invariants the matcher used to
  // produce the suggestion. Reusing isEligible() (single source of truth) blocks a buggy or
  // crafted client from paying a draft/archived invoice, or pairing a credit with an incoming
  // invoice / a debit with an outgoing one. Legitimate confirmations always pass this.
  const eligible = isEligible(
    {
      date: "",
      amount: tx.amount ?? 0,
      currency: "EUR",
      description: "",
      counterpartName: null,
      counterpartIban: null,
      reference: null,
      transactionId: tx.id,
      rawLine: "",
    },
    {
      id: inv.id,
      invoice_number: inv.invoice_number,
      total_inc_btw: null,
      invoice_date: null,
      due_date: null,
      client_name: null,
      direction: (inv.direction ?? null) as "outgoing" | "incoming" | null,
      status: inv.status,
      accountant_status: inv.accountant_status,
    }
  );
  if (!eligible) {
    return NextResponse.json({ error: "not_eligible" }, { status: 409 });
  }

  // [PARTIAL-PAY] Single-invoice case → the atomic apply_bank_payment RPC. It applies
  // LEAST(payment, remaining), so a payment SMALLER than the invoice balance is recorded as a
  // DEELBETALING — the invoice stays openstaand with the remaining tracked (amount_paid), instead
  // of the old behaviour that flipped it to fully 'paid' on the first instalment (a wrong number).
  // It only flips to 'paid' when the instalments together cover the total. The whole payment is
  // allocated to this one invoice (one tx → one invoice), so the tx is fully consumed → matched.
  // A MULTI-number reference (a batch: one payment listing several invoice numbers) keeps the
  // existing full-coverage flow below — partial batches are out of scope. Session client so the
  // B.4 verwerkt trigger has auth context (the RPC also re-checks verwerkt under its row lock).
  const refNumbers = parseReferenceNumbers(tx.reference);
  if (refNumbers.length <= 1) {
    const payAmount = Math.abs(tx.amount ?? 0);
    if (payAmount <= 0) {
      return NextResponse.json({ error: "not_eligible" }, { status: 409 });
    }
    const { data: applyRows, error: applyErr } = await supabase.rpc("apply_bank_payment", {
      p_user_id: user.id,
      p_tx_id: transactionId,
      p_invoice_id: invoiceId,
      p_amount: payAmount,
      p_pay_date: tx.date ?? null,
    });
    if (applyErr) {
      if (applyErr.message?.toLowerCase().includes("verwerkt")) {
        return NextResponse.json({ error: "verwerkt", invoiceNumber: inv.invoice_number }, { status: 409 });
      }
      if (applyErr.message?.toLowerCase().includes("already fully paid")) {
        return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
      }
      return NextResponse.json({ error: "payment_failed", detail: applyErr.message }, { status: 500 });
    }
    // Empty result ⇒ the tx was claimed by a concurrent confirm/auto-book between our checks and
    // the RPC's lock (its mutex re-read saw status ≠ 'pending'). Nothing was written — 409, retryable.
    const row = Array.isArray(applyRows) ? (applyRows[0] as { applied: number; amount_paid: number; total: number; is_paid: boolean } | undefined) : undefined;
    if (!row) {
      return NextResponse.json({ error: "transaction_already_processed" }, { status: 409 });
    }
    const isPaid = row.is_paid === true;
    const remaining = Math.max(0, (row.total ?? 0) - (row.amount_paid ?? 0));
    // [BANK-TX-INVOICES] The RPC already wrote the join row (with amount_applied) inside its
    // transaction — no recordPaymentLinks needed here.
    try {
      await pipeline.from("notifications").insert({
        user_id: user.id,
        title: isPaid ? "Factuur betaald" : "Deelbetaling geboekt",
        body: isPaid
          ? `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`
          : `Deelbetaling van € ${row.applied.toFixed(2)} geboekt op factuur ${inv.invoice_number ?? ""}. Nog openstaand: € ${remaining.toFixed(2)}.`,
        type: "payment",
      });
    } catch {
      /* non-blocking */
    }
    await logAuditAction({
      userId: user.id,
      action: isPaid ? "bank.confirmed" : "bank.partial_payment",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: {
        transaction_id: transactionId,
        invoice_number: inv.invoice_number,
        applied: row.applied,
        amount_paid: row.amount_paid,
        total: row.total,
        remaining,
        fully_paid: isPaid,
      },
    });
    // allCovered = the TRANSACTION is done (fully consumed by this invoice); `partial` tells the UI
    // the INVOICE still has a balance so it can show "€X van €Y · €Z openstaand".
    return NextResponse.json({ ok: true, allCovered: true, partial: !isPaid, applied: row.applied, remaining });
  }

  // 4. Write (a): invoice → paid. SESSION client so the verwerkt trigger fires (auth.uid() set).
  //    Never write `shared` (GENERATED) or 'voldaan' (UI-only).
  const { data: payData, error: payErr } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      payment_method: "bank", // known from a bank match — no Bank/Contant question
      marked_paid_at: new Date().toISOString(),
      // [PARTIAL-PAY] This multi-number-batch branch pays the invoice in FULL, so amount_paid must
      // reach the total — otherwise an invoice that was mid-instalment and is now completed via a
      // batch would keep a stale amount_paid < total. Openstaand is status-gated (paid ⇒ 0) so this
      // is only an internal-consistency fix, but it keeps amount_paid honest for a later unlink.
      amount_paid: Math.abs(inv.total_inc_btw ?? 0),
      // [BANK-PAYDATE] The REAL settlement date is the bank line's date, not now(). A Q1
      // invoice paid in Q2 must carry its true payment day/quarter so the owner and the
      // accountant both see "paid in Q2" — the cross-quarter case, recorded not guessed.
      payment_date: tx.date,
    })
    .eq("id", invoiceId)
    .neq("status", "paid") // idempotent: don't re-pay / reset marked_paid_at on double-submit
    .select("id"); // [BANK-PAY-RACE] know whether THIS request actually paid it

  if (payErr) {
    // B.4 trigger rejection surfaces here → let the UI show the "vraag boekhouder" dialog.
    if (payErr.message && payErr.message.toLowerCase().includes("verwerkt")) {
      return NextResponse.json(
        { error: "verwerkt", invoiceNumber: inv.invoice_number },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "payment_failed", detail: payErr.message }, { status: 500 });
  }

  // [BANK-PAY-RACE] The idempotent .neq("status","paid") no-ops (0 rows, no error) if a
  // CONCURRENT request paid this invoice between our fetch and this write. We must NOT then
  // treat the payment as ours — otherwise a later link failure would roll back a payment we
  // didn't make. Zero rows updated ⇒ someone else already paid it: bail like the pre-check,
  // never proceed to link or rollback.
  if (!payData || payData.length === 0) {
    return NextResponse.json({ error: "invoice_already_paid" }, { status: 409 });
  }

  // 5. [BANK-MULTI-CONFIRM] Decide allCovered: is EVERY invoice number listed in
  //    the transaction's reference now backed by a PAID invoice this user owns, in
  //    the direction the transaction's sign implies? Presence check only — no
  //    amount arithmetic (decision: amount informs display, never the hide gate).
  //
  //    - 0 or 1 reference number → single-invoice case: this confirmation completes
  //      it. allCovered = true (the existing single-invoice flow is unchanged).
  //    - >1 reference number → multi case: fetch this user's PAID invoices in the
  //      correct direction, normalize their numbers, and require that every
  //      reference number maps to one. A number with no paid invoice (not uploaded
  //      yet, or uploaded-but-unconfirmed) keeps allCovered=false → tx stays pending.
  //    (refNumbers computed above for the single-vs-multi branch; reused here.)
  let allCovered = true;

  if (refNumbers.length > 1) {
    // Direction the bank movement implies (mirrors isEligible's sign guard):
    //   credit (amount > 0) → outgoing invoices (a customer paid us)
    //   debit  (amount < 0) → incoming invoices (we paid a supplier)
    const requiredDirection: "outgoing" | "incoming" =
      (tx.amount ?? 0) > 0 ? "outgoing" : "incoming";

    const { data: paidRows, error: paidErr } = await pipeline
      .from("invoices")
      .select("invoice_number")
      .eq("status", "paid")
      .eq("direction", requiredDirection)
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

    if (paidErr) {
      // Don't fail the (completed) payment over a coverage read. Be conservative:
      // treat as not fully covered so the tx STAYS visible — never hide on doubt.
      console.error("[BANK-MULTI-CONFIRM] coverage lookup failed:", paidErr.message);
      allCovered = false;
    } else {
      const paidSet = new Set(
        (paidRows ?? [])
          .map((r) => normalizeRef(r.invoice_number ?? ""))
          .filter((n) => n.length > 0)
      );
      // [BANK-MULTI-LINK-PERSIST] Shared coverage rule (equality, not substring).
      allCovered = isFullyCovered(tx.reference, paidSet);
    }
  }

  // 6. Write (b): link the transaction. Pipeline (no trigger), user_id pinned.
  //    [BANK-MULTI-CONFIRM] Only flip to 'matched' when allCovered. Otherwise keep
  //    it 'pending' and just record invoice_id (the most recent link) so the tx
  //    remains in the active list with the open numbers still actionable.
  //    Failure here does NOT roll back the (legally complete) payment.
  const linkUpdate = allCovered
    ? { status: "matched" as const, invoice_id: invoiceId }
    : { invoice_id: invoiceId };

  const { data: linkData, error: linkErr } = await pipeline
    .from("bank_transactions")
    .update(linkUpdate)
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending") // only touch a still-pending tx; never overwrite a matched link
    .select("id"); // [BANK-LINK-RACE] know whether the link actually landed (0 rows ⇒ tx grabbed)

  if (linkErr) {
    console.error("[BOEK-016] transaction link failed after payment:", linkErr.message);
    // [BANK-LINK-ROLLBACK] The payment write succeeded but the bank link did not. Leaving
    // the invoice 'paid' with no linked bank line ORPHANS it: the matcher excludes paid
    // invoices, so the tx reappears as "geen factuur" and can never be re-confirmed
    // (invoice_already_paid). Roll the invoice back to its prior status so the state stays
    // consistent and the owner can simply retry — never a paid invoice with no proof.
    const { error: rollbackErr } = await supabase
      .from("invoices")
      .update({ status: inv.status, payment_method: null, marked_paid_at: null, payment_date: null })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (rollbackErr) {
      console.error("[BANK-LINK-ROLLBACK] rollback also failed:", rollbackErr.message);
    }
    return NextResponse.json(
      { error: "transaction_link_failed", detail: linkErr.message, rolledBack: !rollbackErr },
      { status: 500 }
    );
  }

  // [BANK-LINK-RACE] A 0-row link with NO error means a concurrent confirm grabbed the tx
  // between our fetch and this write (the .eq("status","pending") no longer matched). For a
  // SINGLE-invoice tx the bank line is the ONLY proof of this payment, so a silent no-op would
  // orphan our paid invoice exactly like a hard link error — roll it back so the owner can
  // retry. For a MULTI-invoice batch the payment stands on its own (our invoice is genuinely
  // one of the listed numbers) and the tx stays visible for the remaining numbers, so a no-op
  // there is benign and self-healing — we do not roll back a correctly-paid batch invoice.
  if ((!linkData || linkData.length === 0) && refNumbers.length <= 1) {
    const { error: rollbackErr } = await supabase
      .from("invoices")
      .update({ status: inv.status, payment_method: null, marked_paid_at: null, payment_date: null })
      .eq("id", invoiceId)
      .eq("status", "paid");
    if (rollbackErr) {
      console.error("[BANK-LINK-RACE] rollback after 0-row link also failed:", rollbackErr.message);
    }
    return NextResponse.json(
      { error: "transaction_already_processed", rolledBack: !rollbackErr },
      { status: 409 }
    );
  }

  // [BANK-TX-INVOICES] Record this (transaction → invoice) so a later reversal reverses by id, not
  // by number. A multi-invoice batch is confirmed one invoice per call, so successive confirms
  // accumulate every paid invoice onto the same tx here — the full, collision-free reversal set.
  await recordPaymentLinks(pipeline, user.id, transactionId, [invoiceId]);

  // 7. Notification (non-blocking) — notifications inserts use service_role by rule.
  try {
    await pipeline.from("notifications").insert({
      user_id: user.id,
      title: "Factuur betaald",
      body: `Factuur ${inv.invoice_number ?? ""} is gekoppeld aan een banktransactie en gemarkeerd als betaald.`,
      type: "payment",
    });
  } catch {
    /* non-blocking */
  }

  // [BANK-MULTI-CONFIRM] Return allCovered so the UI knows whether this transaction
  // is now fully done (→ Gekoppeld) or still has open numbers (→ stays in Te bevestigen).
  return NextResponse.json({ ok: true, allCovered });
}