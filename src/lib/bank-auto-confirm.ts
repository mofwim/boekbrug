// src/lib/bank-auto-confirm.ts
// [BANK-AUTO-CONFIRM-CORE] The server-side safe-set pass, extracted so the circle closes from
// ANY entry point — the /bank page, an invoice verify, a bank IMPORT, and a background cron —
// not only when a browser happens to sit on /dashboard/bank. It books ONLY isSafeAutoConfirm
// matches (invoice number printed in the statement AND amount to the cent, single invoice) —
// the same 0.97 identity the UI would pre-select — so moving it server-side changes WHERE it
// runs, never WHAT it books. Fully reversible (owner can unlink) and audited.
//
// payClient vs pipeline: the invoice→'paid' write goes through `payClient`. A ROUTE passes its
// SESSION client, so the DB 'verwerkt' guard trigger fires with a real auth.uid(); a CRON or a
// server IMPORT (no session) passes the service-role `pipeline`, where the app-level isEligible
// check below is the authoritative guard (it already rejects a 'verwerkt' invoice). The bank
// line link + all reads always use the service-role `pipeline` (user-pinned by user_id).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import {
  matchTransactions,
  isSafeAutoConfirm,
  isEligible,
  type InvoiceForMatching,
} from "./bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "./bank-import";
import { planBatchAutoConfirm, type BatchCandidateInvoice } from "./bank-batch-reconcile";
import { recordPaymentLinks } from "./bank-tx-links";
import { logAuditAction } from "./audit";

