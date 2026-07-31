// src/lib/drawer-witness.ts
// [KAS-NEGATIEF] One place that answers "did this owner's cash drawer ever go below zero in this
// quarter?" — the witness the readiness verdict blocks on, the Kas page warns about, and (now)
// the filing gate refuses on.
//
// It exists because those three had to agree and could not: the computation was written out
// twice, in /api/readiness and /api/kasboek, and the filing gate did not do it at all. So the app
// told the owner, in its own voice on the Kas page, that a negative drawer "blokkeert je
// BTW-aangifte", while /api/btw/file checked four entirely different signals and let the quarter
// be frozen as ingediend with no question asked. /api/btw/file's own [FILING-GATE] comment states
// the intent — "gate on the SAME engine signals so filing and 'klaar' can never disagree" — and
// this is what makes that true rather than intended.
//
// FAIL-CLOSED, deliberately. Every read here either succeeds or throws:
//   · the two ledgers page with fetchAllRows, which throws on error;
//   · the opening float READS ITS ERROR, which the five call sites that fetch it did not.
//     Swallowing that one is not a smaller answer — it silently becomes a €0 starting balance,
//     which drags the whole running balance down and can INVENT a negative day on a drawer that
//     was never negative. In readiness that fabricates a blocker; here it would fabricate a
//     refusal to file. A caller that cannot read the drawer must say so, not guess it empty.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./supabase-paginate";
import {
  buildKasboek,
  openingBalanceForQuarter,
  lowestDrawerPoint,
  type KasTurnoverDay,
  type KasEntry,
  type Quarter,
} from "./kasboek";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export interface DrawerWitness {
  /** The lowest point the drawer reached this quarter, or null when it never went below zero. */
  lowestPoint: { date: string; balance: number } | null;
  /** The balance the quarter opened with (starting float + everything dated before it). */
  openingBalance: number;
}

/**
 * Read the drawer's full history up to the end of `quarter` and return its lowest point.
 *
 * Needs EVERYTHING up to the quarter end, not just the quarter itself: the opening balance is
 * carried from every prior movement, and a truncated carry-in is itself a wrong number.
 */
export async function loadDrawerWitness(args: {
  client: AnyClient;
  ownerId: string;
  year: number;
  quarter: number;
  /** Pass the already-known float to skip the profile read (readiness/kasboek hold it). */
  startingBalance?: number;
}): Promise<DrawerWitness> {
  const { client, ownerId, year, quarter } = args;
  const end = `${year}-12-31`;

  const turnover = (await fetchAllRows<{ turnover_date: string; cash_amount: number | null }>((from, to) =>
    client
      .from("daily_turnover")
      .select("turnover_date, cash_amount")
      .eq("user_id", ownerId)
      .lte("turnover_date", end)
      // turnover_date is UNIQUE per user (daily_turnover_unique_day) → a stable paging key.
      .order("turnover_date", { ascending: true })
      .range(from, to),
  )) as KasTurnoverDay[];

  const entries = (await fetchAllRows<{
    entry_date: string | null; direction: string; amount: number | null;
    category: string | null; description: string | null;
  }>((from, to) =>
    client
      .from("cash_entries")
      .select("entry_date, direction, amount, category, description")
      .eq("user_id", ownerId)
      .lte("entry_date", end)
      // [PAGE-KEY] id, never entry_date: several entries on one day is ordinary, Postgres
      // defines no order among ties, and a row served twice (or skipped) across .range()
      // windows shifts every eindsaldo after it.
      .order("id", { ascending: true })
      .range(from, to),
  )).map((r) => ({
    entry_date: r.entry_date,
    direction: r.direction === "in" ? "in" : "out",
    amount: r.amount,
    category: r.category,
    description: r.description,
  })) as KasEntry[];

  let startingBalance = args.startingBalance;
  if (startingBalance == null) {
    const { data: prof, error } = await client
      .from("profiles")
      .select("kas_opening_balance")
      .eq("id", ownerId)
      .maybeSingle();
    // See the header: a failed read here is not "no float", it is "we do not know the float".
    if (error) throw new Error(`kas_opening_balance read failed: ${error.message}`);
    startingBalance = Number((prof as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;
  }

  const openingBalance = openingBalanceForQuarter({
    turnover, entries, year, quarter: quarter as Quarter, startingBalance,
  });
  const kasboek = buildKasboek({ turnover, entries, year, quarter: quarter as Quarter, openingBalance });
  return { lowestPoint: lowestDrawerPoint(kasboek), openingBalance };
}
