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

/**
 * Record that `transactionId` paid each of `invoiceIds`. Idempotent (unique pair). Best-effort.
 *
 * [PARTIAL-PAY] `amountApplied` is NOT optional bookkeeping decoration. Since partial payments
 * exist, recompute_invoice_amount_paid re-derives invoices.amount_paid as
 * SUM(coalesce(amount_applied, 0)) over an invoice's surviving links, and it runs on every
 * unlink and every undo. A link written WITHOUT the amount therefore counts as ZERO the moment
 * anything else on that invoice is reversed: an invoice settled €600 by this payment silently
 * drops to amount_paid 0 and re-opens at its full total, back into the reminder flow, while the
 * bank line still says 'matched' and the €600 really did arrive. This was the only one of the
 * three booking paths that omitted it (apply_bank_payment and book_bank_batch both write it).
 *
 * Pass the amount this transaction applied to each invoice, keyed by invoice id. An id with no
 * entry writes NULL, which is exactly the pre-partial-pay behaviour — only use that for a link
 * whose amount genuinely is not known.
 */
export async function recordPaymentLinks(
  client: Client,
  userId: string,
  transactionId: string,
  invoiceIds: string[],
  amountApplied?: Record<string, number | null | undefined>,
): Promise<void> {
  const rows = [...new Set(invoiceIds.filter(Boolean))].map((invoice_id) => {
    const applied = amountApplied?.[invoice_id];
    return {
      user_id: userId,
      transaction_id: transactionId,
      invoice_id,
      amount_applied:
        typeof applied === "number" && Number.isFinite(applied) && applied > 0
          ? Math.round(applied * 100) / 100
          : null,
    };
  });
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

/**
 * Of `invoiceIds`, which are id-linked to some transaction NOT in `exceptTransactionIds`? Those
 * invoices provably belong to a DIFFERENT payment, so a number-based gap-fill (used to recover a
 * pre-migration batch's un-linked siblings) must NOT sweep them up — that would un-pay an invoice
 * this payment never paid (a same-number stray owned by another tx). A genuine pre-migration
 * sibling has NO id-link at all, so it is never in this "claimed elsewhere" set and passes through.
 * Best-effort: on error returns an empty set (caller then relies on the direction guard alone).
 */
export async function invoicesClaimedByOtherTx(
  client: Client,
  userId: string,
  invoiceIds: string[],
  exceptTransactionIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(invoiceIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const except = new Set(exceptTransactionIds);
  try {
    const { data } = await client
      .from("bank_tx_invoices")
      .select("invoice_id, transaction_id")
      .eq("user_id", userId)
      .in("invoice_id", ids);
    const claimed = new Set<string>();
    for (const r of (data ?? []) as { invoice_id: string; transaction_id: string }[]) {
      if (!except.has(r.transaction_id)) claimed.add(r.invoice_id);
    }
    return claimed;
  } catch {
    return new Set();
  }
}
