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
import {
  matchTransactions,
  isFullyCovered,
  normalizeRef,
  type InvoiceForMatching,
} from "@/lib/bank-matching";
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
  //    [BANK-MULTI-LINK-PERSIST] Also select invoice_id so we can detect a
  //    partially-linked multi-invoice tx (status still 'pending', but already
  //    carries the last invoice paid against it). Without this the UI loses the
  //    "partially done" state on reload and the tx wrongly falls into "Geen factuur".
  const { data: txRows, error: txErr } = await pipeline
    .from("bank_transactions")
    .select("id, date, amount, description, counterpart_name, reference, invoice_id, status")
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

  // [BANK-MULTI-LINK-PERSIST] Partial-link coverage. A multi-invoice tx that has
  // already had ONE invoice paid against it keeps status='pending' + an invoice_id.
  // Its remaining candidates may now be zero (the only matching invoice is paid and
  // excluded above) → the matcher would label it 'none' and the UI would bury it in
  // "Geen factuur". To keep it in "Te bevestigen" until every reference number is
  // paid, we compute allCovered here (server-side, so it survives a reload) and tell
  // the UI which transactions are partially linked. Same shared rule as confirm.
  //
  // We only need paid invoice numbers when at least one pending tx is already linked.
  const linkedTxRows = (txRows ?? []).filter(
    (r) => (r as BankTransactionDbRow).invoice_id != null
  );
  const partialLink = new Map<string, boolean>(); // txId → allCovered

  if (linkedTxRows.length > 0) {
    // Paid invoice numbers for this user, both directions (cheap, single read).
    // isFullyCovered does equality on normalized numbers; direction already fixed
    // the candidate set when each link was confirmed, so a plain paid-number set is
    // sufficient here for the presence check.
    const { data: paidRows } = await pipeline
      .from("invoices")
      .select("invoice_number")
      .eq("status", "paid")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

    const paidSet = new Set(
      (paidRows ?? [])
        .map((r) => normalizeRef(r.invoice_number ?? ""))
        .filter((n) => n.length > 0)
    );

    for (const r of linkedTxRows) {
      const row = r as BankTransactionDbRow;
      partialLink.set(row.id, isFullyCovered(row.reference, paidSet));
    }
  }

  // 5. Shape a lean DTO for the UI. transactionId === bank_transactions.id.
  const suggestions = result.matches.map((m) => {
    const txId = m.transaction.transactionId;
    const isLinked = txId != null && partialLink.has(txId);
    return {
      transactionId: txId,
      date: m.transaction.date,
      amount: m.transaction.amount,
      description: m.transaction.description,
      counterpart: m.transaction.counterpartName,
      // [BANK-REF-DISPLAY] The cleaned invoice number(s) the parser extracted from
      // REMI/Ustrd (e.g. "26702781, 26703066"). The UI shows this instead of the
      // raw description so the owner sees the real reference, not "USTD//...".
      reference: m.transaction.reference,
      outcome: m.outcome,
      best: m.best,
      candidates: m.candidates,
      // [BANK-MULTI-LINK-PERSIST] Persisted (reload-safe) link state. partiallyLinked
      // = this pending tx already has an invoice paid against it; allCovered = every
      // reference number is now paid. The UI keeps a partiallyLinked && !allCovered tx
      // in "Te bevestigen" regardless of `outcome` (it may have no candidates left).
      partiallyLinked: isLinked,
      allCovered: isLinked ? partialLink.get(txId!) === true : false,
    };
  });

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