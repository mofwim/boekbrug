// src/app/api/work-done/route.ts
// [WERK-GEDAAN] How much work the app did for this office in one window — counted, not claimed.
//
// GET /api/work-done?from=2026-07-01&to=2026-09-30      ← accountant only
//   → { ok, from, to, office, perClient, unreadable: [], countsUnavailable? }
//
// ── WHAT THIS IS FOR ──
// An office does not buy software, it buys back hours, and the case for putting two hundred clients
// into one system is a number BoekBrug could not state. Every figure here is a COUNT of something
// that happened and is recorded — no estimate, no rate, no euros. What a minute is worth is the
// office's own arithmetic; see the deliberate refusal in work-done.ts:estimateMinutes.
//
// ── THE WINDOW IS A PROCESSING WINDOW, AND THAT IS NOT A DETAIL ──
// The question is "what did you do for me between these dates", so the axis is when the APP acted.
// Measured while building this: asking for Q2 2026 on the fiscal axis returned 0 invoices, because
// the whole administration was imported in July — every Q2 invoice was processed outside Q2. So
// there is no ?quarter here on purpose. A caller that wants "this month" passes this month's dates.
//
// ── SCOPING ──
// Mirrors /api/closing-package/vers: accountant role required, and only clients this accountant is
// linked to TODAY. The counts run through work_done_counts(), a SECURITY DEFINER function locked to
// the service role — an accountant's own session sees none of a client's rows under RLS.
//
// ── [NO-SILENT-EMPTY] A failed or missing count is NAMED, never zero ──
// A client whose counts could not be read is listed in `unreadable` and left out of the totals, and
// when the function itself is not there yet ([DEPLOY-SAFE]: this route ships before the migration is
// applied by hand) the answer says countsUnavailable rather than reporting an office that did
// nothing. Zero is the one answer this surface must never give by accident: it understates the
// office's own case with a number that was never measured.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import type { WorkDoneCounts } from "@/lib/work-done";

export const dynamic = "force-dynamic";

const LEEG: WorkDoneCounts = {
  invoicesFromEmail: 0,
  invoicesAutoVerified: 0,
  bankLinesCategorised: 0,
  bankLinesMatched: 0,
  tillDaysImported: 0,
  duplicatesCaught: 0,
};

/** YYYY-MM-DD, and a real date — "2026-02-31" is not one. */
function parseDay(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === raw ? raw : null;
}

/** Postgres says "function does not exist" with 42883 — the pre-migration case. */
function isMissingFunction(message: string | undefined, code: string | undefined): boolean {
  if (code === "42883" || code === "PGRST202") return true;
  return /function .*work_done_counts.* does not exist|could not find the function/i.test(message ?? "");
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const from = parseDay(sp.get("from"));
  const to = parseDay(sp.get("to"));
  if (!from || !to || from > to) {
    return NextResponse.json({ error: "Ongeldige periode" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "accountant") {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  const { data: links, error: linkErr } = await supabase
    .from("accountant_clients")
    .select("zzper_id")
    .eq("accountant_id", user.id);
  if (linkErr) {
    return NextResponse.json({ error: "Koppelingen niet leesbaar" }, { status: 503 });
  }
  const clientIds = [...new Set((links ?? []).map((l) => (l as { zzper_id: string }).zzper_id))];

  const pipeline = createPipelineClient();
  let functionMissing = false;

  const results = await Promise.all(
    clientIds.map(async (id) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (pipeline as any).rpc("work_done_counts", {
        p_owner: id, p_from: from, p_to: to,
      });
      if (error) {
        if (isMissingFunction(error.message, (error as { code?: string }).code)) functionMissing = true;
        else {
          console.error("[WERK-GEDAAN] telling mislukt voor één klant", { clientId: id, error: error.message });
        }
        return { id, counts: null };
      }
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, number | string> | null;
      if (!row) return { id, counts: null };
      const n = (v: unknown) => {
        const x = Number(v);
        return Number.isFinite(x) && x >= 0 ? Math.trunc(x) : 0;
      };
      return {
        id,
        counts: {
          invoicesFromEmail: n(row.invoices_from_email),
          invoicesAutoVerified: n(row.invoices_auto_verified),
          bankLinesCategorised: n(row.bank_lines_categorised),
          bankLinesMatched: n(row.bank_lines_matched),
          tillDaysImported: n(row.till_days_imported),
          // Not counted by the function: duplicates caught live in money-invariants, which needs the
          // whole invoice set. work-done.ts drops zero rows, so this renders as silence, not as a
          // measured nothing.
          duplicatesCaught: 0,
        } satisfies WorkDoneCounts,
      };
    }),
  );

  // [NO-SILENT-EMPTY] The function is not applied yet → say so. An office reading "0 handelingen"
  // would conclude the app does nothing for them, which is the opposite of what is true.
  if (functionMissing) {
    return NextResponse.json({
      ok: true, from, to, countsUnavailable: true,
      office: null, perClient: {}, unreadable: clientIds,
    });
  }

  const perClient: Record<string, WorkDoneCounts> = {};
  const unreadable: string[] = [];
  const office: WorkDoneCounts = { ...LEEG };
  for (const r of results) {
    if (!r.counts) { unreadable.push(r.id); continue; }
    perClient[r.id] = r.counts;
    for (const k of Object.keys(office) as (keyof WorkDoneCounts)[]) office[k] += r.counts[k];
  }

  return NextResponse.json({ ok: true, from, to, office, perClient, unreadable });
}
