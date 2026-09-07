// src/app/api/cron/mollie-settlements/route.ts
// [MOLLIE-AFREKENING] Daily: read every connected owner's Mollie settlements and book what they
// prove — the fee as a cost, the payout line as a transfer. See mollie-settlement-sync.ts.
//
// Same shape as bank-sync: CRON_SECRET, heartbeat, a soft deadline, one owner's failure never
// stops the next owner. Mostly silent by design: an owner with no new settlement produces no
// row and no notification.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
import { syncMollieSettlementsForOwner } from "@/lib/mollie-settlement-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEADLINE_MS = 250_000;

export async function GET(req: NextRequest) {
  const cronStartedAt = new Date().toISOString();
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON-MOLLIE-SETTLEMENTS] CRON_SECRET is not configured — Mollie settlements are not read.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const cronRunId = await beginCronRun(pipeline, "mollie-settlements", cronStartedAt);

  // mollie_connections is not in the generated types (mollie.sql) — relaxed, as everywhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (pipeline as any)
    .from("mollie_connections")
    .select("user_id")
    .eq("status", "active")
    .order("user_id", { ascending: true });
  if (error) {
    // A database where mollie.sql is not applied has no connections and nothing to do.
    const missing = /42P01|relation .* does not exist/i.test(error.message ?? "");
    const result = { ok: missing, error: error.message };
    await finishCronRun(pipeline, cronRunId, { ok: missing, result });
    return NextResponse.json(missing ? { ok: true, connections: 0 } : { error: "kon koppelingen niet laden" }, { status: missing ? 200 : 500 });
  }

  const userIds = [...new Set(((rows ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((x): x is string => !!x))];
  const offset = userIds.length > 0 ? Math.floor(Date.now() / 86_400_000) % userIds.length : 0;
  const ordered = [...userIds.slice(offset), ...userIds.slice(0, offset)];
  const startedAt = Date.now();

  let owners = 0, seen = 0, booked = 0, held = 0, refused = 0, failed = 0, truncated = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) { truncated = ordered.length - i; break; }
    owners++;
    try {
      const r = await syncMollieSettlementsForOwner(pipeline, ordered[i]);
      seen += r.seen; booked += r.booked; held += r.held; refused += r.refused;
      if (r.errors.length > 0) { failed++; console.error("[CRON-MOLLIE-SETTLEMENTS] owner had errors", { userId: ordered[i], errors: r.errors }); }
    } catch (e) {
      failed++;
      console.error("[CRON-MOLLIE-SETTLEMENTS] owner failed", { userId: ordered[i], error: e instanceof Error ? e.message : String(e) });
    }
  }

  const result = { ok: true, owners, seen, booked, held, refused, failed, truncated };
  await finishCronRun(pipeline, cronRunId, { ok: true, result });
  return NextResponse.json(result);
}
