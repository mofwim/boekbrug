// src/app/api/cron/quarter-close/route.ts
// [QUARTER-CLOSE] End-of-quarter handoff. The system already KNOWS a quarter has ended and how
// complete its invoice evidence is — but it did nothing with that. This cron turns it into an
// action: once, early in the first month of a new quarter, it notifies every active owner (and any
// linked accountant) that the just-closed quarter is ready to review — or which gaps remain first.
//
// SCHEDULE: run on a FIXED post-quarter date (see vercel.json: 5th of Jan/Apr/Jul/Oct) so it fires
// exactly once per quarter — that alone is the idempotency (no per-run dedup state needed).
//
// HONESTY: it does NOT claim an authoritative "klaar om in te dienen" verdict — that lives on the
// readiness screen. It reports the invoice-evidence completeness (summarizeClosingPackage) and nudges
// the owner to review + file. Never a green light the figures don't support.
//
// SECURITY: fail-closed on a missing CRON_SECRET; constant-time bearer compare (mirrors email-sync).

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { summarizeClosingPackage } from "@/lib/closing-package";
import { createNotification } from "@/lib/notifications";
import { previousQuarter, buildQuarterCloseNotice } from "@/lib/quarter-close";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON-QUARTER-CLOSE] CRON_SECRET is not configured — the quarter-end handoff is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Allow an explicit ?year&quarter override (manual re-run); otherwise the quarter that just ended.
  const sp = req.nextUrl.searchParams;
  const yParam = Number(sp.get("year"));
  const qParam = Number(sp.get("quarter"));
  const period =
    Number.isInteger(yParam) && qParam >= 1 && qParam <= 4
      ? { year: yParam, quarter: qParam as 1 | 2 | 3 | 4 }
      : previousQuarter(new Date());

  const pipeline = createPipelineClient();

  // Every non-accountant profile is a potential owner. Once-per-quarter, so a full scan is fine.
  // `.neq("role","accountant")` alone drops NULL-role profiles (SQL: NULL <> 'accountant' → NULL,
  // not TRUE), silently excluding legacy/edge owners from the nudge. Include them explicitly.
  const { data: profiles, error: profErr } = await pipeline
    .from("profiles")
    .select("id, role")
    .or("role.is.null,role.neq.accountant");
  if (profErr) {
    return NextResponse.json({ error: "kon profielen niet laden" }, { status: 500 });
  }
  const ownerIds = [...new Set((profiles ?? []).map((p) => p.id).filter((x): x is string => !!x))];

  let notifiedOwners = 0, notifiedAccountants = 0, skippedEmpty = 0, failed = 0, truncated = 0;
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000;

  for (let i = 0; i < ownerIds.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ownerIds.length - i;
      console.warn("[CRON-QUARTER-CLOSE] soft deadline hit — deferring remaining owners", { remaining: truncated });
      break;
    }
    const ownerId = ownerIds[i];
    try {
      const summary = await summarizeClosingPackage({ ownerId, year: period.year, quarter: period.quarter, supabase: pipeline });
      const notice = buildQuarterCloseNotice(summary.quarter, summary);
      // Don't nag a dormant quarter (no invoice activity, no warnings).
      if (notice.empty) { skippedEmpty += 1; continue; }

      await createNotification({
        userId: ownerId,
        title: notice.ownerTitle,
        body: notice.ownerBody,
        type: "status",
        link: "/dashboard/quarterly",
      });
      notifiedOwners += 1;

      // Notify any linked accountant(s) so the handoff isn't a thing the owner must remember to trigger.
      const { data: links } = await pipeline
        .from("accountant_clients")
        .select("accountant_id")
        .eq("zzper_id", ownerId);
      for (const link of links ?? []) {
        if (!link.accountant_id) continue;
        await createNotification({
          userId: link.accountant_id,
          title: notice.accountantTitle,
          body: notice.accountantBody,
          type: "status",
          link: "/dashboard/clients",
        });
        notifiedAccountants += 1;
      }
    } catch (e) {
      failed += 1;
      console.error("[CRON-QUARTER-CLOSE] owner failed (non-fatal)", { ownerId, error: e instanceof Error ? e.message : String(e) });
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: "quarter-close" }, extra: { ownerId } });
    }
  }

  return NextResponse.json({
    ok: true,
    quarter: `Q${period.quarter} ${period.year}`,
    owners: ownerIds.length,
    notifiedOwners,
    notifiedAccountants,
    skippedEmpty,
    failed,
    truncated,
  });
}
