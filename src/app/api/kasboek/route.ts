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
  removedInQuarter,
  quarterRange,
  type KasTurnoverDay,
  type KasEntry,
  type RemovedKasEntry,
  lowestDrawerPoint,
  type Quarter,
} from "@/lib/kasboek";
import { matrixToXlsxBytes } from "@/lib/xlsx-adapter";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "@/lib/cash-live";
// [KAS-BRUG] The fourth reason a drawer goes below zero — a bank cash withdrawal the cash book never
// heard about. The bank half is recognised by the classifier's own patterns, never a copy of them.
import { findUnrecordedCashWithdrawals } from "@/lib/cash-transfer-match";
import { isCashTransferDescription } from "@/lib/bank-identity";
// [KAS-DUBBELE-KOST] The same purchase written down twice — see cash-cost-overlap.ts.
import { collectCashCostOverlaps } from "@/lib/cash-cost-overlap-collect";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [DIEP-3] Bounded like its siblings — the day-end audit found this one uncapped.
  const limited = await checkRateLimit({ userId: user.id, endpoint: "kasboek-export", ...RATE_LIMITS.HEAVY_EXPORT });
  if (!limited.allowed) return rateLimitResponse(limited);

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
  // [KAS-ZACHT] Removed movements are out of the books: out of the running balance, out of the sheet
  // the accountant receives, and out of the witness this route hands the negative-drawer banner.
  const cash = await liveCashEntries(supabase);
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
      cash.only(supabase.from("cash_entries").select("entry_date, direction, amount, category, description")
        .eq("user_id", user.id).lte("entry_date", end))
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
  // [NO-EMPTY-LEDGER] The float is part of the ledger, so its read is held to the same rule as
  // the two above: a swallowed error becomes a €0 starting balance, and a cash book whose opening
  // balance is silently wrong is exactly the kind of unexplainable eindsaldo this route refuses
  // to hand the accountant.
  const { data: prof, error: profErr } = await supabase.from("profiles").select("kas_opening_balance").eq("id", user.id).maybeSingle();
  if (profErr) {
    console.error("[NO-EMPTY-LEDGER] kas_opening_balance read failed — refusing to serve a cash book", { userId: user.id, error: profErr.message });
    const detail = "We konden je beginsaldo nu niet lezen. Zonder dat klopt het eindsaldo niet, dus we tonen het kasboek liever niet. Probeer het zo meteen opnieuw.";
    if (format === "xlsx") {
      return new NextResponse(detail, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "kasboek_unavailable", detail }, { status: 503 });
  }
  const startingBalance = Number((prof as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;

  const opening = openingBalanceForQuarter({ turnover, entries, year, quarter: quarter as Quarter, startingBalance });
  const kb = buildKasboek({ turnover, entries, year, quarter: quarter as Quarter, openingBalance: opening });

  // ── [KAS-SPOOR] What this quarter's cash book HELD and no longer holds ───────────────────────
  //
  // A cash_entries delete is a hard delete: the row is gone, and the audit trail is the only place
  // the movement still exists. So this is the one question the cash book cannot answer from its own
  // rows, and it is a question both the owner and their accountant are entitled to ask about a
  // period — a cash administration where lines can disappear without trace is exactly the shape an
  // inspector treats as unreliable.
  //
  // Read with the OWNER's session (audit_logs has a "Users see own logs" SELECT policy), so this
  // discloses nobody else's trail and cannot widen what anyone sees.
  //
  // A failure here does NOT refuse the cash book, unlike the three source reads above. That is a
  // deliberate difference in kind: those three DECIDE the saldi, so half of them produces a wrong
  // number presented as a right one. This one is a disclosure ALONGSIDE the saldi — the balances are
  // complete without it — so refusing the whole book over it would trade a real answer for no
  // answer. It says it could not look instead, and the panel says so too.
  let removed: RemovedKasEntry[] = [];
  let removedUnknown = false;
  {
    const { data: trail, error: trailErr } = await supabase
      .from("audit_logs")
      .select("old_value, created_at")
      .eq("user_id", user.id)
      .eq("action", "cash.entry_removed")
      .order("created_at", { ascending: false })
      // A ceiling, and it is DISCLOSED rather than silent: beyond this many removals the list is
      // the newest ones and removedUnknown says the rest were not read. A silent slice here would
      // be a cash book quietly claiming that nothing else was ever taken out of it.
      .limit(500);
    if (trailErr) {
      console.error("[KAS-SPOOR] removed-entry trail unreadable — the kasboek is served without it", { userId: user.id, error: trailErr.message });
      removedUnknown = true;
    } else {
      const rows = trail ?? [];
      removedUnknown = rows.length >= 500;
      const all: RemovedKasEntry[] = rows.flatMap((r) => {
        const o = (r as { old_value?: Record<string, unknown> | null }).old_value ?? null;
        if (!o) return [];
        const date = typeof o.entry_date === "string" ? o.entry_date.slice(0, 10) : null;
        const amount = Math.abs(Number(o.amount) || 0);
        if (!date || amount === 0) return [];
        return [{
          date,
          direction: o.direction === "in" ? "in" as const : "out" as const,
          amount,
          category: typeof o.category === "string" ? o.category : null,
          description: typeof o.description === "string" ? o.description : null,
          removedOn: typeof (r as { created_at?: string | null }).created_at === "string"
            ? (r as { created_at: string }).created_at.slice(0, 10)
            : null,
        }];
      });
      removed = removedInQuarter(all, year, quarter as Quarter);
    }
  }

  if (format === "xlsx") {
    const bytes = matrixToXlsxBytes(kasboekToMatrix(kb, removed), `Kasboek Q${quarter} ${year}`);
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
  // ── [KAS-BRUG] The fourth reason, looked up only when there is something to explain ───────────
  //
  // The drawer went below zero, so the app is refusing this quarter's aangifte and the Kas screen is
  // about to name three possible causes. There is a fourth and in a shop it is the most ordinary of
  // all: cash was taken out of the bank and the opname was never written in the cash book. The
  // withdrawal is on a statement this app has already imported and already classified.
  //
  // Naming it is not a nicety. A gate that refuses a filing over a number while holding the most
  // likely innocent explanation for that number in its own database is accusing someone with the
  // evidence in its pocket.
  //
  // Read ONLY when the drawer is actually negative. Two reasons: the answer is worthless otherwise
  // (an unrecorded withdrawal in a healthy drawer is a bookkeeping tidiness matter, not a blocker,
  // and nagging about it here would be noise under no banner at all), and this endpoint is on the
  // page's load path — it must not grow a bank read for every owner who has no problem.
  const dip = lowestDrawerPoint(kb);
  let unrecordedWithdrawals: Array<{ date: string; amount: number; description: string | null }> = [];
  if (dip) {
    // The shared range — June has 30 days, and a hand-rolled "-31" is a cast error on a `date`
    // column rather than an empty result. See quarterRange.
    const { start: qStart, end: qEnd } = quarterRange(year, quarter as Quarter);
    // A failed read leaves the list empty and the three original causes standing. It must NOT fail
    // the kasboek: this is an explanation offered alongside an accusation, and losing it costs the
    // owner a hint, while refusing the whole book would cost them the cash administration itself.
    const { data: bankRows, error: bankErr } = await supabase
      .from("bank_transactions")
      .select("id, date, amount, description, counterpart_name")
      .eq("user_id", user.id)
      .eq("category", "transfer")
      .gte("date", qStart)
      .lte("date", qEnd)
      .order("date", { ascending: true });
    if (bankErr) {
      console.error("[KAS-BRUG] bank cash-transfer read failed — the drawer warning keeps its three causes", { userId: user.id, error: bankErr.message });
    } else {
      const cashLines = (bankRows ?? []).filter((r) =>
        isCashTransferDescription(r.description, (r as { counterpart_name?: string | null }).counterpart_name ?? null),
      );
      unrecordedWithdrawals = findUnrecordedCashWithdrawals({
        bankLines: cashLines.map((r) => ({
          id: r.id, date: r.date, amount: r.amount, description: r.description,
          counterpartName: (r as { counterpart_name?: string | null }).counterpart_name ?? null,
        })),
        // The drawer's own transfers, from the rows this route already read — no second query, and
        // no chance of the two halves describing different periods.
        drawerTransfers: entries
          .filter((e) => (e.category ?? "") === "transfer")
          .map((e) => ({ date: e.entry_date, direction: e.direction, amount: e.amount })),
      }).map((w) => ({ date: w.date, amount: w.amount, description: w.description }));
    }
  }

  // ── [KAS-DUBBELE-KOST] The same purchase, written down twice ─────────────────────────────────
  //
  // Unlike [KAS-BRUG] above, this is NOT conditional on a negative drawer, and the difference is
  // the point. An unrecorded opname is a tidiness matter until the drawer goes below zero; a cash
  // 'kosten' line that duplicates a purchase invoice is wrong the moment it exists — the cost is
  // deducted twice and the aangifte is built on it, in a drawer that looks perfectly healthy.
  // There is no symptom to wait for.
  //
  // Bounded to the quarter on screen and skipped entirely when nothing was typed by hand, so the
  // owner who uses the [KAS-UPLOAD] button as intended pays for one small indexed read.
  //
  // A failed read must not fail the kasboek: this is a question offered alongside a cash book, and
  // losing the question costs a hint while refusing the book costs the administration. It comes
  // back as readFailed so the panel can say "we could not check" instead of "niets gevonden".
  const { start: dupStart, end: dupEnd } = quarterRange(year, quarter as Quarter);
  const doubleCosts = await collectCashCostOverlaps(supabase, user.id, { from: dupStart, to: dupEnd });

  return NextResponse.json({
    ok: true,
    kasboek: kb,
    lowestPoint: dip,
    // [KAS-DUBBELE-KOST] Cash costs typed by hand that appear to be an invoice already in the
    // books. `unknown` is the honest half — a read that failed is not a clean quarter.
    doubleCosts: doubleCosts.overlaps.map((o) => ({
      entryId: o.entry.id,
      entryDate: o.entry.entry_date,
      entryAmount: o.entry.amount,
      entryDescription: o.entry.description,
      invoiceId: o.invoice.id,
      invoiceNumber: o.invoice.invoice_number,
      supplier: o.invoice.client_name,
      basis: o.basis,
      daysApart: o.daysApart,
      nameMatched: o.nameMatched,
      drawerDoubled: o.drawerDoubled,
      doubleCountedCost: o.doubleCountedCost,
      doubleCountedBtw: o.doubleCountedBtw,
    })),
    doubleCostsUnknown: doubleCosts.readFailed,
    // [KAS-BRUG] Cash withdrawals from the bank that no opname in this quarter accounts for. Empty
    // unless the drawer went negative — the question is only asked when it has to be answered.
    unrecordedWithdrawals,
    // [KAS-SPOOR] Alongside the saldi, never inside them — the movements this quarter no longer
    // holds. `removedUnknown` is the honest half: the trail could not be read, or there is more of
    // it than one read returns.
    removed,
    removedUnknown,
  });
}
