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
  const hoursTotal = await fetchAllRows<{ hours: number | null }>((lo, hi) =>
    pipeline
      .from("time_entries")
      .select("hours")
      .eq("user_id", owner.ownerId)
      .gte("entry_date", start)
      .lte("entry_date", end)
      .order("id", { ascending: true })
      .range(lo, hi),
  )
    .then((rows) => rows.reduce((s, r) => s + (Number(r.hours) || 0), 0))
    .catch(() => null);

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
