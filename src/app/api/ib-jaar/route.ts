// src/app/api/ib-jaar/route.ts
// [IB-JAAR] GET ?year=2026[&clientId=…] — the year arranged the way the IB-aangifte asks for it.
//
// Dual-path like /api/truth: the owner reads their own year, a linked accountant reads a
// client's (resolveQuarterOwner + the service-role pipeline, because RLS rightly shows an
// accountant none of the client's rows). Read-only: it books nothing, computes no tax — see the
// header of ib-jaar.ts for what it refuses and why.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { computeResultForRange } from "@/lib/compute-result-range";
import { buildIbJaarOverzicht } from "@/lib/ib-jaar";
import { fetchAllRows } from "@/lib/supabase-paginate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }

  // [DIEP-3] A SCREEN read, not an export: the jaar screen fetches this on every mount and
  // toggle, all on the viewer's one bucket — the export ceiling 429'd the 61st client-year an
  // accountant opened (day-end audit). Screen-sized ceiling instead.
  const limited = await checkRateLimit({ userId: user.id, endpoint: "ib-jaar", ...RATE_LIMITS.YEAR_SCREEN });
  if (!limited.allowed) return rateLimitResponse(limited);

  const owner = await resolveQuarterOwner(supabase, user.id, req.nextUrl.searchParams.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  let range;
  try {
    range = await computeResultForRange({ pipeline, ownerId: owner.ownerId, start, end });
  } catch (e) {
    // [NO-SILENT-EMPTY] A failed year read refuses; a €0 winst over a failed read is a number
    // someone copies into a legal form.
    console.error("[IB-JAAR] year result failed", { ownerId: owner.ownerId, year, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "We konden het jaar nu niet doorrekenen. Probeer het zo opnieuw." }, { status: 503 });
  }

  // Σ hours in the year. null = could not look — the module says so instead of "not met".
  //
  // [UREN-KOLOM] The column is `worked_on`. It read `entry_date` — which belongs to cash_entries,
  // not to time_entries — so PostgREST answered "column does not exist", fetchAllRows threw, the
  // catch below turned it into null, and this screen has been saying "we konden je urenregistratie
  // niet lezen" for every owner since the day it shipped. The urencriterium was never once
  // assessed. Nothing was wrong on screen: the null branch prints an honest sentence, which is
  // exactly why nobody went looking.
  const hoursTotal = await fetchAllRows<{ hours: number | null }>((lo, hi) =>
    pipeline
      .from("time_entries")
      .select("hours")
      .eq("user_id", owner.ownerId)
      .gte("worked_on", start)
      .lte("worked_on", end)
      .order("id", { ascending: true })
      .range(lo, hi),
  )
    .then((rows) => rows.reduce((s, r) => s + (Number(r.hours) || 0), 0))
    .catch((e) => {
      // Logged, not just swallowed. A permanently broken read that renders as a polite sentence is
      // the quietest kind of failure there is — this is what would have named it in week one.
      console.error("[UREN-KOLOM] reading the year's hours failed — the urencriterium is not assessed", {
        userId: owner.ownerId, year, error: e instanceof Error ? e.message : String(e),
      });
      return null;
    });

  const overzicht = buildIbJaarOverzicht({
    year,
    omzet: range.result.omzet,
    kosten: range.result.kosten,
    resultaat: range.result.resultaat,
    cashOmzetZonderBtw: range.result.cashOmzetZonderBtw,
    hoursTotal,
  });

  return NextResponse.json({ ok: true, overzicht });
}
