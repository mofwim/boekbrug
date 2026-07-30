// src/app/api/bank/ignore/route.ts
// [BANK-IGNORE] Ignore / restore an unmatched bank transaction.
//
// Some transactions never need an invoice in BoekBrug — fixed costs paid by
// standing order (rent, a lease/loan instalment, a personal transfer). They sit
// in the "Geen factuur" tab forever and nag the owner. This lets the owner say
// "this one is fine, hide it" without inventing a fake invoice.
//
// Storage: we reuse the EXISTING bank_transactions.status value 'not_found'
//   (already allowed by the CHECK constraint: pending | matched | not_found),
//   so there is NO migration. Meaning in this app:
//     pending    → still in the active matching list ("Geen factuur"/"Te bevestigen")
//     not_found  → owner-ignored: hidden from active matching, shown in "Genegeerd"
//     matched    → linked to an invoice
//   /api/bank/match only reads status='pending', so an ignored row disappears
//   from the active list automatically. Nothing is deleted (Bewaarplicht) and
//   the original statement still reaches the accountant via passthrough — this
//   only hides the row from the owner's matching screen.
//
// Pure status flip, user-pinned. No invoice side effects, so the B.4 trigger is
// not involved; the pipeline (service_role) is fine and is scoped to user_id.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction } from "@/lib/audit";
import { createPipelineClient } from "@/lib/supabase-pipeline";

export async function POST(req: NextRequest) {
  // 1. Auth
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Body: which transaction, and ignore vs restore.
  let transactionId: string | undefined;
  let action: string | undefined;
  try {
    const body = await req.json();
    transactionId = body?.transactionId;
    action = body?.action; // 'ignore' | 'restore'
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!transactionId || (action !== "ignore" && action !== "restore")) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const pipeline = createPipelineClient();

  // 3. Ownership + current state. The user must own the row.
  const { data: tx, error: txErr } = await pipeline
    .from("bank_transactions")
    // [BANK-IGNORE-AUDIT] Also read what the line IS, so the audit row can identify it after
    // delete-statement has hard-deleted the row it points at.
    .select("id, status, user_id, date, amount, counterpart_name, description")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (txErr) {
    return NextResponse.json({ error: "tx_lookup_failed", detail: txErr.message }, { status: 500 });
  }
  if (!tx) {
    return NextResponse.json({ error: "transaction_not_found" }, { status: 404 });
  }

  // A matched transaction is settled — don't let ignore/restore touch it.
  if (tx.status === "matched") {
    return NextResponse.json({ error: "transaction_already_matched" }, { status: 409 });
  }

  // ignore: pending → not_found.  restore: not_found → pending.
  const from = action === "ignore" ? "pending" : "not_found";
  const to = action === "ignore" ? "not_found" : "pending";

  // Idempotent / already-in-target → treat as success (no-op).
  if (tx.status === to) {
    return NextResponse.json({ ok: true, status: to });
  }
  if (tx.status !== from) {
    return NextResponse.json({ error: "unexpected_state", status: tx.status }, { status: 409 });
  }

  const { error: updErr } = await pipeline
    .from("bank_transactions")
    .update({ status: to })
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .eq("status", from); // guard against a concurrent change

  if (updErr) {
    return NextResponse.json({ error: "update_failed", detail: updErr.message }, { status: 500 });
  }

  // [BANK-IGNORE-AUDIT] Log AFTER the guarded write, so the row records a change that really
  // happened. Ignoring pulls the line out of the matcher, auto-confirm, auto-categorize, the
  // nightly sweep and every categorize read at once, and it deletes that line's
  // [VOORBELASTING-RISK] warning (undocumentedCount is pending-scoped) — the widest-reaching
  // one-tap disposition in this folder, and until now the only bank action leaving no trace.
  // The snapshot travels with it: the line itself can be destroyed later by delete-statement,
  // and "which line was this" must survive that.
  await logAuditAction({
    userId: user.id,
    action: action === "ignore" ? "bank.ignored" : "bank.restored",
    entityType: "bank_transaction",
    entityId: transactionId,
    oldValue: { status: from },
    newValue: {
      status: to,
      tx_date: tx.date ?? null,
      tx_amount: tx.amount ?? null,
      tx_counterpart: tx.counterpart_name ?? null,
      tx_description: tx.description ?? null,
    },
  });

  return NextResponse.json({ ok: true, status: to });
}