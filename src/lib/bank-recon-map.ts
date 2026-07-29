// src/lib/bank-recon-map.ts
// [MATCH-BUTTON] The per-invoice reconciliation MAP builder, extracted from
// GET /api/bank/reconciliation so more than one route can serve the same truth.
//
// Why extracted: the on-demand matcher (POST /api/reconcile/run) has to answer
// "what does the owner still have to look at?" the instant the engine finished.
// Re-deriving that with a second, slightly-different query would let the button's
// summary and the badges on the invoice rows disagree — the exact drift the
// original route's comment warns about ("the badge and the bank page never
// disagree"). One builder, one answer, two callers.
//
// Read-only: writes NOTHING. service_role (pipeline) is safe because every query
// is pinned to the passed userId, exactly like /api/bank/match.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import { matchTransactions, isSafeAutoConfirm, type InvoiceForMatching } from "./bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "./bank-import";
import {
  computeInvoiceReconciliation,
  type InvoiceRecon,
  type ReconLink,
  type ReconSuggestion,
} from "./bank-reconciliation";

export interface InvoiceReconciliationMap {
  /** invoiceId → { linked, pendingMatch }. An absent invoice has no bank relationship. */
  byInvoice: Record<string, InvoiceRecon>;
  /** Unconfirmed bank lines the owner still has (0 ⇒ nothing left for the matcher to chew on). */
  pendingTransactions: number;
  /** Invoices whose payment was FOUND but still needs a human confirm (the review pile). */
  pendingMatchCount: number;
}

/**
 * Compute the invoice-centric reconciliation state for one user.
 *
 * `links` come from bank_transactions rows whose invoice_id is set (any status);
 * `suggestions` from the same matcher the bank page uses (paid invoices are already
 * excluded from the candidate query, so a linked invoice never also shows a match).
 */
export async function buildInvoiceReconciliationMap(args: {
  pipeline: PipelineClient;
  userId: string;
}): Promise<InvoiceReconciliationMap> {
  const { pipeline, userId } = args;

  // 1) Bank lines already linked to an invoice → those invoices are "in bankafschrift".
  //    Paginated (a busy account exceeds the ~1000-row PostgREST cap) and user-pinned.
  const linkRows = await fetchAllRows((from, to) =>
    pipeline
      .from("bank_transactions")
      .select("invoice_id, status")
      .eq("user_id", userId)
      .not("invoice_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const links: ReconLink[] = (linkRows as Array<{ invoice_id: string | null; status: string | null }>)
    .filter((r) => r.invoice_id)
    .map((r) => ({ invoiceId: r.invoice_id as string, txStatus: r.status }));

  // 2) Pending suggestions — same inputs as /api/bank/match, so the badge and the bank
  //    page never disagree. Pending transactions × unpaid candidate invoices.
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
      .select("id, invoice_number, total_inc_btw, amount_paid, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .neq("status", "paid")
      .order("id", { ascending: true })
      .range(from, to),
  );

  let suggestions: ReconSuggestion[] = [];
  if (txRows.length > 0 && invRows.length > 0) {
    const transactions = (txRows as BankTransactionDbRow[]).map((r) => rowToTransaction(r));
    const result = matchTransactions(transactions, invRows as InvoiceForMatching[]);
    suggestions = result.matches.map((m) => ({
      transactionId: m.transaction.transactionId,
      outcome: m.outcome,
      best: m.best ? { invoiceId: m.best.invoiceId, confidence: m.best.confidence } : null,
      candidates: m.candidates.map((c) => ({ invoiceId: c.invoiceId, confidence: c.confidence })),
      // [BANK-RECON-CONFIRM] Reference-backed + amount-exact + single-invoice → certain enough
      // to book from the invoice row in one tap. An amount-only 'auto' is not safe and stays a
      // "review on the bank page" action (never one-tap booked from a list).
      safe: isSafeAutoConfirm(m),
    }));
  }

  const byInvoice = computeInvoiceReconciliation(links, suggestions);
  const pendingMatchCount = Object.values(byInvoice).filter((r) => r.pendingMatch).length;

  return { byInvoice, pendingTransactions: txRows.length, pendingMatchCount };
}
