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
    .select("id, status, user_id, amount, reference")
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
    .select("id, invoice_number, status, accountant_status, sender_id, receiver_id, direction")
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

  // 4. Write (a): invoice → paid. SESSION client so the verwerkt trigger fires (auth.uid() set).
  //    Never write `shared` (GENERATED) or 'voldaan' (UI-only).
  const { data: payData, error: payErr } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      payment_method: "bank", // known from a bank match — no Bank/Contant question
      marked_paid_at: new Date().toISOString(),
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
  const refNumbers = parseReferenceNumbers(tx.reference);
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

  const { error: linkErr } = await pipeline
    .from("bank_transactions")
    .update(linkUpdate)
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending"); // only touch a still-pending tx; never overwrite a matched link

  if (linkErr) {
    console.error("[BOEK-016] transaction link failed after payment:", linkErr.message);
    // [BANK-LINK-ROLLBACK] The payment write succeeded but the bank link did not. Leaving
    // the invoice 'paid' with no linked bank line ORPHANS it: the matcher excludes paid
    // invoices, so the tx reappears as "geen factuur" and can never be re-confirmed
    // (invoice_already_paid). Roll the invoice back to its prior status so the state stays
    // consistent and the owner can simply retry — never a paid invoice with no proof.
    const { error: rollbackErr } = await supabase
      .from("invoices")
      .update({ status: inv.status, payment_method: null, marked_paid_at: null })
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