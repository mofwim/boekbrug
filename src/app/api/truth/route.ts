// src/app/api/truth/route.ts
// [TRUTH-LENS] The living financial truth through a time lens. ONE truth, computed live from the
// raw tables (no stored daily_truth); a "period" is just which [start, end] window we feed the
// shared computeResultForRange — the exact same reconcile pipeline /api/result uses for a quarter.
// So the dashboard's living number and the quarterly aangifte can never disagree: they are the
// same function over a different window.
//
// ?lens = this-quarter (default) | last-quarter | ytd | year | all | custom
//   custom also needs ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ?year is honoured for lens=year (else the current calendar year).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { computeResultForRange } from "@/lib/compute-result-range";
import { computeFilingDivergence } from "@/lib/btw-filing";

function pad(n: number): string { return String(n).padStart(2, "0"); }
function iso(d: Date): string { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The earliest date "Alles" looks back to — before any real Dutch ZZP bookkeeping in this app.
const ALL_TIME_FLOOR = "2015-01-01";

type Lens = "this-quarter" | "last-quarter" | "ytd" | "year" | "all" | "custom";

interface Window { start: string; end: string; label: string; quarter?: number; year?: number; isLiveWindow: boolean }

/** Resolve the [start, end] window + a human label for a lens, relative to `now` (UTC today). */
function resolveWindow(lens: Lens, now: Date, sp: URLSearchParams): Window {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11
  const todayIso = iso(now);
  const curQ = Math.floor(m / 3) + 1; // 1-4

  const quarterWindow = (qy: number, q: number): Window => {
    const sm = (q - 1) * 3;
    const startD = new Date(Date.UTC(qy, sm, 1));
    const endD = new Date(Date.UTC(qy, sm + 3, 0));
    // A quarter whose end is in the future (or is the current one) is still "living" — not final.
    const isLive = iso(endD) >= todayIso;
    return { start: iso(startD), end: iso(endD), label: `Kwartaal ${q} ${qy}`, quarter: q, year: qy, isLiveWindow: isLive };
  };

  switch (lens) {
    case "last-quarter": {
      const q = curQ === 1 ? 4 : curQ - 1;
      const qy = curQ === 1 ? y - 1 : y;
      return quarterWindow(qy, q);
    }
    case "ytd":
      return { start: `${y}-01-01`, end: todayIso, label: `${y} tot nu`, year: y, isLiveWindow: true };
    case "year": {
      const yr = Math.min(2100, Math.max(2000, Number(sp.get("year")) || y));
      // Up to today when it's the current year, else the full calendar year.
      const end = yr === y ? todayIso : `${yr}-12-31`;
      return { start: `${yr}-01-01`, end, label: `${yr}`, year: yr, isLiveWindow: yr >= y };
    }
    case "all":
      return { start: ALL_TIME_FLOOR, end: todayIso, label: "Alles tot nu", isLiveWindow: true };
    case "custom": {
      const from = sp.get("from");
      const to = sp.get("to");
      const start = from && DATE_RE.test(from) ? from : `${y}-01-01`;
      const end = to && DATE_RE.test(to) ? to : todayIso;
      // Guard against a reversed range — swap so start ≤ end.
      const [s, e] = start <= end ? [start, end] : [end, start];
      return { start: s, end: e, label: `${s} — ${e}`, isLiveWindow: e >= todayIso };
    }
    case "this-quarter":
    default:
      return quarterWindow(y, curQ);
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const lensParam = (sp.get("lens") ?? "this-quarter") as Lens;
  const lens: Lens = ["this-quarter", "last-quarter", "ytd", "year", "all", "custom"].includes(lensParam)
    ? lensParam
    : "this-quarter";

  // new Date() (real "today") is fine in a route — it is NOT a workflow script.
  const win = resolveWindow(lens, new Date(), sp);

  // [ACCOUNTANT-TRUTH] Same dual-path + authorization as /api/result.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const pipeline = createPipelineClient();

  const { result, datelessVerifiedCount, reconciliation } = await computeResultForRange({
    pipeline,
    ownerId: owner.ownerId,
    start: win.start,
    end: win.end,
  });

  // [TRUTH-FILED] When the lens is exactly one quarter, look up whether it was filed. If so, the
  // period is LOCKED (definitief) and we compare the frozen snapshot to the current live figures —
  // any divergence is a correction the owner must be told about (carry-forward vs suppletie).
  let filed: null | {
    filedAt: string;
    figures: { omzet: number; kosten: number; btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number };
    divergence: ReturnType<typeof computeFilingDivergence>;
  } = null;
  if (win.quarter && win.year) {
    // btw_filings is not yet in the generated types (added by btw_filings.sql) → relaxed client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fRow } = await (pipeline as any)
      .from("btw_filings")
      .select("filed_at, omzet, kosten, btw_verschuldigd, btw_voorbelasting, btw_saldo")
      .eq("user_id", owner.ownerId)
      .eq("year", win.year)
      .eq("quarter", win.quarter)
      .maybeSingle();
    const row = fRow as unknown as {
      filed_at: string; omzet: number; kosten: number;
      btw_verschuldigd: number; btw_voorbelasting: number; btw_saldo: number;
    } | null;
    if (row) {
      const figures = {
        omzet: Number(row.omzet) || 0,
        kosten: Number(row.kosten) || 0,
        btwVerschuldigd: Number(row.btw_verschuldigd) || 0,
        btwVoorbelasting: Number(row.btw_voorbelasting) || 0,
        btwSaldo: Number(row.btw_saldo) || 0,
      };
      filed = {
        filedAt: row.filed_at,
        figures,
        divergence: computeFilingDivergence(figures, {
          omzet: result.omzet,
          kosten: result.kosten,
          btwVerschuldigd: result.btwVerschuldigd,
          btwVoorbelasting: result.btwVoorbelasting,
          btwSaldo: result.btwSaldo,
        }),
      };
    }
  }

  return NextResponse.json({
    ok: true,
    lens,
    start: win.start,
    end: win.end,
    label: win.label,
    quarter: win.quarter ?? null,
    year: win.year ?? null,
    // [TRUTH-LENS] true when the window includes today AND it isn't a filed (locked) quarter: the
    // figures are LIVING, not a final period. A filed quarter is "definitief" even if it's current.
    isLiveWindow: win.isLiveWindow && !filed,
    // [TRUTH-FILED] present only for a single-quarter lens that has been filed.
    filed,
    result,
    datelessVerifiedCount,
    reconciliation,
  });
}
