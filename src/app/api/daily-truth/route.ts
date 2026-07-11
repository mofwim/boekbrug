// src/app/api/daily-truth/route.ts
// [HONEST-HOME] Certainty-only snapshot for the owner's home screen.
//
// Two layers, one round-trip:
//   A. Totals ("waar sta ik?") — facts the system can PROVE:
//      - toPay      : confirmed incoming invoices still unpaid — sum of STORED totals
//      - toReceive  : your sent invoices still unpaid — sum of STORED totals
//      - undocumented: bank debits still pending with no document — a COUNT of tasks
//      - lastBankDate: how current the bank picture is (statements are uploaded)
//   B. Attention ("wat nu?") — the top few items that need action now, so the home
//      previews the same to-do the "Vandaag" page lists (overdue or due ≤ 3 days).
//
// We deliberately DO NOT compute income / expense / net / BTW — the previous version
// derived those from the bank statement, which mixed transfers/tax/private with real
// revenue and was wrong for normal banking (which is why it was disabled). Locked
// principle: a wrong number breaks trust; a wrong task is just ignored. Sums here are
// exact stored invoice totals; the undocumented figure is a task count.
//
// Read-only. service_role, every query pinned to the authenticated user.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { needsDocument } from "@/lib/bank-identity";

// Days-until-due window that counts as "needs attention now" (mirrors the Vandaag
// page). Overdue (negative) always qualifies; so does anything due within 3 days.
const ATTENTION_WINDOW_DAYS = 3;

// Whole-day number from an ISO date prefix, via UTC noon (DST/offset-proof).
function dayNumberFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) / 86_400_000);
}

interface InvoiceRow {
  id: string;
  client_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_inc_btw: number | null;
  due_date: string | null;
  status: string | null;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const todayIso = new Date().toISOString().split("T")[0];
  const todayNum = dayNumberFromIso(todayIso);

  const SELECT = "id, client_name, invoice_number, invoice_date, total_inc_btw, due_date, status";

  // 1. Te betalen — confirmed incoming invoices, not yet paid. 'processing'/'draft'
  //    are not yet confirmed by the owner, so excluded. Sum of stored totals = exact.
  const { data: payRows } = await pipeline
    .from("invoices")
    .select(SELECT)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .in("status", ["received", "sent", "overdue"]);

  const pay = (payRows ?? []) as InvoiceRow[];
  const toPay = {
    count: pay.length,
    total: pay.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0),
    overdue: pay.filter((r) => r.due_date && r.due_date < todayIso).length,
  };

  // 2. Te ontvangen — your OWN sent invoices still unpaid (money owed TO you).
  //    Sum of stored totals = exact. A POS-only shop simply has none of these.
  const { data: recvRows } = await pipeline
    .from("invoices")
    .select(SELECT)
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("status", ["sent", "overdue"]);

  const recv = (recvRows ?? []) as InvoiceRow[];
  const toReceive = {
    count: recv.length,
    total: recv.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0),
    overdue: recv.filter((r) => r.due_date && r.due_date < todayIso).length,
  };

  // 3. Nog te documenteren — bank debits still pending with no linked document that
  //    we can't otherwise explain. [BANK-IDENTITY] needsDocument() excludes income,
  //    transfers (savings/cash/own account/ATM), tax, private withdrawals and bank
  //    fees — none of those need a purchase document. What remains is an unexplained
  //    outgoing payment, i.e. probably a real cost still missing its bon. This is a
  //    COUNT of open tasks, never a money figure. (It also fixes the old heuristic,
  //    which wrongly treated a "betaalautomaat" card PURCHASE as takings and skipped
  //    it — a purchase does need a receipt.)
  const { data: txRows } = await pipeline
    .from("bank_transactions")
    .select("date, amount, status, invoice_id, counterpart_name, description")
    .eq("user_id", user.id);

  const txs = txRows ?? [];

  let lastBankDate: string | null = null;
  let undocumented = 0;
  for (const t of txs) {
    const date = t.date ?? null;
    if (date && (!lastBankDate || date > lastBankDate)) lastBankDate = date;
    if (
      t.status === "pending" &&
      !t.invoice_id &&
      needsDocument(t.counterpart_name, t.description, t.amount ?? 0)
    ) {
      undocumented++;
    }
  }

  // B. Attention — the items that need action now, mirroring the Vandaag page:
  //    incoming 'received' (te betalen) + outgoing 'sent'/'overdue' (te ontvangen),
  //    with a due date, that are overdue or due within the window. Sorted soonest/
  //    most-overdue first. We preview the top 3; attentionCount is the full total so
  //    the home can say "Alle N bekijken →".
  const toItem = (r: InvoiceRow, direction: "incoming" | "outgoing") => ({
    id: r.id,
    party: r.client_name,
    invoiceNumber: r.invoice_number,
    dueDate: r.due_date,
    total: r.total_inc_btw ?? 0,
    direction,
  });

  const attentionAll = [
    ...pay.filter((r) => r.status === "received").map((r) => toItem(r, "incoming")),
    ...recv.map((r) => toItem(r, "outgoing")),
  ]
    .filter((it) => it.dueDate && dayNumberFromIso(it.dueDate) - todayNum <= ATTENTION_WINDOW_DAYS)
    .sort((a, b) => dayNumberFromIso(a.dueDate as string) - dayNumberFromIso(b.dueDate as string));

  return NextResponse.json({
    ok: true,
    toPay,
    toReceive,
    bank: { lastDate: lastBankDate, undocumented },
    attention: attentionAll.slice(0, 3),
    attentionCount: attentionAll.length,
  });
}
