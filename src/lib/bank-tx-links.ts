// src/lib/bank-tx-links.ts
// [BANK-TX-INVOICES] One place to read/write the payment ↔ invoice join table (bank_tx_invoices).
// EVERY booking path records the exact invoices a transaction paid here; EVERY reversal path reads
// them back and reverses by invoice_id — never by invoice number — so a reversal can only ever
// touch the invoices this payment actually paid (invoice numbers are not unique across suppliers /
// directions).
//
// [LINKS-WRITE-HONEST] THIS FILE USED TO SAY the join row is "the reversal index, not a money
// figure", and that a write failure is harmless because tx.invoice_id + status stay the
// money-truth. Both halves stopped being true, and the sentence is what justified swallowing the
// error:
//
//   · [PARTIAL-PAY] (see recordPaymentLinks below) recompute_invoice_amount_paid re-derives
//     invoices.amount_paid as SUM(coalesce(amount_applied,0)) over an invoice's surviving links,
//     on every unlink and every undo. A link that was never written counts as ZERO — so an
//     invoice really settled by this payment silently re-opens at its full total.
//   · [BANK-COVERAGE-BY-MONEY] /api/bank/match decides whether a bank line is FINISHED from these
//     rows. Without them the line is not measurable, the route falls back to counting invoice
//     numbers in the bank reference, and a line carrying any token that is not a paid invoice
//     number (a customer number, an order number, a POS batch counter) never leaves "Te
//     bevestigen". Confirming it again returns 409, the client reads that as done and re-fetches,
//     and the card comes straight back — the unbreakable loop bank-matching.ts describes.
//
// And the swallow could not have worked even when the claim was true: supabase-js does NOT throw
// on a query error — it returns `{ error }` — so `try { await … } catch {}` caught nothing and
// discarded the error object. A failed write left no log, no trace, and no symptom until the
// owner met a card they could not clear. The read half of this file was fixed for exactly this
// reason (see invoiceIdsForTransactions below); the write half was not.
//
// Still non-blocking: a booking is legally complete without the index row, and failing the request
// would leave the owner worse off. Non-blocking is not the same as unspoken — both writes now log
// the failure with the ids, and both return whether the row landed, so /api/bank/confirm (the one
// place an owner is standing and waiting) can say the booking is not fully recorded instead of
// answering "Bevestigd ✓" over a card that is about to come straight back.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsForIds } from "./supabase-paginate";
/**
 * [DEPLOY-SAFE] Is this failure "the join table is not there yet" rather than "the read broke"?
 *
 * The distinction matters because the two functions below THROW on a read error, and a deployment
 * whose bank_tx_invoices migration has not run yet must not turn every unlink into a 500. A
 * missing table is not an unknown: it means there are NO links, which is a real and complete
 * answer. Everything else (a timeout, a 414, a permissions error) stays a refusal, because there
 * the links may well exist and we simply could not see them.
 *
 * The rule itself moved to pg-missing.ts once a second caller needed it (the VAT-basis read):
 * two copies of "which errors may be treated as an empty answer" is exactly the kind of thing
 * that drifts apart quietly.
 */
import { isMissingRelation as isMissingTable } from "./pg-missing";
import { round2 } from "./invoice-totals";
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
): Promise<boolean> {
  const rows = [...new Set(invoiceIds.filter(Boolean))].map((invoice_id) => {
    const applied = amountApplied?.[invoice_id];
    return {
      user_id: userId,
      transaction_id: transactionId,
      invoice_id,
      amount_applied:
        typeof applied === "number" && Number.isFinite(applied) && applied > 0
          ? round2(applied)
          : null,
    };
  });
  if (rows.length === 0) return true;
  // [LINKS-WRITE-HONEST] The error is READ. supabase-js does not throw, so the try/catch this
  // replaced could never fire — it only kept the surrounding await from rejecting on a network
  // fault, and dropped the query error on the floor. See the header for what that costs.
  try {
    const { error } = await client
      .from("bank_tx_invoices")
      .upsert(rows, { onConflict: "transaction_id,invoice_id" });
    if (error) {
      console.error("[BANK-TX-INVOICES] payment link NOT recorded", {
        transactionId, invoiceIds: rows.map((r) => r.invoice_id), message: error.message,
      });
      return false;
    }
    return true;
  } catch (e) {
    // A genuine throw (network, aborted fetch). Same answer, same visibility.
    console.error("[BANK-TX-INVOICES] payment link write threw", { transactionId, error: e });
    return false;
  }
}

/**
 * Remove the links for one transaction (e.g. when it is unlinked). The FK also cascades on a hard
 * tx delete, so this is for the unlink-but-keep-the-row case.
 *
 * [LINKS-WRITE-HONEST] Its failure is the mirror of the one above and just as quiet: the links
 * SURVIVE a reversal, so recompute_invoice_amount_paid keeps counting amount_applied for money
 * that was given back, and the invoice stays "paid" for an amount no longer on any bank line.
 * Reported for the same reason, and returned so a caller can say what really happened.
 */
