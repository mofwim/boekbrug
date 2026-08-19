// src/app/api/btw/carry/route.ts
// [SUPPLETIE-VERREKEND] "Ik heb deze correctie in deze aangifte verwerkt."
//
// ── WHY THIS EXISTS AT ALL ──
//
// A BTW correction of €1.000 or less may be processed in the next regular aangifte instead of a
// separate suppletie. The aangifte screen now names those corrections with their amounts. The
// moment it does, it acquires a duty of its own: it has to know when one has been carried, or it
// offers the same correction again next quarter and the owner declares it twice. A screen that
// tells you to do something and then keeps telling you is not a helpful screen, it is a wrong one.
//
// ── WHY THE OWNER TICKS IT, AND THE APP DOES NOT INFER IT ──
//
// The tempting version marks corrections as carried automatically when the later quarter is filed:
// no tick, no friction. It is also a guess. An owner who forgot to include it, or whose accountant
// filed a separate suppletie instead, would have the app silently discharge an obligation that
// still stands — and the whole point of this line of work is that a duty at the Belastingdienst is
// never quietly closed. So it is a deliberate act, taken with the amount on screen.
//
// ── WHAT IS WRITTEN, AND WHAT IS NOT ──
//
// The snapshot is NOT rewritten. Re-freezing the earlier quarter to its current figures would make
// the arithmetic come out and would destroy the only record of what was actually sent — the record
// every divergence is measured against ([FILING-NO-OVERWRITE]). What is written beside it is the
// AMOUNT declared elsewhere, so a quarter that moves again afterwards still shows what remains.
//
// The amount is recomputed HERE, from the same engine the aangifte used, and never taken from the
// request. A client that posted its own figure would let a stale screen record a carry that does
// not match what the books say — and then the difference would be lost in both directions at once.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { computeResultForRange } from "@/lib/compute-result-range";
import { computeFilingDivergence, correctionRoute, outstandingCorrection } from "@/lib/btw-filing";
import { quarterBounds, quarterLabel, readFiling, figuresOf } from "@/lib/filed-quarter";
import { isMissingColumn, isMissingRelation } from "@/lib/pg-missing";
import { logAuditAction, getClientIP } from "@/lib/audit";

export const dynamic = "force-dynamic";

function parseQuarter(v: unknown): { year: number; quarter: number } | null {
  const o = v as { year?: unknown; quarter?: unknown } | null;
  const year = Number(o?.year);
  const quarter = Number(o?.quarter);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  return { year, quarter };
}

