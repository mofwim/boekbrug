// src/app/api/readiness/board/route.ts
// [SNEL-BORD] Every recorded readiness verdict this accountant's board needs — in ONE request.
//
// GET /api/readiness/board?year=2026&quarter=2        ← accountant only
//   → { ok, year, quarter, perClient: { [clientId]: { report, computedAt } }, cacheUnavailable? }
//
// ── WHAT THIS IS FOR ──
// The werkboard calls /api/readiness once per client, four at a time. That route is a projection
// over the whole administration — about 22 database rounds and ~1.500 rows per client per quarter —
// so an office with eighty clients pays it eighty times on every open and watches a screen full of
// "laden" while it happens. This route answers the same question for the whole board with one
// SELECT, out of what /api/readiness already computed and recorded.
//
// ── IT COMPUTES NOTHING ──
// Not a shortcut version of readiness, not a summary, not a projection: it hands back the report
// object /api/readiness itself produced, whole, with the moment it was produced. The screen renders
// it and refreshes each row behind it. If this route ever starts deriving a figure of its own, the
// board and the readiness screen become two answers to one question, which is the defect this
// product keeps finding in its own past.
//
// ── AND IT MAY NEVER LOOK FRESH ──
// computedAt travels with every row, and readiness-cache.ts decides whether a recording is still
// worth showing at all. A verdict that reads "klaar" is a statement about a moment that has passed;
// printing it without that moment would be the app telling an accountant to file a quarter on
// information neither of them has looked at.
//
// ── SCOPING ──
// Mirrors /api/closing-package/vers: accountant role required, and only the clients this accountant
// is linked to TODAY. The table is service-role only (RLS on, no policies) precisely because a
// report IS the client's administration in summary — the link is proved here, then read as the
// pipeline.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";

export const dynamic = "force-dynamic";

/** Postgres says "relation does not exist" with 42P01; PostgREST reports an unknown table as PGRST205. */
function isMissingTable(message: string | undefined, code: string | undefined): boolean {
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") return true;
  return /relation .*readiness_cache.* does not exist|could not find the table/i.test(message ?? "");
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const quarter = Number(req.nextUrl.searchParams.get("quarter"));
  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(quarter)) {
    return NextResponse.json({ error: "Ongeldig kwartaal" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "accountant") {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  // The clients this accountant is linked to TODAY. A recording for a since-unlinked client is
  // deliberately dropped: the board does not show that client, and handing back a summary of an
  // administration the accountant can no longer open would itself be the leak.
  const { data: links, error: linkErr } = await supabase
    .from("accountant_clients")
    .select("zzper_id")
    .eq("accountant_id", user.id);
  if (linkErr) {
    return NextResponse.json({ error: "Koppelingen niet leesbaar" }, { status: 503 });
  }
  const clientIds = [...new Set((links ?? []).map((l) => (l as { zzper_id: string }).zzper_id))];
  if (clientIds.length === 0) {
    return NextResponse.json({ ok: true, year, quarter, perClient: {} });
  }

  const pipeline = createPipelineClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (pipeline as any)
    .from("readiness_cache")
    .select("owner_id, report, computed_at")
    .eq("year", year)
    .eq("quarter", quarter)
    .in("owner_id", clientIds);

  if (error) {
    // [DEPLOY-SAFE] readiness_cache.sql is applied by hand; before that this route ships and finds
    // no table. Say so — the board then loads every row live, which is what it did before, and no
    // client is quietly reported as having no verdict.
    if (isMissingTable(error.message, (error as { code?: string }).code)) {
      return NextResponse.json({ ok: true, year, quarter, perClient: {}, cacheUnavailable: true });
    }
    // [NO-SILENT-EMPTY] Any other failure is a failure, not an empty board. An empty perClient is a
    // claim ("nothing was ever computed for these clients") and this is not the moment to make it.
    console.error("[SNEL-BORD] standen niet leesbaar", { accountantId: user.id, error: error.message });
    return NextResponse.json({ error: "Standen niet leesbaar" }, { status: 503 });
  }

  const perClient: Record<string, { report: unknown; computedAt: string }> = {};
  for (const row of (data ?? []) as Array<{ owner_id: string; report: unknown; computed_at: string }>) {
    // A row with no report is not a verdict. Dropping it costs one client its head start; keeping it
    // would put an empty object on a board where every row is read as a judgement.
    if (!row?.owner_id || !row.report) continue;
    perClient[row.owner_id] = { report: row.report, computedAt: row.computed_at };
  }

  return NextResponse.json({ ok: true, year, quarter, perClient });
}
