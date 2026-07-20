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

  const userIds = [...new Set((conns ?? []).map((c) => c.user_id).filter((x): x is string => !!x))];

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
