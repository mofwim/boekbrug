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
import { computeFilingDivergence } from "@/lib/btw-filing";

function pad(n: number): string { return String(n).padStart(2, "0"); }

function quarterBounds(year: number, quarter: number): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;
  return { start, end };
}

function parsePeriod(year: unknown, quarter: unknown): { year: number; quarter: number } | null {
  const y = Number(year);
  const q = Number(quarter);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(q) || q < 1 || q > 4) return null;
  return { year: y, quarter: q };
}

// GET ?year&quarter → the filing snapshot for this quarter (if any) + the live divergence.
// Used by the Kwartaaloverzicht to show the "🔒 Ingediend" / suppletie state for any quarter.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const period = parsePeriod(sp.get("year"), sp.get("quarter"));
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });
  const { year, quarter } = period;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: fRow } = await db
    .from("btw_filings")
    .select("filed_at, omzet, kosten, btw_verschuldigd, btw_voorbelasting, btw_saldo")
    .eq("user_id", user.id)
    .eq("year", year)
    .eq("quarter", quarter)
    .maybeSingle();
  if (!fRow) return NextResponse.json({ ok: true, filed: null });

  const figures = {
    omzet: Number(fRow.omzet) || 0,
    kosten: Number(fRow.kosten) || 0,
    btwVerschuldigd: Number(fRow.btw_verschuldigd) || 0,
    btwVoorbelasting: Number(fRow.btw_voorbelasting) || 0,
    btwSaldo: Number(fRow.btw_saldo) || 0,
  };
  // Compare the frozen snapshot to the CURRENT live figures for this quarter.
  const { start, end } = quarterBounds(year, quarter);
  const pipeline = createPipelineClient();
  const { result } = await computeResultForRange({ pipeline, ownerId: user.id, start, end });
  const divergence = computeFilingDivergence(figures, {
    omzet: result.omzet, kosten: result.kosten,
    btwVerschuldigd: result.btwVerschuldigd, btwVoorbelasting: result.btwVoorbelasting, btwSaldo: result.btwSaldo,
  });

  return NextResponse.json({ ok: true, filed: { filedAt: fRow.filed_at, figures, divergence } });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const period = parsePeriod(body?.year, body?.quarter);
  if (!period) return NextResponse.json({ error: "invalid year/quarter" }, { status: 400 });
  const { year, quarter } = period;
  const { start, end } = quarterBounds(year, quarter);

  // Own filing only (no accountant dual-path here — filing is the owner's declaration).
  const pipeline = createPipelineClient();

  // [FILING-GATE] Don't freeze a quarter as "ingediend" while incoming invoices dated in it are
  // still unconfirmed ('processing') — their cost + voorbelasting are NOT yet in the figures, so the
  // snapshot would be demonstrably incomplete. This is a WARNING, not a hard block: filing is the
  // owner's own declaration, so the client re-POSTs with { acknowledge: true } after confirming.
  // (Previously the client ignored the response entirely and froze silently.)
  if (body?.acknowledge !== true) {
    const { count: processingCount } = await pipeline
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "processing")
      .gte("invoice_date", start)
      .lte("invoice_date", end);
    if ((processingCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "quarter_not_ready",
          notReady: true,
          processingCount: processingCount ?? 0,
          reason: `${processingCount} inkoopfactu(u)r(en) in dit kwartaal zijn nog niet gecontroleerd — hun bedrag en BTW staan nog niet in de cijfers.`,
        },
        { status: 409 },
      );
    }
  }

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
