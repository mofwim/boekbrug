// src/app/api/kasboek/route.ts
// [KASBOEK] The cash book as LIVE DATA (and, on demand, the store's own .xlsx). A pure PROJECTION
// over the truth layer: it combines the till's daily CASH takings (daily_turnover.cash_amount)
// with the cash-book movements (cash_entries: 'betaling' settlements + manual expenses/deposits)
// and computes the running drawer balance per day. It PERSISTS NOTHING and books NOTHING into the
// P&L — the omzet is already counted once by the turnover engine — so there is no double-count.
//
// ?year&quarter select the period (default: last completed quarter). ?format=xlsx returns the
// Kiwi-format spreadsheet; otherwise JSON for the live screen. Owner-scoped (session/RLS).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { quarterFromParams } from "@/lib/quarter";
import {
  buildKasboek,
  openingBalanceForQuarter,
  kasboekToMatrix,
  type KasTurnoverDay,
  type KasEntry,
  type Quarter,
} from "@/lib/kasboek";
import { matrixToXlsxBytes } from "@/lib/xlsx-adapter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const { year, quarter } = quarterFromParams((k) => sp.get(k));
  const format = (sp.get("format") ?? "json").toLowerCase();

  // Everything up to the end of the quarter — the opening balance needs all prior movements, and
  // the pure functions filter to the period themselves. Both queries owner-scoped + paginated.
  const end = `${year}-12-31`;
  const turnover = (await fetchAllRows<{ turnover_date: string; cash_amount: number | null }>((from, to) =>
    supabase.from("daily_turnover").select("turnover_date, cash_amount")
      .eq("user_id", user.id).lte("turnover_date", end)
      .order("turnover_date", { ascending: true }).range(from, to),
  ).catch(() => [])) as KasTurnoverDay[];
  const rawEntries = (await fetchAllRows<{ entry_date: string | null; direction: string; amount: number | null; category: string | null; description: string | null }>((from, to) =>
    supabase.from("cash_entries").select("entry_date, direction, amount, category, description")
      .eq("user_id", user.id).lte("entry_date", end)
      .order("entry_date", { ascending: true }).range(from, to),
  ).catch(() => []));
  const entries: KasEntry[] = rawEntries.map((r) => ({
    entry_date: r.entry_date,
    direction: r.direction === "in" ? "in" : "out",
    amount: r.amount,
    category: r.category,
    description: r.description,
  }));

  // [KAS-OPENING] Seed the very first period with the drawer's starting float so the Kasboek
  // eindsaldo matches the headline saldo and reality. openingBalanceForQuarter then carries it
  // forward through every prior quarter's movements.
  const { data: prof } = await supabase.from("profiles").select("kas_opening_balance").eq("id", user.id).maybeSingle();
  const startingBalance = Number((prof as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;

  const opening = openingBalanceForQuarter({ turnover, entries, year, quarter: quarter as Quarter, startingBalance });
  const kb = buildKasboek({ turnover, entries, year, quarter: quarter as Quarter, openingBalance: opening });

  if (format === "xlsx") {
    const bytes = matrixToXlsxBytes(kasboekToMatrix(kb), `Kasboek Q${quarter} ${year}`);
    return new NextResponse(Buffer.from(bytes) as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Kasboek-Q${quarter}-${year}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ ok: true, kasboek: kb });
}
