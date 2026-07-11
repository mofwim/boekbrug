// src/app/api/daily-truth/route.ts
// [HONEST-HOME] Certainty-only snapshot for the owner's home screen.
//
// We show ONLY facts the system can PROVE:
//   - toPay      : confirmed incoming invoices still unpaid — sum of STORED totals
//   - toReceive  : your sent invoices still unpaid — sum of STORED totals
//   - undocumented: bank debits still pending with no document — a COUNT of tasks
//   - lastBankDate: how current the bank picture is (statements are uploaded)
//
// We deliberately DO NOT compute income / expense / net / BTW. The previous version
// derived those from the bank statement (credit = in, debit = out), which mixes real
// revenue with transfers, tax payments and private withdrawals — wrong for normal
// banking, which is exactly why the panel was turned off. Locked principle: a wrong
// number breaks trust; a wrong task is just ignored. Sums of stored invoice totals
// are exact; the undocumented figure is a task count, not a money figure.
//
// Read-only. service_role, every query pinned to the authenticated user.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";

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

  // 1. Te betalen — confirmed incoming invoices, not yet paid. 'processing'/'draft'
  //    are not yet confirmed by the owner, so excluded. Sum of stored totals = exact.
  const { data: payRows } = await pipeline
    .from("invoices")
    .select("total_inc_btw, due_date")
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .in("status", ["received", "sent", "overdue"]);

  const pay = payRows ?? [];
  const toPay = {
    count: pay.length,
    total: pay.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0),
    overdue: pay.filter((r) => r.due_date && r.due_date < todayIso).length,
  };

  // 2. Te ontvangen — your OWN sent invoices still unpaid (money owed TO you).
  //    Sum of stored totals = exact. A POS-only shop simply has none of these.
  const { data: recvRows } = await pipeline
    .from("invoices")
    .select("total_inc_btw, due_date")
    .eq("sender_id", user.id)
    .eq("direction", "outgoing")
    .in("status", ["sent", "overdue"]);

  const recv = recvRows ?? [];
  const toReceive = {
    count: recv.length,
    total: recv.reduce((s, r) => s + (r.total_inc_btw ?? 0), 0),
    overdue: recv.filter((r) => r.due_date && r.due_date < todayIso).length,
  };

  // 3. Nog te documenteren — bank debits still pending with no linked document.
  //    POS card settlements (income) never need a purchase document, so exclude
  //    them. This is a COUNT of open tasks, never a money figure.
  const { data: txRows } = await pipeline
    .from("bank_transactions")
    .select("date, amount, status, invoice_id, counterpart_name, description")
    .eq("user_id", user.id);

  const txs = txRows ?? [];
  const isPos = (name: string | null, desc: string | null) => {
    const n = (name ?? "").toLowerCase();
    const d = (desc ?? "").toLowerCase();
    return n.includes("ing dd&c") || d.includes("betaalautomaat") || d.includes("afrek.");
  };

  let lastBankDate: string | null = null;
  let undocumented = 0;
  for (const t of txs) {
    const date = t.date ?? null;
    if (date && (!lastBankDate || date > lastBankDate)) lastBankDate = date;
    if (
      t.status === "pending" &&
      !t.invoice_id &&
      (t.amount ?? 0) < 0 &&
      !isPos(t.counterpart_name, t.description)
    ) {
      undocumented++;
    }
  }

  return NextResponse.json({
    ok: true,
    toPay,
    toReceive,
    bank: { lastDate: lastBankDate, undocumented },
  });
}
