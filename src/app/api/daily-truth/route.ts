// src/app/api/daily-truth/route.ts
// [DAILY-TRUTH] Honest operational snapshot for the owner's home screen.
//
// The goal (decided this session): a LIVE, HONEST financial picture for the
// owner — not matching for the accountant. For a shop like Kiwi (mostly POS, no
// per-sale invoices), income arrives IN THE BANK as card takings, so the money
// figures are derived from the bank statement (credit = in, debit = out), NOT
// from invoices alone (which would show €0 income and make the shop look like a
// loss). The honest facts:
//   - openBills      : confirmed incoming invoices still UNPAID (what you owe)
//   - quarter in/out : bank credits vs debits this quarter (POS-true income)
//   - posIncome      : the POS card takings within that income (the shop's core)
//   - undocumented   : DEBIT transactions still pending with no document — real
//                      expenses missing a receipt. POS credits are excluded
//                      (card takings never need a purchase document), so this is
//                      the honest "still to do", not an inflated count.
//   - lastBankDate   : how current the picture is (statement is uploaded, not live)
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

  // 2 + 3. Bank-driven figures. For a shop (Kiwi) the real income is POS card
  //   takings that arrive IN THE BANK with no outgoing invoice — so computing
  //   income from invoices alone shows €0 income (wrong, makes a profitable shop
  //   look like a loss). We derive income/expense from the bank statement
  //   instead: credit = money in, debit = money out. This is the honest picture
  //   for a POS business; it's bounded by what's been uploaded (we report the
  //   freshness date separately so we never imply real-time data).
  const { data: txRows } = await pipeline
    .from("bank_transactions")
    .select("date, amount, status, invoice_id, counterpart_name, description")
    .eq("user_id", user.id);

  const txs = txRows ?? [];

  // POS card settlements (ING DD&C / BETAALAUTOMAAT) — the shop's daily takings.
  // They are income but have NO supplier invoice, so they must NOT count toward
  // "still to document" (that number should be real expenses missing a receipt,
  // not card payouts). Same detection as the bank screen.
  const isPos = (name: string | null, desc: string | null) => {
    const n = (name ?? "").toLowerCase();
    const d = (desc ?? "").toLowerCase();
    return n.includes("ing dd&c") || d.includes("betaalautomaat") || d.includes("afrek.");
  };

  let lastBankDate: string | null = null;
  let undocumented = 0; // real expenses (debit) with no document, excluding POS
  let posIncome = 0;    // this-quarter POS takings (the shop's core income)
  let quarterIn = 0;    // this-quarter all credits (income)
  let quarterOut = 0;   // this-quarter all debits (expense)

  for (const t of txs) {
    const date = t.date ?? null;
    if (date && (!lastBankDate || date > lastBankDate)) lastBankDate = date;

    const amount = t.amount ?? 0;
    const pos = isPos(t.counterpart_name, t.description);

    // Undocumented = a debit (expense) still pending with no linked invoice.
    // Credits (income) and POS never need a purchase document.
    if (t.status === "pending" && !t.invoice_id && amount < 0 && !pos) {
      undocumented++;
    }

    // Quarter income/expense from the bank, within the quarter window.
    if (date && date >= start && date <= end) {
      if (amount >= 0) {
        quarterIn += amount;
        if (pos) posIncome += amount;
      } else {
        quarterOut += Math.abs(amount);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    quarterLabel: label,
    openBills: { count: openCount, total: openTotal, overdue: openOverdue },
    quarter: {
      income: quarterIn,
      expense: quarterOut,
      net: quarterIn - quarterOut,
      posIncome,
    },
    bank: { lastDate: lastBankDate, undocumented },
  });
}