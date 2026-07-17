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
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { syncUserEmails } from "@/lib/email-integration";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the batch time (actual ceiling depends on the plan)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
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

  let synced = 0, failed = 0, saved = 0;
  // Sequential + error-isolated: one user's failure (expired token, provider hiccup) must
  // not stop the rest. SCALE NOTE: this processes ALL connected mailboxes sequentially within
  // maxDuration; past a few dozen active mailboxes the window can truncate and later users
  // starve — add pagination / a per-run continuation cursor before scaling beyond a pilot.
  for (const uid of userIds) {
    try {
      let r = await syncUserEmails(uid);
      if (r) { synced += 1; saved += r.saved; }
      // [CRON-DRAIN] syncUserEmails caps NEW classifications per call (SYNC_BATCH_MAX). Once a
      // day that meant a fresh 200-invoice mailbox took days to import. Keep syncing while items
      // remain, bounded by a round cap so one huge mailbox can't consume the whole invocation
      // and starve later users — the next hourly run picks up any tail.
      let rounds = 0;
      while (r && r.remaining > 0 && rounds < 5) {
        rounds++;
        r = await syncUserEmails(uid);
        if (r) saved += r.saved;
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, connections: userIds.length, synced, failed, saved });
}
