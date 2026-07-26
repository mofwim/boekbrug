// src/app/api/reconcile/run/route.ts
// [MATCH-BUTTON] "Matchen met bank & kas" — the ONE on-demand entry point that turns the whole
// matching circle for the signed-in owner, on a tap, instead of waiting for the hourly cron
// (/api/cron/reconcile) or for a browser to happen to sit on /dashboard/bank or /kas.
//
// It runs exactly the same three passes the cron runs, in the same order, on the same shared
// helpers — NOT a second matching engine:
//   1. runBankAutoConfirm      → books the near-certain bank↔factuur matches (invoice → 'paid',
//                                bank line → 'matched'), audited + one-tap reversible.
//   2. reconcileCashSettlements → syncs the kasboek against the cash-paid invoices (create /
//                                heal / remove the linked 'betaling' entry).
//   3. applyLearnedBankCategories → codes fresh bank lines from the owner's learned memory.
// Then it returns the FRESH per-invoice reconciliation map (buildInvoiceReconciliationMap, the
// same builder the badges use) so the caller can update its rows and honestly report what is
// left for the human — without a second round trip that could disagree with itself.
//
// Money discipline is inherited, not re-invented. Nothing here decides what to book: the
// invoice→'paid' write goes through the SESSION client so the DB 'verwerkt' guard fires with a
// real auth.uid(), and only isEligible + autoConfirmTier matches are touched. Ambiguity still
// stops at the human — this button never books a 'choice'.
//
// Idempotent: every pass is safe to repeat, so double-tapping changes nothing the first tap
// didn't already do. Each pass is isolated so one failure still reports the others truthfully
// (`failed` names them; `ok` is false whenever anything failed).

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { runBankAutoConfirm, type AutoConfirmed } from "@/lib/bank-auto-confirm";
import { reconcileCashSettlements, type CashSettleSummary } from "@/lib/cash-settle";
import { applyLearnedBankCategories } from "@/lib/bank-auto-categorize";
import { buildInvoiceReconciliationMap } from "@/lib/bank-recon-map";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// The three passes are read-heavy on a busy account (paginated statements × open invoices).
export const maxDuration = 120;

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Cheap to tap, expensive to serve (the whole statement × every open invoice). The run is
  // idempotent so a blocked retry loses nothing — the hourly cron does the same work anyway.
  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/reconcile/run",
    ...RATE_LIMITS.RECONCILE_RUN,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const pipeline = createPipelineClient();
  const failed: string[] = [];

  const fail = (phase: string, e: unknown) => {
    failed.push(phase);
    console.error("[RECONCILE-RUN] phase failed", { phase, userId: user.id, error: e instanceof Error ? e.message : String(e) });
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
      tags: { route: "reconcile-run", phase },
      extra: { userId: user.id },
    });
  };

  // 1) Bank ↔ facturen. The owner's session client does the invoice→'paid' write (so the
  //    accountant-'verwerkt' trigger fires with a real auth.uid()); the bank-line link uses the
  //    user-pinned pipeline. The bell notification is sent from inside the helper.
  let booked: AutoConfirmed[] = [];
  try {
    booked = await runBankAutoConfirm({ payClient: supabase, pipeline, userId: user.id });
  } catch (e) {
    fail("bank", e);
  }

  // 2) Kas ↔ facturen. Self-healing and idempotent; reports what it actually changed so the
  //    button never claims drawer work it did not do.
  let cash: CashSettleSummary = { ok: false, created: 0, updated: 0, deleted: 0 };
  try {
    cash = await reconcileCashSettlements(supabase, user.id);
    if (!cash.ok) failed.push("kas");
  } catch (e) {
    fail("kas", e);
  }

  // 3) Learned categorization of the remaining uncategorized bank lines. An automatic category
  //    lands in the P&L immediately, so it stays reviewable — see /dashboard/bank/categoriseren.
  let categorized = 0;
  try {
    categorized = (await applyLearnedBankCategories({ pipeline, userId: user.id })).length;
  } catch (e) {
    fail("categorize", e);
  }

  // 4) The state AFTER the engine ran: which invoices are now in the statement, and which
  //    payments were found but still need the owner's confirm (ambiguity never auto-books).
  let byInvoice: Awaited<ReturnType<typeof buildInvoiceReconciliationMap>>["byInvoice"] = {};
  let pendingTransactions = 0;
  let pendingMatchCount = 0;
  try {
    const map = await buildInvoiceReconciliationMap({ pipeline, userId: user.id });
    byInvoice = map.byInvoice;
    pendingTransactions = map.pendingTransactions;
    pendingMatchCount = map.pendingMatchCount;
  } catch (e) {
    fail("map", e);
  }

  return NextResponse.json({
    ok: failed.length === 0,
    failed,
    booked,
    bookedCount: booked.length,
    // Booked on amount + counterpart name WITHOUT a printed invoice number — real bookings, but
    // the ones worth a second look. Surfaced separately so the summary stays honest.
    amountOnlyCount: booked.filter((b) => b.tier === "amount_only").length,
    cash,
    categorized,
    pendingTransactions,
    pendingMatchCount,
    byInvoice,
  });
}
