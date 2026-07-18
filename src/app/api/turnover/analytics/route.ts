// src/app/api/turnover/analytics/route.ts
// [TURNOVER-ANALYTICS] Read-only KPIs over the owner's daily turnover for a quarter:
// trend, VAT mix, payment mix, average day, average PIN ticket (from the bank's AANT
// counts), and anomalies. User-scoped (RLS server client). Pure math in
// computeTurnoverAnalytics; this only fetches and passes.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeTurnoverAnalytics } from "@/lib/turnover-analytics";
import { parsePosSettlement, type DailyTurnover } from "@/lib/turnover";

function pad(n: number): string { return String(n).padStart(2, "0"); }
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const sp = req.nextUrl.searchParams;
  const explicitYear = sp.get("year");
  const explicitQuarter = sp.get("quarter");

  let year: number;
  let quarter: 1 | 2 | 3 | 4;
  if (explicitYear || explicitQuarter) {
    year = Number(explicitYear) || now.getUTCFullYear();
    quarter = ([1, 2, 3, 4].includes(Number(explicitQuarter))
      ? Number(explicitQuarter)
      : Math.floor(now.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  } else {
    // [TURNOVER-SHOW] No explicit period → default to the quarter of the owner's MOST RECENT booked
    // day, so "ga naar Dagomzet" actually shows their omzet. Booking Q2 while the calendar is in Q3
    // must not land on an empty current quarter (the "geboekt ✓ maar niks te zien" trap). Falls back
    // to the calendar quarter when nothing is booked yet.
    const { data: latest } = await supabase
      .from("daily_turnover")
      .select("turnover_date")
      .eq("user_id", user.id)
      .order("turnover_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ref = latest?.turnover_date ? new Date(`${latest.turnover_date}T00:00:00Z`) : now;
    year = ref.getUTCFullYear();
    quarter = (Math.floor(ref.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  }

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;

  const { data: turnoverRows } = await supabase
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", user.id)
    .gte("turnover_date", start)
    .lte("turnover_date", end);

  const turnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));

  // Total card transactions (Σ AANT) from the bank's pos_income lines — the honest basis
  // for an average PIN ticket. Undefined when there are no such lines (then the KPI is null).
  let ticketCount: number | undefined;
  if (turnover.length > 0) {
    const { data: posRows } = await supabase
      .from("bank_transactions")
      .select("description")
      .eq("user_id", user.id)
      .eq("category", "pos_income")
      .gte("date", shiftDays(start, -5))
      .lte("date", shiftDays(end, 5));
    const rows = posRows ?? [];
    if (rows.length > 0) {
      ticketCount = rows.reduce((s, r) => s + (parsePosSettlement(r.description).count ?? 0), 0);
    }
  }

  const analytics = computeTurnoverAnalytics(turnover, ticketCount);

  // [COHERENCE-TURNOVER-DELETE] The per-day list so the owner can REMOVE a wrong-date /
  // wrong-period booked day (the DELETE /api/turnover/import handler existed but had no
  // caller — a phantom day fed the BTW return with no way to reverse it). Sorted newest
  // first; each row carries the date + booked total the delete UI acts on.
  const days = turnover
    .map((t) => ({ date: t.turnover_date, total: t.total_incl ?? 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return NextResponse.json({ ok: true, year, quarter, label: `Q${quarter} ${year}`, analytics, days });
}
