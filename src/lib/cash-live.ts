// src/lib/cash-live.ts
// [KAS-ZACHT] One definition of "the cash movements that still count".
//
// A removed kasboek line is soft-deleted now (cash_entry_soft_delete.sql): the row stays, and
// deleted_at says it is out of the books. That turns one hard delete into a rule that has to hold in
// EIGHTEEN reads — the drawer balance, the kasboek projection, the result engine, the aangifte, the
// readiness and filing witness, search, the home snapshot, the accountant's closing package, the
// settlement reconcile. Miss one and a removed movement still counts THERE and nowhere else, which is
// worse than the hard delete ever was: two surfaces then disagree about the same euro, and neither
// looks broken.
//
// Every defect found in this line during the audit had that exact shape — a rule applied in one place
// and not its sibling. So the rule does not get written eighteen times. It lives here, and
// [KAS-SAMENHANG] in lifecycle-gates.test.ts asserts that every reader of cash_entries goes through
// it.
//
// ── DEPLOY-SAFE, AND THIS ONE MATTERS MORE THAN MOST ──
//
// Code ships before a migration is applied by hand. Filtering on a column that does not exist fails
// the read — and these reads are the drawer balance, the kasboek, readiness and the filing gate. The
// app would lose its cash administration on every screen at once, which is a far worse outage than
// the problem this feature fixes.
//
// So the column is PROBED, exactly like cash_entries.settlement_id before it (cash-settle.ts): with
// it, removed rows are filtered out everywhere; without it, nothing is filtered and the DELETE door
// still removes the row — the behaviour of the day before this shipped. The migration switches the
// feature on by itself, with no second deploy.
//
// Cached only when TRUE, for the same reason as its neighbour: a false answer must stay re-checkable,
// or a server instance that started before the migration keeps the old behaviour until it happens to
// restart.

import type { SupabaseClient } from "@supabase/supabase-js";

let softDeleteColumnKnown = false;

/** Does this database have cash_entries.deleted_at yet? See the header for why it is probed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cashSoftDeleteSupported(supabase: SupabaseClient<any>): Promise<boolean> {
  if (softDeleteColumnKnown) return true;
  try {
    const { error } = await supabase.from("cash_entries").select("deleted_at").limit(1);
    if (error) return false;
    softDeleteColumnKnown = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * The minimum a PostgREST builder has to offer for the filter to be applied to it. Structural on
 * purpose: the same helper is used with the typed session client and the `any`-typed service-role
 * pipeline client, and `.is()` returns the same builder either way.
 */
export interface CashLiveFilterable {
  is(column: string, value: null): unknown;
}

/**
 * The live-rows reader for one request.
 *
 * Usage — one await, one wrap, and everything else chains as before:
 *
 *     const cash = await liveCashEntries(client);
 *     await fetchAllRows((from, to) =>
 *       cash.only(client.from("cash_entries").select("…").eq("user_id", uid))
 *         .order("id", { ascending: true }).range(from, to));
 *
 * The boolean is resolved ONCE per request rather than inside the page callback: fetchAllRows builds
 * a query per page, and probing per page would be a wasted round trip on every one of them while the
 * column is still absent (the cache only holds a positive answer).
 */
export async function liveCashEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
): Promise<{ supported: boolean; only: <T extends CashLiveFilterable>(q: T) => T }> {
  const supported = await cashSoftDeleteSupported(supabase);
  return { supported, only: (q) => onlyLiveCash(q, supported) };
}

/**
 * Apply the filter to a query. Pure — the capability comes in as a boolean, so the rule itself is
 * testable without a database.
 *
 * `deleted_at IS NULL` and not `not.is(deleted_at, null)`: a live row is the DEFAULT state, and the
 * partial index in the migration is built on exactly this predicate.
 */
export function onlyLiveCash<T extends CashLiveFilterable>(q: T, supported: boolean): T {
  return supported ? (q.is("deleted_at", null) as T) : q;
}
