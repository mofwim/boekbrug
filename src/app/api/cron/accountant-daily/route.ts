// src/app/api/cron/accountant-daily/route.ts
// [DAGSTART] One message a morning to a bookkeeper — and only when there is something to say.
//
// ── WHY THIS CRON EXISTS ──
// The werkboard calls itself "the accountant's daily driver", and nothing drives anyone to it.
// Counted across this codebase: about forty distinct notifications are produced, and exactly ONE is
// addressed to an accountant — from quarter-close, whose schedule is `0 8 5 1,4,7,10 *`. Four times
// a year. So the confirm stack grows in silence, the BTW deadline counts down on a screen nobody
// was asked to open, and BoekBrug is something a bookkeeper remembers in the last week of a month.
//
// ── WHAT KEEPS IT FROM BECOMING WALLPAPER ──
// The decision is in accountant-daily.ts, and it is mostly a decision to stay quiet: it speaks
// about work that is NEW (arrived in the last day) and about a deadline that has MOVED into a new
// band, and about nothing else. An unchanged stack of forty produces no message at all. Both are
// derived from the data and the date, so there is no "what did we say yesterday" state to keep —
// which is also why there is no migration here.
//
// SECURITY: iterates every accountant, so it must never be publicly callable. Bearer CRON_SECRET,
// constant-time compare, fail-closed — the identical guard the other six crons use.
//
// It writes NOTHING except notifications. No status, no amount, no match, no filing.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
import { planAccountantDay } from "@/lib/accountant-daily";
import { getAangifteDeadline } from "@/modules/accountant/accountant.service";
import { lastCompletedQuarter } from "@/lib/quarter";
import { amsterdamToday } from "@/lib/format-nl";
import { notifyRow } from "@/lib/notifications"

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Whole days from today to an ISO date. Negative = the date has passed. */
function daysUntil(todayIso: string, targetIso: string): number {
  const a = Date.parse(`${todayIso}T00:00:00Z`);
  const b = Date.parse(`${targetIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export async function GET(req: NextRequest) {
  const cronStartedAt = new Date().toISOString();
  let cronRunId: string | null = null;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[CRON-DAGSTART] CRON_SECRET is not configured — the accountant's morning message is DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  const auth = req.headers.get("authorization");
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  cronRunId = await beginCronRun(pipeline, "accountant-daily", cronStartedAt);

  const today = amsterdamToday();
  // The quarter whose aangifte is currently due — the one that just ended, exactly as the werkboard
  // hero reads it. Its deadline is the last day of the following month.
  const period = lastCompletedQuarter(new Date());
  const deadlineIso = getAangifteDeadline(period.year, period.quarter);
  const daysToDeadline = daysUntil(today, deadlineIso);

  // Every accountant↔client link. One read for the whole run rather than one per accountant: the
  // table is small and the alternative is N round trips for a job that runs before anyone is awake.
  let links: { accountant_id: string; zzper_id: string }[];
  try {
    const raw = await fetchAllRows<{ accountant_id: string | null; zzper_id: string | null }>((from, to) =>
      pipeline.from("accountant_clients").select("accountant_id, zzper_id")
        .order("accountant_id", { ascending: true }).range(from, to),
    );
    links = raw.filter((l): l is { accountant_id: string; zzper_id: string } =>
      typeof l.accountant_id === "string" && typeof l.zzper_id === "string");
  } catch (e) {
    // [CRON-HONEST] A total discovery failure must NOT read as a green run with nobody to notify.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[CRON-DAGSTART] accountant_clients unreadable — no messages sent", { message });
    await finishCronRun(pipeline, cronRunId, { ok: false, error: message });
    return NextResponse.json({ error: "links_lookup_failed" }, { status: 500 });
  }

  const clientsByAccountant = new Map<string, string[]>();
  for (const l of links) {
    if (!l.accountant_id || !l.zzper_id) continue;
    const arr = clientsByAccountant.get(l.accountant_id) ?? [];
    arr.push(l.zzper_id);
    clientsByAccountant.set(l.accountant_id, arr);
  }

  // Yesterday, as a timestamp — the window for "new". A day exactly, so a run that slips by an hour
  // neither repeats nor skips anything.
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString();

  let sent = 0;
  let quiet = 0;

  for (const [accountantId, clientIds] of clientsByAccountant) {
    try {
      // The confirm stack for this accountant's clients: incoming invoices still in 'processing'.
      // Both counts come from ONE read — the whole stack, and how much of it arrived since
      // yesterday — because two reads could disagree about the same moment.
      const rows = await fetchAllRows<{ id: string; created_at: string | null }>((from, to) =>
        pipeline.from("invoices").select("id, created_at")
          .in("receiver_id", clientIds)
          .eq("direction", "incoming")
          .eq("status", "processing")
          .order("id", { ascending: true }).range(from, to),
      );
      const totalToConfirm = rows.length;
      const newToConfirm = rows.filter((r) => (r.created_at ?? "") >= since).length;

      // Which of this accountant's clients have NOT filed the due quarter. A failed read here must
      // not read as "everyone still has to file" — that would invent urgency — so it degrades to
      // zero, which makes the deadline say nothing at all. [NO-SILENT-EMPTY] in the direction that
      // stays quiet rather than the direction that shouts.
      let clientsNotFiled = 0;
      try {
        const filed = await fetchAllRows<{ user_id: string }>((from, to) =>
          (pipeline as unknown as {
            from: (t: string) => { select: (c: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: number) => { eq: (c: string, v: number) => { order: (c: string, o: { ascending: boolean }) => { range: (f: number, t: number) => PromiseLike<{ data: { user_id: string }[] | null; error: { message: string } | null }> } } } } } };
          })
            .from("btw_filings").select("user_id")
            .in("user_id", clientIds)
            .eq("year", period.year)
            .eq("quarter", period.quarter)
            .order("user_id", { ascending: true }).range(from, to),
        );
        const filedSet = new Set(filed.map((f) => f.user_id));
        clientsNotFiled = clientIds.filter((c) => !filedSet.has(c)).length;
      } catch (e) {
        console.warn("[CRON-DAGSTART] btw_filings unreadable — the deadline stays silent this run", {
          accountantId, error: e instanceof Error ? e.message : String(e),
        });
      }

      const message = planAccountantDay({ newToConfirm, totalToConfirm, daysToDeadline, clientsNotFiled });
      if (!message) { quiet++; continue; }

      const notified = await notifyRow({
        user_id: accountantId,
        title: message.title,
        body: message.body,
        type: "status",
        read: false,
        link: message.link,
      });
      if (!notified) {
        console.error("[CRON-DAGSTART] notification insert failed", { accountantId });
        continue;
      }
      sent++;
    } catch (e) {
      // Best-effort per accountant: one failure must never stop the rest of the round.
      console.error("[CRON-DAGSTART] accountant skipped", {
        accountantId, error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await finishCronRun(pipeline, cronRunId, { ok: true, result: { sent, quiet } });
  // `quiet` is returned on purpose: a run where everybody was quiet is the healthy common case, and
  // without the number it is indistinguishable from a run that found nobody at all.
  return NextResponse.json({ ok: true, accountants: clientsByAccountant.size, sent, quiet, daysToDeadline });
}
