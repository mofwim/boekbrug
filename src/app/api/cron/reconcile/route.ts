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
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm";
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { applyLearnedBankCategories } from "@/lib/bank-auto-categorize";
import { createNotification } from "@/lib/notifications";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-RECONCILE] CRON_SECRET is not configured — the automatic reconcile is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  // [SECURITY] Constant-time compare — see /api/cron/email-sync; a plain !== leaks the secret via
  // response timing over repeated guesses.
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "reconcile", cronStartedAt);

  const pipeline = createPipelineClient();

  // Only iterate users who actually have something to reconcile — pending bank lines (auto-
  // confirm candidates), paid-in-cash incoming invoices (cash settle), or existing betaling
  // entries (orphan cleanup). Keeps the run bounded to the users where work exists.
  // [CRON-HONEST + NO-SILENT-VOID] A total discovery failure must NOT read as a green run. The old
  // `.catch(() => [[], [], []])` turned a DB outage into `{ok:true, users:0}` — a silent full
  // no-op that status-code monitoring reads as healthy, hour after hour. Fail loudly (500 + Sentry)
  // so alerting fires and the scheduler retries; the whole reconcile is idempotent, so a retry is safe.
  let pendingTx: { user_id: string | null }[];
  let kasInv: { sender_id: string | null; receiver_id: string | null }[];
  let betaling: { user_id: string | null }[];
  try {
    [pendingTx, kasInv, betaling] = await Promise.all([
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
    ]);
  } catch (e) {
    console.error("[CRON-RECONCILE] user discovery failed — aborting run (will retry next schedule)", e);
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "reconcile", phase: "user-set" } });
    return NextResponse.json({ ok: false, error: "user discovery failed" }, { status: 500 });
  }

  const userIds = new Set<string>();
  for (const r of pendingTx) if (r.user_id) userIds.add(r.user_id);
  for (const r of kasInv) { if (r.receiver_id) userIds.add(r.receiver_id); if (r.sender_id) userIds.add(r.sender_id); }
  for (const r of betaling) if (r.user_id) userIds.add(r.user_id);

  let usersProcessed = 0;
  let bookedTotal = 0;
  let failed = 0;
  let truncated = 0;

  // [CRON-FAIRNESS] Rotate the start each run so, if the full list can't finish within maxDuration,
  // a FIXED tail never permanently starves. On Vercel Pro this cron now fires HOURLY, so key the
  // offset off the EPOCH HOUR — it advances by one each run, walking the start across the whole list
  // so every user reaches the head within N hours (was N days when it ran daily). The soft deadline
  // stops cleanly BETWEEN users (never mid-write), so a truncation can't leave a half-linked payment.
  const arr = [...userIds];
  const epochHour = Math.floor(Date.now() / 3_600_000);
  const offset = arr.length > 0 ? epochHour % arr.length : 0;
  const ordered = [...arr.slice(offset), ...arr.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000; // stop ~50s before the 300s ceiling, between users

  for (const uid of ordered) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ordered.length - usersProcessed - failed;
      console.warn("[CRON-RECONCILE] soft deadline hit — deferring remaining users to next run", { remaining: truncated });
      break;
    }
    try {
      const confirmed = await runBankAutoConfirm({ payClient: pipeline, pipeline, userId: uid });
      await reconcileCashSettlements(pipeline, uid);
      // [BANK-AUTO-CATEGORIZE] Code fresh bank lines from the owner's learned memory (confident
      // only) so uncategorized money shrinks on its own between logins. A failure here is no longer
      // swallowed silently — it is logged + Sentry'd (previously a persistently-failing user's
      // auto-categorization could stop forever with no trace).
      let categorized: Awaited<ReturnType<typeof applyLearnedBankCategories>> = [];
      try {
        categorized = await applyLearnedBankCategories({ pipeline, userId: uid });
      } catch (ce) {
        console.error("[CRON-RECONCILE] auto-categorize failed (non-fatal)", { uid, error: ce instanceof Error ? ce.message : String(ce) });
        Sentry.captureException(ce instanceof Error ? ce : new Error(String(ce)), { tags: { cron: "reconcile", phase: "auto-categorize" }, extra: { uid } });
      }
      // [AUTOCAT-NOTIFY] An automatic category lands in the P&L IMMEDIATELY (the engine counts any
      // non-null category). Push a single "controleer" nudge so a machine coding is never applied to
      // the owner's books with zero signal — the review tab (?scope=review) is otherwise never linked.
      if (categorized.length > 0) {
        await createNotification({
          userId: uid,
          type: "status",
          title: `${categorized.length} banktransactie(s) automatisch gecategoriseerd`,
          body: "We hebben deze op basis van eerdere keuzes ingedeeld. Controleer ze even — ze tellen al mee in je cijfers.",
          link: "/dashboard/bank/categoriseren?scope=review",
        }).catch((ne) => console.error("[CRON-RECONCILE] autocat notify failed", { uid, error: ne instanceof Error ? ne.message : String(ne) }));
      }
      usersProcessed += 1;
      // [JET-GAP0] The "automatisch gekoppeld" bell now lives INSIDE runBankAutoConfirm, so every
      // entry point (incl. this cron) notifies from one place — no duplicate insert here.
      if (confirmed.length > 0) bookedTotal += confirmed.length;
    } catch (e) {
      // Isolate + LOG + Sentry (a persistently-failing user was previously an anonymous counter bump).
      failed += 1;
      console.error("[CRON-RECONCILE] user reconcile failed (non-fatal)", { uid, error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "reconcile", phase: "per-user" }, extra: { uid } });
    }
  }

  // [CRON-HONEST] ok reflects the truth: per-user failures are isolated (the run itself completed,
  // so no 500 → no noisy hourly retries for one flaky user), but ok:false makes them visible to
  // any body-reading monitor instead of an always-green flag.
  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, { ok: true, result: { ok: failed === 0, users: userIds.size, usersProcessed, bookedTotal, failed, truncated } });

  return NextResponse.json({ ok: failed === 0, users: userIds.size, usersProcessed, bookedTotal, failed, truncated });
}
