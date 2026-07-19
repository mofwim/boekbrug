// src/app/api/btw/file/route.ts
// [TRUTH-FILED] Mark a quarter's BTW-aangifte as filed — freeze a snapshot of the figures as they
// stand now — or un-file it (reversible). The living truth keeps moving afterwards; the snapshot
// does not, so the truth surface can flag any later divergence (suppletie).
//
// POST   { year, quarter }  → compute the quarter's current result and upsert the frozen snapshot.
// DELETE ?year&quarter      → remove the filing (unlock the quarter).
// The btw_filings write goes through the SESSION client so RLS (auth.uid() = user_id) applies; the
// figure computation uses the service-role pipeline (same reconcile as /api/result).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResultForRange } from "@/lib/compute-result-range";

function pad(n: number): string { return String(n).padStart(2, "0"); }

function parsePeriod(year: unknown, quarter: unknown): { year: number; quarter: number } | null {
  const y = Number(year);
  const q = Number(quarter);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(q) || q < 1 || q > 4) return null;
  return { year: y, quarter: q };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const period = parsePeriod(body?.year, body?.quarter);
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });
  const { year, quarter } = period;

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;

  // Own filing only (no accountant dual-path here — filing is the owner's declaration).
  const pipeline = createPipelineClient();
  const { result } = await computeResultForRange({ pipeline, ownerId: user.id, start, end });

  const snapshot = {
    user_id: user.id,
    year,
    quarter,
    filed_at: new Date().toISOString(),
    omzet: result.omzet,
    kosten: result.kosten,
    btw_verschuldigd: result.btwVerschuldigd,
    btw_voorbelasting: result.btwVoorbelasting,
    btw_saldo: result.btwSaldo,
  };

  // Upsert on (user_id, year, quarter): re-filing after a suppletie replaces the snapshot.
  // btw_filings is not yet in the generated types (added by btw_filings.sql) → relaxed client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from("btw_filings")
    .upsert(snapshot, { onConflict: "user_id,year,quarter" });
  if (error) return NextResponse.json({ error: "kon indiening niet opslaan" }, { status: 500 });

  return NextResponse.json({ ok: true, filing: snapshot });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const period = parsePeriod(sp.get("year"), sp.get("quarter"));
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from("btw_filings")
    .delete()
    .eq("user_id", user.id)
    .eq("year", period.year)
    .eq("quarter", period.quarter);
  if (error) return NextResponse.json({ error: "kon indiening niet verwijderen" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
