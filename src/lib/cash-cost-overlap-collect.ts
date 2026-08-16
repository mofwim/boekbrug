// src/lib/cash-cost-overlap-collect.ts
// [KAS-DUBBELE-KOST] The I/O around the pure detector in cash-cost-overlap.ts. All the money rules
// live there; this reads the two sides and hands them over.
//
// Two sides, and they are deliberately read with different bounds. The cash lines are bounded by
// the period the caller is showing — a question about a quarter the owner is not looking at is
// noise. The invoices are read one window WIDER on both ends, because the pairing itself spans up
// to OVERLAP_WINDOW_DAYS: a cash line on 2 April and its invoice dated 28 March are the same
// purchase, and reading the invoices on the period's own boundary would drop exactly the pairs
// that straddle it. A detector that goes quiet at a quarter edge is worse than one that never ran,
// because the quarter edge is where the aangifte is.
//
// [NO-SILENT-EMPTY] A failed read returns readFailed, never an empty list. "We found nothing" and
// "we could not look" are different answers, and only one of them means the books are clean.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-paginate";
// [KAS-ZACHT] Every reader of cash_entries goes through this — a removed movement counts nowhere,
// and a soft-deleted line the owner already took out must not come back as a question.
import { liveCashEntries, cashInvoiceLinkSupported } from "@/lib/cash-live";
import {
  detectCashCostOverlaps, OVERLAP_WINDOW_DAYS,
  type CashCostEntry, type CashCostOverlap, type PurchaseForOverlap,
} from "@/lib/cash-cost-overlap";

export interface CollectedCashCostOverlaps {
  overlaps: CashCostOverlap[];
  /** True when a read failed: the answer is "we could not look", never "there is nothing". */
  readFailed: boolean;
}

const EMPTY: CollectedCashCostOverlaps = { overlaps: [], readFailed: false };

const DAY_MS = 86_400_000;

/** An ISO day shifted by n days, for widening the invoice window past the period's edges. */
function shiftDay(iso: string, days: number): string {
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Every hand-typed cash cost in [from, to] that appears to be a purchase invoice already booked.
 *
 * `pipeline` is the service-role client: cash_entries and invoices are both owner-scoped by RLS,
 * and this runs from server surfaces (the Kas page, the aangifte) that already established who is
 * asking. Scoped explicitly on user_id / receiver_id anyway — the client is not the guard.
 */
export async function collectCashCostOverlaps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: SupabaseClient<any>,
  ownerId: string,
  range: { from: string; to: string },
): Promise<CollectedCashCostOverlaps> {
  const from = range.from.slice(0, 10);
  const to = range.to.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return EMPTY;

  try {
    const live = await liveCashEntries(pipeline);
    // [DEPLOY-SAFE] invoice_id arrives with cash_settlement_invoice_link.sql, and selecting a
    // column that does not exist fails the whole read — measured against a real Postgres, 42703 on
    // both the projection and the filter. Without it there are no invoice-linked cash movements to
    // exclude in the first place (reconcileCashSettlements cannot write one either), so the
    // detector degrades to the same answer by a shorter road. See cashInvoiceLinkSupported.
    const linked = await cashInvoiceLinkSupported(pipeline);
    const projection = linked
      ? "id, entry_date, direction, amount, category, description, invoice_id, btw_rate, document_id"
      : "id, entry_date, direction, amount, category, description, btw_rate, document_id";
    const entries = await fetchAllRows<CashCostEntry>(
      (lo, hi) => {
        const base = live.only(pipeline
          .from("cash_entries")
          .select(projection)
          .eq("user_id", ownerId)
          .eq("category", "kosten")
          .eq("direction", "out")
          .gte("entry_date", from)
          .lte("entry_date", to));
        // A settlement belongs to its invoice and is the correct mechanism, not a duplicate of it.
        // Filtered here as well as in the pure isOwnerTypedCost, because reading rows we will
        // certainly discard is paid for on every page of the drawer.
        const scoped = linked ? base.is("invoice_id", null) : base;
        return scoped
          .order("id", { ascending: true })
          .range(lo, hi) as unknown as PromiseLike<{ data: CashCostEntry[] | null; error: { message: string } | null }>;
      },
    );
    // Nothing typed by hand in this period → nothing to ask about, and no reason to read the
    // invoices at all. The common case for every owner who uses the upload button as intended.
    if (entries.length === 0) return EMPTY;

    const invoices = await fetchAllRows<PurchaseForOverlap>(
      (lo, hi) => pipeline
        .from("invoices")
        .select("id, invoice_number, client_name, invoice_date, payment_date, total_ex_btw, total_inc_btw, status, payment_method, invoice_type, direction")
        .eq("receiver_id", ownerId)
        // Only the statuses whose cost financial-result.ts actually books — see booksACost, which
        // applies the same rule again on the pure side so the two can never drift apart.
        .in("status", ["paid", "received"])
        // One window wider on both ends: the pair itself may straddle the period boundary.
        .gte("invoice_date", shiftDay(from, -OVERLAP_WINDOW_DAYS))
        .lte("invoice_date", shiftDay(to, OVERLAP_WINDOW_DAYS))
        .order("id", { ascending: true })
        .range(lo, hi) as unknown as PromiseLike<{ data: PurchaseForOverlap[] | null; error: { message: string } | null }>,
    );

    return { overlaps: detectCashCostOverlaps({ entries, invoices }), readFailed: false };
  } catch (e) {
    // [NO-SILENT-EMPTY] Reported as unknown rather than as none — a caller that draws "geen
    // dubbele kosten gevonden" from a failed read is making a claim about the books it did not
    // check, on the screen the accountant reads.
    console.error("[KAS-DUBBELE-KOST] overlap read failed — reporting it as unknown, not as none", {
      ownerId, error: e instanceof Error ? e.message : String(e),
    });
    return { overlaps: [], readFailed: true };
  }
}
