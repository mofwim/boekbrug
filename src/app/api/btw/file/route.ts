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
import { logAuditAction, getClientIP } from "@/lib/audit";
// [TZ] "Has this quarter ended?" is an Amsterdam-day question — see the filing-window gate below.
import { amsterdamToday } from "@/lib/format-nl";

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

  // The engine already surfaces every completeness signal we need — compute it once, up front, and
  // reuse it both for the readiness gate and for the frozen snapshot below.
  const range = await computeResultForRange({ pipeline, ownerId: user.id, start, end });
  const { result, datelessVerifiedCount, undatedPaidCount, unconfirmedIncomingCount } = range;

  // [FILING-WINDOW] A quarter that has not ENDED cannot have been filed with the Belastingdienst —
  // the aangifte for it does not exist yet. Freezing a snapshot mid-quarter is worse than useless:
  // every sale for the rest of the quarter then reads as a divergence against it, and once the
  // running total moves by more than €1.000 the screen tells the owner to file a suppletie for a
  // period nobody has asked them to declare. Unlike the completeness blockers below, this is not a
  // matter of the owner's own judgement, so `acknowledge` does not open it.
  if (end >= amsterdamToday()) {
    return NextResponse.json(
      {
        error: "quarter_not_ended",
        reason: `Kwartaal ${quarter} ${year} loopt nog tot en met ${end}. Je kunt een kwartaal pas als ingediend markeren nadat het is afgelopen.`,
      },
      { status: 409 },
    );
  }

  // [FILING-GATE] Don't freeze a quarter as "ingediend" while its figures are demonstrably
  // incomplete. The old gate checked ONLY unconfirmed ('processing') incoming invoices — but the
  // truth can be too low for several other reasons the readiness screen already blocks on. Gate on
  // the SAME engine signals so filing and "klaar" can never disagree:
  //   - processing incoming invoices in the window (cost/BTW not yet counted)
  //   - cashOmzetZonderBtw > 0 (omzet booked in NO BTW rubriek — 5a silently too low)
  //   - dateless verified invoices (dropped from the window entirely)
  //   - undatedPaidCount (kasstelsel: paid money that can't be placed in a quarter)
  // This is a WARNING, not a hard block: filing is the owner's own declaration, so the client
  // re-POSTs with { acknowledge: true } after seeing the reason (which we then audit, below).
  if (body?.acknowledge !== true) {
    const blockers: string[] = [];
    // [GATE-PARITY] The unconfirmed-purchase count now comes from the SAME engine call that
    // produced the figures, over the SAME rows, using the SAME effective-direction rule the money
    // uses (effDirOf). The old inline query filtered `.eq("direction", "incoming")`, which is a
    // column test — and a purchase invoice whose direction column is NULL is inferred from
    // ownership everywhere else ([FIN-4]). Those rows are excluded from the figures but were
    // invisible to the gate, so a quarter with unconfirmed purchases could pass it unchallenged.
    // It also removes a query and a fail-open/fail-closed branch: if the engine read fails, the
    // whole request fails, which is the correct fail-closed behaviour for a filing gate.
    if (unconfirmedIncomingCount > 0) blockers.push(`${unconfirmedIncomingCount} inkoopfactu(u)r(en) in dit kwartaal zijn nog niet gecontroleerd — hun bedrag en BTW staan nog niet in de cijfers`);
    if (result.cashOmzetZonderBtw > 0) blockers.push(`er staat nog omzet zonder BTW-tarief (contant, bank of niet-gesplitste kassadag) — de verschuldigde BTW is daardoor mogelijk te laag`);
    if (datelessVerifiedCount > 0) blockers.push(`${datelessVerifiedCount} bevestigde factu(u)r(en) hebben geen datum en tellen niet mee in dit kwartaal`);
    if (undatedPaidCount > 0) blockers.push(`${undatedPaidCount} betaalde factu(u)r(en) missen een betaaldatum — onder kasstelsel kan de BTW niet in het juiste kwartaal worden geplaatst`);

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: "quarter_not_ready",
          notReady: true,
          processingCount: unconfirmedIncomingCount,
          blockers,
          reason: blockers.join(". "),
        },
        { status: 409 },
      );
    }
  }

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

  // [FILING-AUDIT] Record that this quarter was filed, and — crucially — WHETHER it was filed while
  // readiness blockers were still open (acknowledge:true). Previously the override left no trace, so
  // a later dispute couldn't show the owner was warned. Best-effort: never fail the filing on audit.
  await logAuditAction({
    userId: user.id,
    action: body?.acknowledge === true ? "btw.filed_despite_warnings" : "btw.filed",
    entityType: "btw_filing",
    entityId: `${year}-Q${quarter}`,
    newValue: {
      year, quarter, acknowledged: body?.acknowledge === true,
      btwSaldo: result.btwSaldo, cashOmzetZonderBtw: result.cashOmzetZonderBtw,
      datelessVerifiedCount, undatedPaidCount, unconfirmedIncomingCount,
    },
    ipAddress: getClientIP(req),
  }).catch(() => {});

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