/** Is `a` strictly before `b`? */
function isBefore(a: { year: number; quarter: number }, b: { year: number; quarter: number }): boolean {
  return a.year * 4 + a.quarter < b.year * 4 + b.quarter;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const from = parseQuarter(body?.from);
  const into = parseQuarter(body?.into);
  if (!from || !into) {
    return NextResponse.json({ error: "invalid from/into" }, { status: 400 });
  }
  // A correction travels FORWARD. Carrying a quarter into itself, or into an earlier one, is not a
  // shape the Belastingdienst has — and it is how a correction ends up recorded against the very
  // return it came from.
  if (!isBefore(from, into)) {
    return NextResponse.json(
      { error: "Een correctie kan alleen in een LATERE aangifte worden verwerkt." },
      { status: 400 },
    );
  }

  const pipeline = createPipelineClient();
  // btw_filings is added by a hand-applied migration and is not in the generated Database types —
  // the same relaxed-client escape /api/truth and /api/btw/file use for this table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filings = pipeline as any;

  // The source quarter must actually be filed — there is nothing to correct otherwise.
  const { row, failed } = await readFiling(pipeline, user.id, from.year, from.quarter);
  if (failed) {
    return NextResponse.json(
      { error: "We konden dit kwartaal nu niet nakijken — er is niets gewijzigd. Probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }
  if (!row) {
    return NextResponse.json({ error: "Dit kwartaal is niet als ingediend gemarkeerd." }, { status: 409 });
  }

  // What is already carried, read separately so a database without the column still answers.
  let alreadyCarried = 0;
  {
    const { data, error } = await filings
      .from("btw_filings").select("carried_saldo")
      .eq("user_id", user.id).eq("year", from.year).eq("quarter", from.quarter)
      .maybeSingle();
    if (error && !isMissingColumn(error.message, (error as { code?: string }).code) && !isMissingRelation(error.message)) {
      return NextResponse.json(
        { error: "We konden niet nagaan wat er al verwerkt is — er is niets gewijzigd." },
        { status: 503 },
      );
    }
    alreadyCarried = Number((data as { carried_saldo?: number | null } | null)?.carried_saldo) || 0;
  }

  // Recomputed here, never taken from the request — see the header.
  const { start, end } = quarterBounds(from.year, from.quarter);
  let outstanding: number;
  try {
    const { result } = await computeResultForRange({ pipeline, ownerId: user.id, start, end });
    const divergence = computeFilingDivergence(figuresOf(row), {
      omzet: result.omzet, kosten: result.kosten,
      btwVerschuldigd: result.btwVerschuldigd, btwVoorbelasting: result.btwVoorbelasting,
      btwSaldo: result.btwSaldo,
    });
    outstanding = outstandingCorrection(divergence.btwSaldoDelta, alreadyCarried);
  } catch (e) {
    console.error("[SUPPLETIE-VERREKEND] could not recompute the quarter being carried", {
      userId: user.id, from, error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "We konden dit kwartaal nu niet doorrekenen — er is niets gewijzigd." },
      { status: 503 },
    );
  }

  const route = correctionRoute(outstanding);
  if (route === "none") {
    return NextResponse.json(
      { error: "Er staat niets meer open voor dit kwartaal — er valt niets te verrekenen." },
      { status: 409 },
    );
  }
  // The threshold is re-checked on the server, because it decides which FORM the Belastingdienst
  // expects. A screen that offered a carry for €1.400 (a stale render, a hand-made request) must
  // not be able to record one: above the threshold it needs its own suppletie, and recording it as
  // carried here would close the obligation in the books while nothing was ever filed.
  if (route === "suppletie") {
    return NextResponse.json(
      {
        error:
          `Het openstaande verschil over ${quarterLabel(from.year, from.quarter)} is meer dan €1.000. ` +
          "Dat mag niet in een gewone aangifte worden verwerkt — dien er een suppletie voor in.",
        code: "suppletie_required",
      },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: writeErr } = await filings
    .from("btw_filings")
    .update({
      // ADDED to what was carried before, never replacing it: a quarter can be corrected in two
      // steps, and each step is declared in the return that was open at the time.
      carried_saldo: alreadyCarried + outstanding,
      carried_into_year: into.year,
      carried_into_quarter: into.quarter,
      carried_at: nowIso,
    })
    .eq("user_id", user.id).eq("year", from.year).eq("quarter", from.quarter);

  if (writeErr) {
    if (isMissingColumn(writeErr.message, (writeErr as { code?: string }).code) || isMissingRelation(writeErr.message)) {
      // [DEPLOY-SAFE] btw_filings_carried.sql has not landed here yet. Answer honestly rather than
      // reporting a success that recorded nothing — the owner would then believe the correction is
      // closed and it would be offered again next quarter, which is the double declaration this
      // whole endpoint exists to prevent.
      console.warn("[SUPPLETIE-VERREKEND] carried columns not migrated — nothing recorded", { userId: user.id, from });
      return NextResponse.json(
        {
          error:
            "Deze functie is hier nog niet beschikbaar. Je correctie is niet vastgelegd — noteer zelf " +
            "dat je hem hebt verwerkt.",
          code: "not_migrated",
        },
        { status: 503 },
      );
    }
    console.error("[SUPPLETIE-VERREKEND] carry write failed", { userId: user.id, from, error: writeErr.message });
    return NextResponse.json({ error: "Opslaan mislukt — er is niets gewijzigd." }, { status: 500 });
  }

  // Evidence, in the same spirit as the filing itself: what was declared, from where, into what.
  await logAuditAction({
    userId: user.id,
    action: "btw.correction_carried",
    entityType: "btw_filing",
    entityId: `${from.year}-Q${from.quarter}`,
    oldValue: { carried_saldo: alreadyCarried },
    newValue: {
      carried_saldo: alreadyCarried + outstanding,
      carried_into: quarterLabel(into.year, into.quarter),
      amount: outstanding,
    },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    from: quarterLabel(from.year, from.quarter),
    into: quarterLabel(into.year, into.quarter),
    carried: outstanding,
    totalCarried: alreadyCarried + outstanding,
  });
}
