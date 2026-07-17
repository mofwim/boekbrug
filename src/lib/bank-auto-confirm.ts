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
      .select("id, date, amount, description, counterpart_name, reference, invoice_id, status")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const invRows = await fetchAllRows((from, to) =>
    pipeline
      .from("invoices")
      .select("id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status")
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

    confirmed.push({ transactionId: txId, invoiceId, invoiceNumber: inv.invoice_number, amount: m.transaction.amount ?? 0 });
    await logAuditAction({
      userId,
      action: "bank.auto_confirmed",
      entityType: "invoice",
      entityId: invoiceId,
      newValue: { transaction_id: txId, invoice_number: inv.invoice_number, amount: m.transaction.amount ?? 0, reason: "near_certain_reference_amount" },
    });
  }

  return confirmed;
}
