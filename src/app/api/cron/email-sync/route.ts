// src/app/api/cron/email-sync/route.ts
// [CRON] Scheduled background email import — makes the onboarding promise ("we import your
// invoices automatically in the background") TRUE. Vercel Cron calls this on a schedule
// (see vercel.json); it iterates every connected mailbox and runs the same per-user sync
// the manual /api/email/sync uses.
//
// SECURITY: this triggers AI-costing syncs for EVERY connected user, so it must NEVER be
// publicly callable. It requires `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron sends
// this automatically when CRON_SECRET is set in the project env. Without the secret set, the
// route refuses to run (fail-closed) rather than exposing an open all-user trigger.

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { syncUserEmails } from "@/lib/email-integration";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { decideAccess } from "@/lib/subscription";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the batch time (actual ceiling depends on the plan)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // [CRON-OBSERVABILITY] Distinguish a MISCONFIG (secret not set → the whole circle silently
  // stops for everyone) from a bad caller token. A missing secret must SCREAM, not look like a
  // quiet week — it's the single env var the "we import automatically" promise hinges on.
  if (!secret) {
    console.error("[CRON-EMAIL-SYNC] CRON_SECRET is not configured — automatic email import is DISABLED for all users.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  // [SECURITY] Constant-time compare — a plain !== leaks, via response timing, how many leading
  // bytes a guessed token matched, which can recover the secret over many attempts.
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  // Ordered by connected_at so the iteration order is deterministic across runs.
  const { data: conns, error } = await pipeline
    .from("email_connections")
    .select("user_id, connected_at")
    .order("connected_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "kon verbindingen niet laden" }, { status: 500 });
  }

  let userIds = [...new Set((conns ?? []).map((c) => c.user_id).filter((x): x is string => !!x))];

  // ── [COST-GUARD] Only sync mailboxes whose owner still has access ──────
  //
  // This scan had NO entitlement filter, and the mail robot is by far the most
  // expensive thing in the app: syncUserEmails() classifies up to SYNC_BATCH_MAX
  // (40) documents per round with up to 5 drain rounds — ~240 paid Claude calls
  // per user per run, twelve runs a day. One connected mailbox belonging to a
  // lapsed or never-paying account is a four-hundred-euro-a-month bleed that
  // nothing in the code was stopping.
  //
  // The same decision the paywall uses (decideAccess) is applied here, so a
  // mailbox is serviced exactly while its owner is entitled to the feature —
  // never by a separate rule that could drift from what the app shows on screen.
  //
  // Fails OPEN per profile: if we cannot read a profile we still sync it. The
  // global daily euro fuse in src/lib/ai-budget.ts is the backstop that makes
  // that safe, and the alternative — silently stopping a paying customer's mail
  // import because of a read error — is worse.
  if (userIds.length > 0) {
    try {
      // Billing columns come from billing_subscription.sql (hand-applied) and are
      // not in the generated types → relaxed client. A missing column throws and
      // is caught below, leaving every mailbox enabled exactly as before.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: owners, error: ownerErr } = await (pipeline as any)
        .from("profiles")
        .select("id, role, subscription_status, trial_ends_at, current_period_end")
        .in("id", userIds);

      if (ownerErr) throw new Error(ownerErr.message);

      const nowMs = Date.now();
      const entitled = new Set<string>();
      for (const o of (owners ?? []) as Array<{
        id: string;
        role: string | null;
        subscription_status: string | null;
        trial_ends_at: string | null;
        current_period_end: string | null;
      }>) {
        const decision = decideAccess({
          role: o.role ?? null,
          subscriptionStatus: o.subscription_status ?? null,
          trialEndsAt: o.trial_ends_at ?? null,
          currentPeriodEnd: o.current_period_end ?? null,
          nowMs,
        });
        if (decision.allowed) entitled.add(o.id);
      }

      // A profile we could not read at all is left in (fail open, see above).
      const seen = new Set((owners ?? []).map((o: { id: string }) => o.id));
      const before = userIds.length;
      userIds = userIds.filter((id) => entitled.has(id) || !seen.has(id));
      if (before !== userIds.length) {
        console.log(
          `[CRON-EMAIL] skipped ${before - userIds.length} mailbox(es) whose owner has no access`
        );
      }
    } catch (err) {
      console.error("[CRON-EMAIL] entitlement filter unavailable — syncing all:", err);
    }
  }

  let synced = 0, failed = 0, saved = 0, truncated = 0;
  // [CRON-FAIRNESS] Rotate the start each run so a fixed tail of mailboxes never permanently starves
  // when the list can't finish within maxDuration. The cron fires once a day at a FIXED hour, so
  // getUTCHours() was constant → the same tail starved forever. Key the offset off the EPOCH DAY: it
  // advances one each daily run, so the start walks the whole list and every mailbox reaches the head
  // within N days. A soft deadline stops cleanly between users; one user's failure never stops the rest.
  const offset = userIds.length > 0 ? Math.floor(Date.now() / 86_400_000) % userIds.length : 0;
  const ordered = [...userIds.slice(offset), ...userIds.slice(0, offset)];
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000;

  for (let i = 0; i < ordered.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ordered.length - i;
      console.warn("[CRON-EMAIL-SYNC] soft deadline hit — deferring remaining mailboxes to next run", { remaining: truncated });
      break;
    }
    const uid = ordered[i];
    try {
      let r = await syncUserEmails(uid);
      if (r) { synced += 1; saved += r.saved; }
      // [CRON-DRAIN] syncUserEmails caps NEW classifications per call (SYNC_BATCH_MAX). Keep
      // syncing while items remain, bounded by a round cap — BUT stop the moment a round makes NO
      // progress, so a poison-pill attachment (one that fails to import every round and keeps the
      // batch head) can't burn all 5 rounds re-processing the same failing slice every hour.
      let rounds = 0;
      while (r && r.remaining > 0 && rounds < 5) {
        rounds++;
        const prevSaved = r.saved;
        const next = await syncUserEmails(uid);
        if (next) saved += next.saved;
        const progressed = !!next && (next.saved > 0 || next.remaining < r.remaining);
        r = next;
        if (!progressed) {
          console.warn("[CRON-EMAIL-SYNC] drain made no progress — likely a stuck attachment; deferring", { uid, remaining: r?.remaining ?? null, prevSaved });
          break;
        }
      }
    } catch (e) {
      failed += 1;
      // [OBSERVABILITY] A per-user sync failure is non-fatal to the batch, but it must not vanish
      // into a log line the cron returns 200 over — capture it so a mailbox that stops importing
      // is visible to us, not only to the (now-notified) owner.
      console.error("[CRON-EMAIL-SYNC] user sync failed (non-fatal)", { uid, error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "email-sync" }, extra: { uid } });
    }
  }

  return NextResponse.json({ ok: true, connections: userIds.length, synced, failed, saved, truncated });
}
