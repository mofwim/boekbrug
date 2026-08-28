// src/app/api/cron/btw-deadline/route.ts
// [DEADLINE] The one nudge in the last week before the BTW-aangifte is due.
//
// ── WHY A SECOND CRON AND NOT A SECOND DATE ON quarter-close ──
// quarter-close fires on the 5th of Jan/Apr/Jul/Oct and its file states plainly that firing
// exactly once per quarter IS its idempotency — no dedup state, because there is only ever one
// run. Giving it a second schedule would quietly remove that property from a route whose safety
// argument rests on it. This is a different message at a different moment with a different
// audience (only the owners who have NOT filed), so it is a different route.
//
// ── WHY IT EXISTS ──
// The 5th is roughly 26 days before the deadline. Dismiss that notification and nothing in the
// product mentions the deadline again — the reservation panel that knows the date renders only on
// /dashboard/vandaag, which has no standing entry point on a phone. So the next thing an owner
// heard was that the date had passed, with the boete and the belastingrente already running.
//
// SCHEDULE: the 24th of Jan/Apr/Jul/Oct (see vercel.json), which is 7 days before a 31st and 6
// before 30 April. The message never states the interval it was scheduled with — it counts the
// days itself, from the Amsterdam calendar, so the sentence is right on all four.
//
// HONESTY: it says the deadline is near. It does NOT say the quarter is ready — readiness lives on
// /dashboard/klaar and is a different question with a different answer.
//
// SECURITY: fail-closed on a missing CRON_SECRET; constant-time bearer compare (mirrors the others).

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { createNotification } from "@/lib/notifications";
import { previousQuarter } from "@/lib/quarter-close";
import { deadlineNotice, deadlineNudgeDue } from "@/lib/btw-deadline-notice";
import { amsterdamToday } from "@/lib/format-nl";
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronStartedAt = new Date().toISOString();
  let cronRunId: string | null = null;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON-BTW-DEADLINE] CRON_SECRET is not configured — the deadline nudge is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  cronRunId = await beginCronRun(pipeline, "btw-deadline", cronStartedAt);
  const klaar = async (body: Record<string, unknown>, ok: boolean, status?: number) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body, status ? { status } : undefined);
  };

  // The quarter this month's deadline belongs to: the one that just ended. An explicit override is
  // allowed for a manual re-run, exactly as quarter-close allows it.
  const sp = req.nextUrl.searchParams;
  const yParam = Number(sp.get("year"));
  const qParam = Number(sp.get("quarter"));
  const period = Number.isInteger(yParam) && qParam >= 1 && qParam <= 4
    ? { year: yParam, quarter: qParam as 1 | 2 | 3 | 4 }
    : previousQuarter(new Date());

  // [TZ] The Amsterdam day. A deadline is a Dutch calendar date, and a server in another zone must
  // not count a different number of days to it.
  const today = amsterdamToday();
  const notice = deadlineNotice(period.year, period.quarter, today);

  // The guard, not the schedule. It keeps a manual re-run in the middle of a quarter from nudging
  // the entire book about something a month away — and it is stated in a pure, tested module
  // rather than as a date arithmetic here.
  if (!deadlineNudgeDue(notice, false)) {
    return klaar(
      { ok: true, skipped: "not_in_final_week", deadline: notice.deadline, days: notice.days },
      true,
    );
  }

  let ownerIds: string[];
  try {
    const owners = await fetchAllRows<{ id: string }>((from, to) =>
      pipeline
        .from("profiles")
        .select("id")
        .neq("role", "accountant")
        .order("id", { ascending: true })
        .range(from, to),
    );
    ownerIds = owners.map((o) => o.id);
  } catch (e) {
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
      tags: { cron: "btw-deadline", phase: "profiles" },
    });
    return klaar({ ok: false, error: "kon profielen niet laden" }, false, 500);
  }

  // [ALREADY-FILED] The whole point of this run is the owners who have NOT filed. Unlike
  // quarter-close, a failed read here may NOT fall through to nudging everyone: this message says
  // the deadline is nearly here, and sending it to someone who filed three weeks ago sends them
  // back to a screen to check whether they imagined doing it.
  let filedOwners: Set<string>;
  try {
    const filed = await fetchAllRows<{ user_id: string | null }>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any).from("btw_filings").select("user_id")
        .eq("year", period.year).eq("quarter", period.quarter)
        .order("user_id", { ascending: true }).range(from, to));
    filedOwners = new Set(filed.map((r) => r.user_id).filter((id): id is string => !!id));
  } catch (e) {
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
      tags: { cron: "btw-deadline", phase: "filings" },
    });
    return klaar({ ok: false, error: "kon ingediende kwartalen niet lezen" }, false, 500);
  }

  let notified = 0, skippedFiled = 0, failed = 0, truncated = 0;
  const startedAt = Date.now();
  const DEADLINE_MS = 250_000;

  for (let i = 0; i < ownerIds.length; i++) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      truncated = ownerIds.length - i;
      console.warn("[CRON-BTW-DEADLINE] soft deadline hit — deferring remaining owners", { remaining: truncated });
      break;
    }
    const ownerId = ownerIds[i];
    if (filedOwners.has(ownerId)) { skippedFiled += 1; continue; }
    try {
      // [TAAL-DB] A stored notification is read by the owner on their own screen, and the
      // notification table holds one string — so it is written in the source language, like every
      // other notification this app stores.
      await createNotification({
        userId: ownerId,
        title: `BTW-aangifte Q${period.quarter} ${period.year}`,
        body: notice.state === "vandaag"
          ? "Vandaag is de laatste dag om dit kwartaal in te dienen."
          : `Nog ${notice.days} dagen: dien dit kwartaal uiterlijk in op ${notice.deadline}.`,
        type: "status",
        link: `/dashboard/aangifte?year=${period.year}&quarter=${period.quarter}`,
      });
      notified += 1;
    } catch (e) {
      failed += 1;
      Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
        tags: { cron: "btw-deadline", phase: "notify" },
      });
    }
  }

  return klaar(
    {
      ok: true,
      year: period.year,
      quarter: period.quarter,
      deadline: notice.deadline,
      days: notice.days,
      notified,
      skippedFiled,
      failed,
      truncated,
    },
    true,
  );
}
