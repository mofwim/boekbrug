// src/app/api/cron/reconcile/route.ts
// [CRON] Scheduled SERVER-SIDE reconcile — the second heartbeat of the financial-truth circle.
// Until now the matching circle (bank auto-confirm + cash settlement) only turned when a browser
// sat on /dashboard/bank or /kas. This cron closes it on its own for EVERY user: it books the
// near-certain bank payments (isSafeAutoConfirm) and reconciles the cash-settlement entries,
// then notifies the owner of anything it booked. "Snap and throw, the app does the rest" — even
// when nobody has the app open.
//
// SECURITY: iterates every user, so it must never be publicly callable — Bearer CRON_SECRET,
// fail-closed (same guard as /api/cron/email-sync).
//
// Money discipline is unchanged: runBankAutoConfirm only touches isSafeAutoConfirm matches
// (reference printed + amount to the cent, single invoice), fully reversible + audited;
// reconcileCashSettlements is idempotent + self-healing. Both are best-effort per user so one
// user's failure never stops the rest.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm";
import { reconcileCashSettlements } from "@/lib/cash-settle";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();

  // Only iterate users who actually have something to reconcile — pending bank lines (auto-
  // confirm candidates), paid-in-cash incoming invoices (cash settle), or existing betaling
  // entries (orphan cleanup). Keeps the run bounded to the users where work exists.
  const [pendingTx, kasInv, betaling] = await Promise.all([
    fetchAllRows<{ user_id: string | null }>((from, to) =>
      pipeline.from("bank_transactions").select("user_id").eq("status", "pending")
        .order("id", { ascending: true }).range(from, to)),
    // BOTH directions of cash-paid invoices — a cash SALE (sender_id) must settle into the
    // drawer too, not only a cash purchase (receiver_id).
    fetchAllRows<{ sender_id: string | null; receiver_id: string | null }>((from, to) =>
      pipeline.from("invoices").select("sender_id, receiver_id")
        .eq("status", "paid").eq("payment_method", "kas")
        .order("id", { ascending: true }).range(from, to)),
    fetchAllRows<{ user_id: string | null }>((from, to) =>
      pipeline.from("cash_entries").select("user_id").eq("category", "betaling")
        .order("id", { ascending: true }).range(from, to)),
  ]).catch(() => [[], [], []] as [{ user_id: string | null }[], { sender_id: string | null; receiver_id: string | null }[], { user_id: string | null }[]]);

  const userIds = new Set<string>();
  for (const r of pendingTx) if (r.user_id) userIds.add(r.user_id);
  for (const r of kasInv) { if (r.receiver_id) userIds.add(r.receiver_id); if (r.sender_id) userIds.add(r.sender_id); }
  for (const r of betaling) if (r.user_id) userIds.add(r.user_id);

  let usersProcessed = 0;
  let bookedTotal = 0;
  let failed = 0;

  for (const uid of userIds) {
    try {
      const confirmed = await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: uid });
      await reconcileCashSettlements(pipeline, uid);
      usersProcessed += 1;
      if (confirmed.length > 0) {
        bookedTotal += confirmed.length;
        // Tell the owner what the app did on their behalf (in-app bell; non-blocking).
        try {
          await pipeline.from("notifications").insert({
            user_id: uid,
            title: "Betalingen automatisch gekoppeld",
            body:
              confirmed.length === 1
                ? "1 banktransactie is automatisch aan de juiste factuur gekoppeld en op betaald gezet."
                : `${confirmed.length} banktransacties zijn automatisch aan de juiste facturen gekoppeld en op betaald gezet.`,
            type: "payment",
          });
        } catch {
          /* notification is non-essential */
        }
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, users: userIds.size, usersProcessed, bookedTotal, failed });
}
