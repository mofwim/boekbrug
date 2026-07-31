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
  lowestDrawerPoint,
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
  //
  // [NO-EMPTY-LEDGER] Neither read may fail QUIETLY, and both used to: they carried
  // `.catch(() => [])`, which turns a failed read into an empty one. A kasboek is a RUNNING
  // BALANCE over two sources, so an empty source is not a smaller answer — it is a different,
  // wrong one, and it comes out looking completely normal:
  //
  //   · the screen says "Geen kasbewegingen in dit kwartaal" — a sentence that means "no money
  //     moved", not "we could not look";
  //   · ?format=xlsx hands the ACCOUNTANT a cash book with no rows and a fabricated eindsaldo;
  //   · and lowestPoint below becomes null, so the red "je kas stond op … onder nul" banner on
  //     the Kas page disappears — the banner whose own text says the app is blocking the BTW
  //     aangifte over exactly this. The gate itself does NOT unblock (readiness re-reads without
  //     a catch and errors instead), so the owner was left with a blocked filing and the one
  //     screen that explains it gone silent.
  //
  // The closing package already refuses to emit this very sheet when either source fails
  // (closing-package.ts, same [NO-EMPTY-LEDGER] tag) and says why. This is that rule, here.
  const end = `${year}-12-31`;
  let turnover: KasTurnoverDay[];
  let rawEntries: Array<{ entry_date: string | null; direction: string; amount: number | null; category: string | null; description: string | null }>;
  try {
    turnover = (await fetchAllRows<{ turnover_date: string; cash_amount: number | null }>((from, to) =>
      supabase.from("daily_turnover").select("turnover_date, cash_amount")
        .eq("user_id", user.id).lte("turnover_date", end)
        // turnover_date is UNIQUE per user (daily_turnover_unique_day), so this is a stable
        // paging key.
        .order("turnover_date", { ascending: true }).range(from, to),
    )) as KasTurnoverDay[];
    rawEntries = await fetchAllRows<{ entry_date: string | null; direction: string; amount: number | null; category: string | null; description: string | null }>((from, to) =>
      supabase.from("cash_entries").select("entry_date, direction, amount, category, description")
        .eq("user_id", user.id).lte("entry_date", end)
        // [PAGE-KEY] Ordered by id, not entry_date. entry_date is NOT unique — several cash
        // entries on one day is the ordinary case for a shop — and Postgres gives no defined
        // order among ties, so across separate .range() windows a row could be served twice or
        // skipped. In a RUNNING balance that does not spoil one day: it shifts every eindsaldo
        // after it, in the sheet the accountant reads and in the witness that blocks the filing.
        // The pure builders group by day and sort themselves, so the read order is free.
        .order("id", { ascending: true }).range(from, to),
    );
  } catch (e) {
    console.error("[NO-EMPTY-LEDGER] kasboek source read failed — refusing to serve a cash book", { userId: user.id, year, quarter, error: e instanceof Error ? e.message : String(e) });
    const detail =
      "We konden je kasboek nu niet volledig lezen. Een half kasboek zou een eindsaldo tonen dat nergens op slaat, dus we tonen het liever niet. Probeer het zo meteen opnieuw.";
    // The xlsx link is a plain <a href> the owner (or their accountant) clicks, so a JSON body
    // would land in the browser as raw braces. Answer that one in the language it was asked in.
    if (format === "xlsx") {
      return new NextResponse(detail, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ error: "kasboek_unavailable", detail }, { status: 503 });
  }
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

  // [KAS-NEGATIEF] The lowest point the drawer reaches in this quarter, computed with the SAME
  // witness the readiness gate blocks on (lowestDrawerPoint) — so the Kas page and the filing
  // gate can never tell the owner two different stories. A negative kassaldo is physically
  // impossible (you cannot pay out cash you never had) and is the single strongest signal the
  // Belastingdienst uses to reject a cash administration. Null when it never goes below zero.
  return NextResponse.json({ ok: true, kasboek: kb, lowestPoint: lowestDrawerPoint(kb) });
}
