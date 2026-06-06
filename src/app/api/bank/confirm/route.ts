// src/app/api/bank/confirm/route.ts
// [BOEK-016] Confirm a bank match (phase 4). The HUMAN confirms; this executes.
//
// Writes two things, in legal-priority order:
//   (a) invoice → status 'paid' + payment_method 'bank' + marked_paid_at   (reuses B.3 semantics)
//   (b) bank_transactions → status 'matched' + invoice_id                  (new for B.16)
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
import { isEligible } from "@/lib/bank-matching";

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
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, status, user_id, amount")
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
  const { error: payErr } = await supabase
    .from("invoices")
    .update({
      status: "paid",
      payment_method: "bank", // known from a bank match — no Bank/Contant question
      marked_paid_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .neq("status", "paid"); // idempotent: don't re-pay / reset marked_paid_at on double-submit

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

  // 5. Write (b): link the transaction. Pipeline (no trigger), user_id pinned.
  //    Failure here does NOT roll back the (legally complete) payment.
  const { error: linkErr } = await pipeline
    .from("bank_transactions")
    .update({ status: "matched", invoice_id: invoiceId })
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", "pending"); // only pending → matched; never overwrite an existing link

  if (linkErr) {
    console.error("[BOEK-016] transaction link failed after payment:", linkErr.message);
    return NextResponse.json({ ok: true, warning: "transaction_link_failed" });
  }

  // 6. Notification (non-blocking) — notifications inserts use service_role by rule.
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

  return NextResponse.json({ ok: true });
}