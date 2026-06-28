// src/app/api/daily-truth/route.ts
// [DAILY-TRUTH] Honest operational snapshot for the owner's home screen.
//
// The goal (decided this session): a LIVE, HONEST financial picture for the
// owner — not matching for the accountant. For a shop like Kiwi (mostly POS, no
// per-sale invoices), the useful daily facts are:
//   - openBills      : confirmed incoming invoices still UNPAID (money the owner
//                      must pay) — count + total. This is real and actionable.
//   - quarterIn/Out  : this quarter's paid outgoing (income) and paid incoming
//                      (expense) totals — the owner's "where am I this quarter".
//   - lastBankDate   : the most recent bank transaction date, so the picture is
//                      honest about HOW CURRENT it is (the statement is uploaded
//                      manually — we never pretend it's live).
//   - undocumented   : bank transactions with NO linked invoice (status pending,
//                      invoice_id null) — the honest "still missing a document"
//                      count. This is the same truth the Brug "Compleet" claim
//                      should eventually reflect (BRUG-COMPLETE-HONEST in queue).
//
// Read-only. service_role, every query pinned to the authenticated user.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";

function quarterRange(now: Date): { start: string; end: string; label: string } {
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3); // 0..3
  const startMonth = q * 3;
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + 3, 0)); // last day of quarter
  const iso = (d: Date) => d.toISOString().split("T")[0];
  return { start: iso(start), end: iso(end), label: `Q${q + 1} ${y}` };
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
  const now = new Date();
  const { start, end, label } = quarterRange(now);

  // 1. Open bills — confirmed incoming invoices not yet paid. 'processing'/'draft'
  //    are NOT yet confirmed by the owner, so exclude them; count what the owner
  //    has accepted as a real bill but hasn't paid.
  const { data: openRows } = await pipeline
    .from("invoices")
    .select("total_inc_btw, due_date, status")
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .in("status", ["received", "sent", "overdue"]); // confirmed, unpaid states

  const openBills = openRows ?? [];
  const openCount = openBills.length;
  const openTotal = openBills.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0);
  // How many are past their due date (overdue to pay) — a gentle, honest nudge.
  const todayIso = now.toISOString().split("T")[0];
  const openOverdue = openBills.filter(
    (r) => r.due_date && r.due_date < todayIso
  ).length;

  // 2. This quarter — paid outgoing (income) and paid incoming (expense).
  const { data: qRows } = await pipeline
    .from("invoices")
    .select("total_inc_btw, direction, status, invoice_date")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .eq("status", "paid")
    .gte("invoice_date", start)
    .lte("invoice_date", end);

  let quarterIn = 0;
  let quarterOut = 0;
  for (const r of qRows ?? []) {
    if (r.direction === "outgoing") quarterIn += r.total_inc_btw ?? 0;
    else if (r.direction === "incoming") quarterOut += r.total_inc_btw ?? 0;
  }

  // 3. Bank freshness + undocumented count.
  const { data: txRows } = await pipeline
    .from("bank_transactions")
    .select("date, status, invoice_id")
    .eq("user_id", user.id);

  const txs = txRows ?? [];
  let lastBankDate: string | null = null;
  let undocumented = 0;
  for (const t of txs) {
    if (t.date && (!lastBankDate || t.date > lastBankDate)) lastBankDate = t.date;
    // pending + no linked invoice = still missing a document (and not ignored).
    if (t.status === "pending" && !t.invoice_id) undocumented++;
  }

  return NextResponse.json({
    ok: true,
    quarterLabel: label,
    openBills: { count: openCount, total: openTotal, overdue: openOverdue },
    quarter: { income: quarterIn, expense: quarterOut, net: quarterIn - quarterOut },
    bank: { lastDate: lastBankDate, undocumented },
  });
}