export async function clearPaymentLinks(client: Client, userId: string, transactionId: string): Promise<boolean> {
  try {
    const { error } = await client
      .from("bank_tx_invoices").delete().eq("user_id", userId).eq("transaction_id", transactionId);
    if (error) {
      console.error("[BANK-TX-INVOICES] payment links NOT cleared", { transactionId, message: error.message });
      return false;
    }
    return true;
  } catch (e) {
    console.error("[BANK-TX-INVOICES] payment link clear threw", { transactionId, error: e });
    return false;
  }
}

/**
 * The exact invoice ids `transactionIds` paid, from the join table. This is the AUTHORITATIVE,
 * collision-free reversal set.
 *
 * [LINKS-READ-HONEST] THROWS on a read failure — it does not answer "no links".
 *
 * It used to swallow the error and return `[]`, and the two answers are not interchangeable:
 * every caller is a REVERSAL path that decides, from this list, which invoices to put back to
 * unpaid. "No links" makes unlink take the single-invoice branch for a real batch (it routes on
 * `linkedIds.length > 1`) and makes delete-statement's reversal set collapse to the direct
 * tx.invoice_id — after which both detach the bank line and clear the join rows anyway. The
 * result is the exact state their own headers say must never exist: an invoice left paid with
 * no bank line, unreachable to undo and invisible on every screen.
 *
 * Worse, the try/catch that produced the `[]` could never even fire: supabase-js reports a query
 * error as `{ data: null, error }` and does not throw, so `data ?? []` turned every failure —
 * including a 414 from an oversized `.in()` list — into a confident empty answer.
 *
 * Refusing loudly is the only safe answer here: a reversal that cannot read what it must reverse
 * has to abort, not guess. Callers surface it and the owner retries.
 */
export async function invoiceIdsForTransactions(
  client: Client,
  userId: string,
  transactionIds: string[],
): Promise<string[]> {
  const ids = transactionIds.filter(Boolean);
  if (ids.length === 0) return [];
  // [IN-CHUNK] Chunked + paged: a statement can hold thousands of transactions, and both the
  // ~1000-row cap and the URL length would otherwise truncate this list without a word.
  let rows: { invoice_id: string }[];
  try {
    rows = await fetchAllRowsForIds<{ invoice_id: string }, string>(ids, (chunk, from, to) =>
      client
        .from("bank_tx_invoices")
        .select("invoice_id")
        .eq("user_id", userId)
        .in("transaction_id", chunk)
        .order("id", { ascending: true }) // bank_tx_invoices.id is the PK — invoice_id is NOT unique (two payments can settle one invoice), so paging on it could repeat or skip a link row
        .range(from, to),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTable(message)) return []; // no table ⇒ genuinely no links, not an unknown
    throw e;
  }
  return [...new Set(rows.map((r) => r.invoice_id).filter(Boolean))];
}

/**
 * Of `invoiceIds`, which are id-linked to some transaction NOT in `exceptTransactionIds`? Those
 * invoices provably belong to a DIFFERENT payment, so a number-based gap-fill (used to recover a
 * pre-migration batch's un-linked siblings) must NOT sweep them up — that would un-pay an invoice
 * this payment never paid (a same-number stray owned by another tx). A genuine pre-migration
 * sibling has NO id-link at all, so it is never in this "claimed elsewhere" set and passes through.
 *
 * [LINKS-READ-HONEST] THROWS on a read failure, for the same reason as invoiceIdsForTransactions
 * — and here the direction of the mistake is worse. This is an EXCLUSION list, so an empty answer
 * does not narrow the reversal, it WIDENS it. Returning an empty set on error let every
 * same-number candidate through the guard, so a stray invoice belonging to a completely different
 * payment could be un-paid — the exact MED-3 collision this function exists to prevent. A guard
 * that fails open is not a guard.
 */
export async function invoicesClaimedByOtherTx(
  client: Client,
  userId: string,
  invoiceIds: string[],
  exceptTransactionIds: string[],
): Promise<Set<string>> {
  const ids = invoiceIds.filter(Boolean);
  if (ids.length === 0) return new Set();
  const except = new Set(exceptTransactionIds);
  let rows: { invoice_id: string; transaction_id: string }[];
  try {
    rows = await fetchAllRowsForIds<{ invoice_id: string; transaction_id: string }, string>(
      ids,
      (chunk, from, to) =>
        client
          .from("bank_tx_invoices")
          .select("invoice_id, transaction_id")
          .eq("user_id", userId)
          .in("invoice_id", chunk)
          .order("id", { ascending: true }) // bank_tx_invoices.id is the PK — invoice_id is NOT unique (two payments can settle one invoice), so paging on it could repeat or skip a link row
          .range(from, to),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTable(message)) return new Set(); // no table ⇒ nothing is claimed anywhere
    throw e;
  }
  const claimed = new Set<string>();
  for (const r of rows) if (!except.has(r.transaction_id)) claimed.add(r.invoice_id);
  return claimed;
}