export interface AutoConfirmed {
  transactionId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayClient = SupabaseClient<any>;

/**
 * Book every near-certain (transaction, invoice) match for one user. Idempotent + safe to call
 * repeatedly: it only ever touches `pending` transactions and non-`paid` invoices, re-checks the
 * confirm-route invariants per match, and rolls the invoice back on a link race so it never
 * leaves a paid invoice with no bank line. Returns the bookings made (empty if none).
 */
export async function runBankAutoConfirm(args: {
  payClient: PayClient;
  pipeline: PipelineClient;
  userId: string;
}): Promise<AutoConfirmed[]> {
  const { payClient, pipeline, userId } = args;

  const txRows = await fetchAllRows((from, to) =>
    pipeline
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name, counterpart_iban, reference, invoice_id, status")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const invRows = await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .neq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (txRows.length === 0 || invRows.length === 0) return [];

  const transactions = (txRows as BankTransactionDbRow[]).map((r) => rowToTransaction(r));
  const invoices = invRows as InvoiceForMatching[];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const result = matchTransactions(transactions, invoices);
  const safe = result.matches.filter(isSafeAutoConfirm);

  const confirmed: AutoConfirmed[] = [];
  for (const m of safe) {
    const txId = m.transaction.transactionId;
    const invoiceId = m.best?.invoiceId;
    if (!txId || !invoiceId) continue;
    const inv = invById.get(invoiceId);
    if (!inv) continue;

    // Defense-in-depth: the same invariants the confirm route enforces (incl. accountant
    // 'verwerkt' exclusion) — authoritative when payClient is service_role (no DB trigger).
    if (!isEligible(m.transaction, inv)) continue;

    // (a) invoice → paid. .select() detects a concurrent pay (0 rows) → skip, never re-own.
    //     [BANK-PAYDATE] the real settlement date is the bank line's date (cross-quarter safe).
    const { data: payData, error: payErr } = await payClient
      .from("invoices")
      .update({ status: "paid", payment_method: "bank", marked_paid_at: new Date().toISOString(), payment_date: m.transaction.date || null })
      .eq("id", invoiceId)
      .neq("status", "paid")
      .select("id");
    if (payErr) continue; // verwerkt/RLS/other — leave for the human, don't fail the batch
    if (!payData || payData.length === 0) continue; // concurrently paid — not ours to link

    // (b) link the bank line → matched (single invoice ⇒ fully covered). 0 rows ⇒ roll back.
    const { data: linkData, error: linkErr } = await pipeline
      .from("bank_transactions")
      .update({ status: "matched", invoice_id: invoiceId })
      .eq("id", txId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id");

    if (linkErr || !linkData || linkData.length === 0) {
      await payClient
        .from("invoices")
        .update({ status: inv.status, payment_method: null, marked_paid_at: null, payment_date: null })
        .eq("id", invoiceId)
        .eq("status", "paid");
      continue;
    }

    // [BANK-TX-INVOICES] Record the exact invoice this payment paid so a later reversal
    // (unlink / delete-statement) reverses by id, never by number. Best-effort — the money-truth
    // is the tx.invoice_id + invoice.status above; this row is only the collision-free undo index.
    await recordPaymentLinks(pipeline, userId, txId, [invoiceId]);

    confirmed.push({ transactionId: txId, invoiceId, invoiceNumber: inv.invoice_number, amount: m.transaction.amount ?? 0 });
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: { transaction_id: txId, invoice_number: inv.invoice_number, amount: m.transaction.amount ?? 0, reason: "near_certain_reference_amount" },
    });
  }

  // ── [BANK-BATCH] Automatic booking of unambiguous MULTI-invoice batches ──────────────────
  // The 1:1 pass above deliberately skips any payment that settles several invoices (a wholesaler
  // batching a week of deliveries into one debit — the common case for a shop). Those never
  // auto-reconciled and piled up as manual work. Book the provably-exact ones here using the SAME
  // tie-logic as the manual UI (planBatchAutoConfirm → reconcileBatch "ties"): every referenced
  // number resolves to exactly one unpaid invoice of the right direction, one supplier, and the
  // gross sum equals the debit to the cent. A short-payment (mismatch) or a not-yet-imported
  // invoice (incomplete) returns null and stays for the human. Same reversibility + audit.
  const bookedInvoiceIds = new Set(confirmed.map((c) => c.invoiceId));
  const bookedTxIds = new Set(confirmed.map((c) => c.transactionId));
  for (const row of txRows as BankTransactionDbRow[]) {
    const txId = row.id;
    if (!txId || row.status !== "pending" || row.invoice_id || bookedTxIds.has(txId)) continue;

    // Candidates exclude anything already booked this run, so two batches can't claim one invoice.
    const candidates = invoices.filter((i) => !bookedInvoiceIds.has(i.id)) as BatchCandidateInvoice[];
    const plan = planBatchAutoConfirm({ reference: row.reference ?? null, bankAmount: row.amount ?? null, invoices: candidates });
    if (!plan) continue;

    const planInvs = plan.invoiceIds.map((id) => invById.get(id)).filter((x): x is InvoiceForMatching => !!x);
    if (planInvs.length !== plan.invoiceIds.length) continue;
    const tx = rowToTransaction(row);
    if (!planInvs.every((inv) => isEligible(tx, inv))) continue; // accountant-'verwerkt' + invariants

    // [BANK-BATCH-ATOMIC] Book the whole tie in ONE database transaction via book_bank_batch.
    // The RPC locks the bank line FIRST (the mutex), re-verifies every invoice is still unpaid +
    // not accountant-'verwerkt' under that lock, then pays them all, links the tx, and records the
    // join rows — all-or-nothing. This closes the concurrent half-rollback the multi-statement
    // path had: two overlapping runs over the same batch tx could leave one invoice unpaid while
    // the tx showed 'matched' (and never retried). Now the loser blocks on the lock and gets an
    // EMPTY result → skips. If any invoice turned unpayable in the window the whole batch aborts
    // (error) and nothing is written. Reversal index (bank_tx_invoices) is written INSIDE the txn.
    //
    // Outcomes: rows returned ⇒ booked · empty (no error) ⇒ tx already claimed by a concurrent run
    // ⇒ skip · error ⇒ an invoice is no longer payable (or the migration isn't applied yet) ⇒
    // leave the whole batch for the human. Degrades safely: a missing function just means batches
    // aren't auto-booked until book_bank_batch_atomic.sql is applied.
    const { data: bookedRows, error: batchErr } = await payClient.rpc("book_bank_batch", {
      p_user_id: userId,
      p_tx_id: txId,
      p_invoice_ids: plan.invoiceIds,
      p_pay_date: tx.date || null,
    });
    if (batchErr) continue;                                        // not payable / not applied → skip
    if (!bookedRows || (bookedRows as unknown[]).length === 0) continue; // tx already claimed → skip

    for (const inv of planInvs) {
      confirmed.push({ transactionId: txId, invoiceId: inv.id, invoiceNumber: inv.invoice_number, amount: inv.total_inc_btw ?? 0 });
      bookedInvoiceIds.add(inv.id);
    }
    bookedTxIds.add(txId);
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed_batch",
      entityType: "bank_transaction",
      entityId: txId,
      newValue: { invoice_ids: plan.invoiceIds, invoice_count: plan.invoiceIds.length, amount: row.amount ?? 0, reason: "exact_multi_invoice_batch_tie" },
    });
  }

  return confirmed;
}
