// src/app/api/bank/auto-confirm/route.ts
// [BANK-AUTO-CONFIRM] "Quiet by default": the app books the NEAR-CERTAIN payments itself so
// the owner isn't chasing hundreds of one-tap confirms. It only ever touches matches that
// pass isSafeAutoConfirm (invoice number printed in the statement AND the amount matches to
// the cent, single invoice, not an instalment) — the same 0.97 match the UI would pre-select
// for a one-tap "betaald". Everything ambiguous stays for the human.
//
// Money discipline is identical to /api/bank/confirm, per match:
//   - invoice → 'paid' via the SESSION client (so the B.4 verwerkt trigger fires),
//   - the pay write .select()s so a CONCURRENT payment (0 rows) is skipped, never re-owned,
//   - bank_transactions → 'matched' + invoice_id via the pipeline (single invoice ⇒ covered),
//   - a link failure rolls the invoice back to its prior status (no orphaned paid invoice).
// Fully reversible (the owner can unlink), and every booking is audited for a review trail.
// BTW/omzet/kosten are on accrual (invoice date) so this changes ONLY the paid/linked status.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  matchTransactions,
  isSafeAutoConfirm,
  isEligible,
  type InvoiceForMatching,
} from "@/lib/bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "@/lib/bank-import";
import { logAuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();

  // Same inputs as /api/bank/match, so the safe set is exactly what the UI would call 'auto'.
  const txRows = await fetchAllRows((from, to) =>
    pipeline
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name, reference, invoice_id, status")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const invRows = await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .neq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (txRows.length === 0 || invRows.length === 0) {
    return NextResponse.json({ ok: true, confirmed: [], count: 0 });
  }

  const transactions = (txRows as BankTransactionDbRow[]).map((r) => rowToTransaction(r));
  const invoices = invRows as InvoiceForMatching[];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const result = matchTransactions(transactions, invoices);

  const safe = result.matches.filter(isSafeAutoConfirm);

  const confirmed: Array<{ transactionId: string; invoiceId: string; invoiceNumber: string | null; amount: number }> = [];

  for (const m of safe) {
    const txId = m.transaction.transactionId;
    const invoiceId = m.best?.invoiceId;
    if (!txId || !invoiceId) continue;
    const inv = invById.get(invoiceId);
    if (!inv) continue;

    // Defense-in-depth: re-check the same invariants the confirm route enforces.
    if (!isEligible(m.transaction, inv)) continue;

    // (a) invoice → paid (SESSION client; .select detects a concurrent pay → 0 rows → skip).
    const { data: payData, error: payErr } = await supabase
      .from("invoices")
      .update({ status: "paid", payment_method: "bank", marked_paid_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .neq("status", "paid")
      .select("id");
    if (payErr) continue; // verwerkt/RLS/other — leave it for the human, don't fail the batch
    if (!payData || payData.length === 0) continue; // concurrently paid — not ours to link

    // (b) link the bank line → matched (single invoice ⇒ fully covered). Pipeline, user-pinned.
    const { error: linkErr } = await pipeline
      .from("bank_transactions")
      .update({ status: "matched", invoice_id: invoiceId })
      .eq("id", txId)
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (linkErr) {
      // Roll the invoice back so we never leave a paid invoice with no bank line.
      await supabase
        .from("invoices")
        .update({ status: inv.status, payment_method: null, marked_paid_at: null })
        .eq("id", invoiceId)
        .eq("status", "paid");
      continue;
    }

    confirmed.push({
      transactionId: txId,
      invoiceId,
      invoiceNumber: inv.invoice_number,
      amount: m.transaction.amount ?? 0,
    });
    await logAuditAction({
      userId: user.id,
      action: "bank.auto_confirmed",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: { transaction_id: txId, invoice_number: inv.invoice_number, amount: m.transaction.amount ?? 0, reason: "near_certain_reference_amount" },
    });
  }

  return NextResponse.json({ ok: true, confirmed, count: confirmed.length });
}
