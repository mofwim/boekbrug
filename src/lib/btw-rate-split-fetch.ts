// src/lib/btw-rate-split-fetch.ts
// [RUBRIEK-SPLIT] The I/O that reads invoice_lines and turns them into validated rate buckets.
// Kept out of btw-rate-split.ts so that module stays a pure, exhaustively-tested core.
//
// Both money surfaces that produce rubrieken call THIS — /api/aangifte (the declaration the owner
// files) and computeResultForRange (result + truth lens + the BTW filing snapshot) — so the two
// can never disagree about where a mixed-rate sale belongs.

import { rateSharesFromLines, type RateShare } from "./btw-rate-split";
import { fetchAllRowsForIds } from "./supabase-paginate";
import type { PipelineClient } from "./supabase-pipeline";

export interface RateSplitInvoice {
  id?: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
}

/**
 * The rate mix of every SALES invoice in `invoices` that genuinely has more than one rate.
 *
 * Only mixed-rate invoices end up in the map (rateSharesFromLines returns null otherwise), and
 * only when their lines add up to their own header — so a caller can use the result blindly: it
 * can move omzet between rubrieken, never change a total. An invoice with no stored lines (an
 * imported or legacy one) is simply absent, keeping the header-derived rate it always had.
 *
 * Best-effort: a failed read returns an empty map rather than breaking the aangifte, which then
 * computes exactly as it did before this existed.
 */
export async function fetchRateShares(
  pipeline: PipelineClient,
  invoices: readonly RateSplitInvoice[],
): Promise<Map<string, RateShare[]>> {
  const out = new Map<string, RateShare[]>();
  const ids = invoices.map((i) => i.id).filter((id): id is string => !!id);
  if (ids.length === 0) return out;

  try {
    // [IN-CHUNK] Chunked, because `ids` is EVERY sales invoice in the quarter. `.in()` has a second,
    // silent ceiling besides the row cap: the id list travels in the URL, so a few hundred uuids
    // outgrow the proxy's request line and the call dies with a 414 — which supabase-js reports as
    // an ordinary error, not an exception (supabase-paginate.ts:22-31). It landed in the catch
    // below, and the catch is by design quiet, so on a busy quarter the rate split would vanish
    // ENTIRELY: every mixed-rate invoice back to one blended, header-derived rate, and the whole
    // amount into a single rubriek — the exact failure this module was written to prevent. The row
    // cap was already handled; this is the other half.
    const lineRows = await fetchAllRowsForIds(ids, (chunk, from, to) =>
      pipeline
        .from("invoice_lines")
        .select("invoice_id, btw_rate, line_total")
        .in("invoice_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const byInvoice = new Map<string, Array<{ btw_rate: number | null; line_total: number | null }>>();
    for (const l of lineRows as Array<{ invoice_id: string | null; btw_rate: number | null; line_total: number | null }>) {
      if (!l.invoice_id) continue;
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({ btw_rate: l.btw_rate, line_total: l.line_total });
      byInvoice.set(l.invoice_id, list);
    }
    for (const inv of invoices) {
      if (!inv.id) continue;
      const shares = rateSharesFromLines(byInvoice.get(inv.id), inv.total_ex_btw ?? 0, inv.btw_amount ?? 0);
      if (shares) out.set(inv.id, shares);
    }
  } catch (e) {
    // Best-effort stays: no buckets → the header-derived rate, exactly as before this module
    // existed, and the TOTAL (5a, 5b, 5g) is identical either way — the split only ever moves
    // omzet BETWEEN rubrieken. What is not acceptable is that it used to fail INVISIBLY: with the
    // 414 path closed above, an error here is a real outage, and a rubriek split that quietly
    // degraded on a filed declaration should be findable afterwards.
    console.error("[RUBRIEK-SPLIT] invoice_lines read failed — falling back to the header rate", {
      invoiceCount: ids.length,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}
