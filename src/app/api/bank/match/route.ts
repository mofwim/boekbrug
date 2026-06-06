// src/app/api/bank/match/route.ts
// [BOEK-016] Run the matching engine over the user's pending transactions (phase 3).
//
// This endpoint ONLY computes suggestions. It is idempotent and writes NOTHING:
//   - bank_transactions stays 'pending'
//   - no invoice_id is set, no invoice status changes
// The UI holds the suggestion; the human confirms in phase 4, and only then does the
// existing payment path execute (invoice → 'paid' + bank_transactions → 'matched').
//
// There is no column to persist a suggestion (decision #4: no migration), so suggestions
// are computed on demand and returned to the client.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { matchTransactions, type InvoiceForMatching } from "@/lib/bank-matching";
import { rowToTransaction, type BankTransactionDbRow } from "@/lib/bank-import";

export async function GET() {
  // 1. Auth — only ever read the authenticated user's own rows.
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // service_role is safe here: every query below is pinned to this user's own data.
  const pipeline = createPipelineClient();

  // 2. Pending transactions for this user.
  const { data: txRows, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, date, amount, description, counterpart_name, reference")
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (txErr) {
    return NextResponse.json(
      { error: "transactions_lookup_failed", detail: txErr.message },
      { status: 500 }
    );
  }

  const transactions = (txRows ?? []).map((r) =>
    rowToTransaction(r as BankTransactionDbRow)
  );

  if (transactions.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { pending: 0, auto: 0, choice: 0, none: 0 },
      suggestions: [],
    });
  }

  // 3. Candidate invoices: this user's own (sent or received), not already paid.
  //    isEligible() in the matcher still enforces direction/sign, draft/archived,
  //    and the B.4 'verwerkt' guard — this query is just a fast-path payload reducer.
  const { data: invRows, error: invErr } = await pipeline
    .from("invoices")
    .select(
      "id, invoice_number, total_inc_btw, invoice_date, due_date, client_name, direction, status, accountant_status"
    )
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .neq("status", "paid");
  if (invErr) {
    return NextResponse.json(
      { error: "invoices_lookup_failed", detail: invErr.message },
      { status: 500 }
    );
  }

  const invoices = (invRows ?? []) as InvoiceForMatching[];

  // 4. Run the pure matcher.
  const result = matchTransactions(transactions, invoices);

  // 5. Shape a lean DTO for the UI. transactionId === bank_transactions.id.
  const suggestions = result.matches.map((m) => ({
    transactionId: m.transaction.transactionId,
    date: m.transaction.date,
    amount: m.transaction.amount,
    description: m.transaction.description,
    counterpart: m.transaction.counterpartName,
    outcome: m.outcome,
    best: m.best,
    candidates: m.candidates,
  }));

  return NextResponse.json({
    ok: true,
    summary: {
      pending: transactions.length,
      auto: result.autoCount,
      choice: result.choiceCount,
      none: result.noneCount,
    },
    suggestions,
  });
}