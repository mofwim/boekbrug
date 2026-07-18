// src/app/api/bank/reconciliation/route.ts
// [BANK-RECON-BADGE] Invoice-centric reconciliation status for the invoice lists.
// Returns, per invoice id: { linked, pendingMatch } — see computeInvoiceReconciliation.
//
// Read-only and idempotent (writes NOTHING). It is the inverse view of /api/bank/match:
// the bank page asks "which invoice does this payment match?"; the invoice lists ask
// "does this invoice have a payment in the bank statement (already linked, or a confident
// unconfirmed match to confirm)?". Confirmation still happens only via POST /api/bank/confirm.
//
// service_role (pipeline) is safe here because EVERY query is pinned to the authenticated
// user's own rows, exactly like /api/bank/match.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { matchTransactions, isSafeAutoConfirm, type InvoiceForMatching } from "@/lib/bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "@/lib/bank-import";
import {
  computeInvoiceReconciliation,
  type ReconLink,
  type ReconSuggestion,
} from "@/lib/bank-reconciliation";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pipeline = createPipelineClient();

  try {
    // 1) Bank lines already linked to an invoice → those invoices are "in bankafschrift".
    //    Paginated (a busy account exceeds the ~1000-row PostgREST cap) and user-pinned.
    const linkRows = await fetchAllRows((from, to) =>
      pipeline
        .from("bank_transactions")
        .select("invoice_id, status")
        .eq("user_id", user.id)
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
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const invRows = await fetchAllRows((from, to) =>
      pipeline
        .from("invoices")
        .select("id, invoice_number, total_inc_btw, amount_paid, invoice_date, due_date, client_name, direction, status, accountant_status, vendor_iban")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
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
    return NextResponse.json({ ok: true, byInvoice });
  } catch (e) {
    return NextResponse.json(
      { error: "reconciliation_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
