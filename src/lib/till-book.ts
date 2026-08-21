// src/lib/till-book.ts
// [KASSA] The one writer that turns a shop's rung-up sales into the day the financial engines read.
//
// Every mutation of till_sales — a ticket rung up, a ticket voided — ends here, and this is the ONLY
// place that writes a daily_turnover row with source 'manual'. Keeping it to one function is what
// makes "one day, one source" a property of the code rather than a rule two routes each remember.
//
// It rebuilds the whole day from the sales every time rather than adjusting the row by a delta. A
// delta is faster and wrong the first time anything is voided, retried or double-posted; a rebuild
// is idempotent by construction, so re-running it over the same day corrects rather than doubles —
// the same property that makes bookTurnoverRows safe to re-run over a file.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./supabase-paginate";
import { bookTurnoverRows } from "./turnover-book";
import { salesToTurnoverRow, type TillMethod, type TillSale } from "./till-day";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

/** The source value this module owns. Anything else on a day means the day is not ours to write. */
export const TILL_SOURCE = "manual";

export interface TillSaleRow extends TillSale {
  id: string;
  ticket_id: string;
  sale_date: string;
  article_id: string | null;
  created_at: string | null;
}

export interface RebuildResult {
  ok: boolean;
  /** Gross takings of the day after the rebuild. 0 when the day is now empty. */
  total_incl: number;
  /** The day's sales after the rebuild, newest first. */
  sales: TillSaleRow[];
  /** Dutch, for the owner. Set only when ok is false. */
  error?: string;
}

/** Read one day's sales, newest first. Paged — a busy shop's day can pass the ~1000-row cap. */
export async function readDaySales(
  supabase: AnySupabase,
  userId: string,
  date: string,
): Promise<TillSaleRow[]> {
  const rows = await fetchAllRows<{
    id: string; ticket_id: string; sale_date: string; description: string;
    quantity: number; unit_price_incl: number; btw_rate: number; method: string;
    article_id: string | null; created_at: string | null;
  }>((from, to) =>
    supabase
      .from("till_sales")
      .select("id, ticket_id, sale_date, description, quantity, unit_price_incl, btw_rate, method, article_id, created_at")
      .eq("user_id", userId)
      .eq("sale_date", date)
      // A stable unique order is what fetchAllRows requires to page without gaps or repeats.
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows
    .map((r) => ({
      id: r.id,
      ticket_id: r.ticket_id,
      sale_date: r.sale_date,
      description: r.description,
      quantity: Number(r.quantity),
      unit_price_incl: Number(r.unit_price_incl),
      btw_rate: Number(r.btw_rate),
      method: r.method as TillMethod,
      article_id: r.article_id,
      created_at: r.created_at,
    }))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

/**
 * Rebuild one day's daily_turnover row from its till_sales. Call after EVERY mutation.
 *
 * ── WHY AN EMPTY DAY IS DELETED, NOT ZEROED ──
 * A daily_turnover row with all-zero amounts is not a harmless leftover: `covered` in
 * financial-result and `tillCountedDays` in kasboek both key on the day EXISTING with revenue, and
 * the readiness/aangifte screens count turnover days. More importantly, a day that is present but
 * empty is a day the owner can no longer record any other way — the conflict guard would keep
 * pointing at a row representing nothing. Voiding the last ticket of the day must leave the day as
 * untouched as it was before the first one.
 */
export async function rebuildTillDay(
  supabase: AnySupabase,
  userId: string,
  date: string,
): Promise<RebuildResult> {
  // Defense in depth. The routes refuse a day that carries an imported Z-report before they write
  // anything (daySourceConflict), but bookTurnoverRows upserts on (user, date) without looking at
  // `source` — so if that guard were ever bypassed, this writer would overwrite a printed till
  // report with hand-rung figures. Check here too: this is the function that does the damage.
  const { data: existing, error: readError } = await supabase
    .from("daily_turnover")
    .select("source")
    .eq("user_id", userId)
    .eq("turnover_date", date)
    .maybeSingle();
  if (readError) {
    return { ok: false, total_incl: 0, sales: [], error: "Kon de dag niet bijwerken." };
  }
  if (existing && existing.source !== TILL_SOURCE) {
    return {
      ok: false,
      total_incl: 0,
      sales: [],
      error: "Voor deze dag staat al een ingelezen kassa-rapport. Die dag wordt niet overschreven.",
    };
  }

  const sales = await readDaySales(supabase, userId, date);

  if (sales.length === 0) {
    const { error } = await supabase
      .from("daily_turnover")
      .delete()
      .eq("user_id", userId)
      .eq("turnover_date", date)
      .eq("source", TILL_SOURCE);
    if (error) return { ok: false, total_incl: 0, sales: [], error: "Kon de dag niet bijwerken." };
    return { ok: true, total_incl: 0, sales: [] };
  }

  const row = salesToTurnoverRow(date, sales);
  const booked = await bookTurnoverRows(supabase, userId, [row], TILL_SOURCE);
  if (!booked.ok) {
    return {
      ok: false,
      total_incl: 0,
      sales,
      // `rejected` is the arithmetic gate; an empty one means the database write itself failed.
      // Telling an owner "probeer opnieuw" over figures that cannot be true sends him to repeat it.
      error: booked.rejected.length
        ? `De bedragen van deze dag kunnen niet kloppen (${booked.rejected[0]}).`
        : "Kon de dag niet opslaan.",
    };
  }
  return { ok: true, total_incl: booked.total_incl, sales };
}
