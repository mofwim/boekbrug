// src/lib/bank-tx-links.ts
// [BANK-TX-INVOICES] One place to read/write the payment ↔ invoice join table (bank_tx_invoices).
// EVERY booking path records the exact invoices a transaction paid here; EVERY reversal path reads
// them back and reverses by invoice_id — never by invoice number — so a reversal can only ever
// touch the invoices this payment actually paid (invoice numbers are not unique across suppliers /
// directions). Best-effort by design: the join row is the reversal index, not a money figure, so a
// write failure never blocks a booking (the tx.invoice_id + status remain the money-truth).

import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

/** Record that `transactionId` paid each of `invoiceIds`. Idempotent (unique pair). Best-effort. */
export async function recordPaymentLinks(
  client: Client,
  userId: string,
  transactionId: string,
  invoiceIds: string[],
): Promise<void> {
  const rows = [...new Set(invoiceIds.filter(Boolean))].map((invoice_id) => ({
    user_id: userId,
    transaction_id: transactionId,
    invoice_id,
  }));
  if (rows.length === 0) return;
  try {
    await client.from("bank_tx_invoices").upsert(rows, { onConflict: "transaction_id,invoice_id" });
  } catch {
    /* non-fatal — reversal index only */
  }
}

/** Remove the links for one transaction (e.g. when it is unlinked). Best-effort; the FK also
 *  cascades on a hard tx delete, so this is for the unlink-but-keep-the-row case. */
export async function clearPaymentLinks(client: Client, userId: string, transactionId: string): Promise<void> {
  try {
    await client.from("bank_tx_invoices").delete().eq("user_id", userId).eq("transaction_id", transactionId);
  } catch {
    /* non-fatal */
  }
}

/**
 * The exact invoice ids `transactionIds` paid, from the join table. This is the AUTHORITATIVE,
 * collision-free reversal set. Falls back to nothing on error (caller then keeps a legacy path).
 */
export async function invoiceIdsForTransactions(
  client: Client,
  userId: string,
  transactionIds: string[],
): Promise<string[]> {
  const ids = [...new Set(transactionIds.filter(Boolean))];
  if (ids.length === 0) return [];
  try {
    const { data } = await client
      .from("bank_tx_invoices")
      .select("invoice_id")
      .eq("user_id", userId)
      .in("transaction_id", ids);
    return [...new Set((data ?? []).map((r: { invoice_id: string }) => r.invoice_id).filter(Boolean))];
  } catch {
    return [];
  }
}
