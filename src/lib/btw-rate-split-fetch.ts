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
// [VRIJGESTELD] The exempt part of a sale is read from the SAME lines as the rate mix — one
// query, one truth. See vat-exemption.ts for why exempt is not a rate.
import { getVatTreatment } from "./vat-exemption";
import { reportHandledFailure } from "./report-handled";

export interface RateSplitInvoice {
  id?: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
}

export interface RateSplitResult {
  /** Invoice id → its validated rate mix. Only genuinely multi-rate invoices appear. */
  rateShares: Map<string, RateShare[]>;
  /**
   * [VRIJGESTELD] Invoice id → the ex-BTW amount on it that is exempt turnover (art. 11).
   * Empty unless the caller asked for it AND the invoice actually has exempt lines.
   */
  exemptExByInvoice: Map<string, number>;
  /**
   * [SPLIT-EERLIJK] Did the read fail, leaving both maps empty because we could not look?
   *
   * Empty maps are the normal answer for "no invoice in this quarter has more than one rate", and
   * they are ALSO the answer when the read fell over. The caller cannot tell those apart from the
   * maps, and for the aangifte that hardly matters — the totals (5a, 5b, 5g) are identical either
   * way, the split only moves omzet between rubrieken. For the AUDITFILE it matters a great deal:
   * that file is handed to an accountant and to the Belastingdienst as a description of the books,
   * and a sales entry silently carrying one blended header rate where the invoice has two is a
   * statement about the administratie that is not true. A file may say what it could not read;
   * it may not quietly say something else.
   */
  degraded: boolean;
}

/**
 * The rate mix of every SALES invoice in `invoices` that genuinely has more than one rate, plus
 * the exempt portion of each.
 *
 * Only mixed-rate invoices end up in the map (rateSharesFromLines returns null otherwise), and
 * only when their lines add up to their own header — so a caller can use the result blindly: it
 * can move omzet between rubrieken, never change a total. An invoice with no stored lines (an
 * imported or legacy one) is simply absent, keeping the header-derived rate it always had.
 *
 * [VRIJGESTELD] When `exemptRegime` is on, exempt lines are taken OUT of the rate mix before it
 * is built, and the remainder is validated against the header MINUS the exempt amount. Doing it
 * here rather than in the engine is what keeps the two facts consistent: an exempt line carries
 * btw_rate 0, so leaving it in would put it in the 0% bucket and straight into rubriek 1e — the
 * precise bug this feature exists to fix — while removing it without adjusting the header would
 * break the sum check and silently drop the split for the whole invoice.
 *
 * Best-effort: a failed read returns empty maps rather than breaking the aangifte, which then
 * computes exactly as it did before this existed.
 */
export async function fetchRateShares(
  pipeline: PipelineClient,
  invoices: readonly RateSplitInvoice[],
  // Off (the default) → exemptExByInvoice stays empty and every line counts toward the rate mix,
  // byte-identical to the behaviour before this parameter existed.
  opts: { exemptRegime?: boolean } = {},
): Promise<RateSplitResult> {
  const out = new Map<string, RateShare[]>();
  const exemptExByInvoice = new Map<string, number>();
  let degraded = false;
  const ids = invoices.map((i) => i.id).filter((id): id is string => !!id);
  if (ids.length === 0) return { rateShares: out, exemptExByInvoice, degraded: false };

  try {
    // [IN-CHUNK] Chunked, because `ids` is EVERY sales invoice in the quarter. `.in()` has a second,
    // silent ceiling besides the row cap: the id list travels in the URL, so a few hundred uuids
    // outgrow the proxy's request line and the call dies with a 414 — which supabase-js reports as
    // an ordinary error, not an exception (supabase-paginate.ts:22-31). It landed in the catch
    // below, and the catch is by design quiet, so on a busy quarter the rate split would vanish
    // ENTIRELY: every mixed-rate invoice back to one blended, header-derived rate, and the whole
    // amount into a single rubriek — the exact failure this module was written to prevent. The row
    // cap was already handled; this is the other half.
    // [VRIJGESTELD] vat_treatment only when it is asked for: on a deployment where the
    // vat_exemption.sql migration has not run yet, naming a column that does not exist fails the
    // WHOLE select — and this one feeds the rubriek split of every owner, not just exempt ones.
    // Two literal selects rather than one interpolated string: supabase-js parses the column
    // list at the TYPE level, and a `string` variable there collapses the row type to a parser
    // error. The branch is the point anyway — see the note above.
    const lineRows = await fetchAllRowsForIds(ids, (chunk, from, to) =>
      opts.exemptRegime
        ? pipeline
            .from("invoice_lines")
            .select("invoice_id, btw_rate, line_total, vat_treatment")
            .in("invoice_id", chunk)
            .order("id", { ascending: true })
            .range(from, to)
        : pipeline
            .from("invoice_lines")
            .select("invoice_id, btw_rate, line_total")
            .in("invoice_id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
    );
    type LineRow = { btw_rate: number | null; line_total: number | null; vat_treatment?: string | null };
    const byInvoice = new Map<string, LineRow[]>();
    for (const l of lineRows as Array<LineRow & { invoice_id: string | null }>) {
      if (!l.invoice_id) continue;
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({ btw_rate: l.btw_rate, line_total: l.line_total, vat_treatment: l.vat_treatment });
      byInvoice.set(l.invoice_id, list);
    }
    for (const inv of invoices) {
      if (!inv.id) continue;
      const lines = byInvoice.get(inv.id);
      const headerEx = inv.total_ex_btw ?? 0;
      const headerBtw = inv.btw_amount ?? 0;

      if (!opts.exemptRegime || !lines) {
        const shares = rateSharesFromLines(lines, headerEx, headerBtw);
        if (shares) out.set(inv.id, shares);
        continue;
      }

      // Split the lines in two. A line LABELLED exempt but carrying a real rate is a
      // contradiction, and the label loses: BTW stated on an invoice is owed under art. 37 Wet
      // OB whether or not it should have been charged, so such a line stays on the taxed side
      // where its BTW is still declared. (The pure resolveSaleTreatment encodes the same rule
      // at invoice level.)
      let exemptEx = 0;
      const taxedLines: LineRow[] = [];
      for (const l of lines) {
        const amount = Number(l.line_total);
        const rate = Number(l.btw_rate ?? 0);
        const labelledExempt = getVatTreatment(l.vat_treatment) === "exempt";
        if (labelledExempt && Math.round(rate) === 0 && Number.isFinite(amount)) exemptEx += amount;
        else taxedLines.push(l);
      }
      if (exemptEx !== 0) exemptExByInvoice.set(inv.id, exemptEx);

      // The taxed remainder is validated against the header MINUS the exempt part — the same
      // sum check as always, applied to the half of the invoice it now describes.
      const shares = rateSharesFromLines(taxedLines, headerEx - exemptEx, headerBtw);
      if (shares) out.set(inv.id, shares);
    }
  } catch (e) {
    // Best-effort stays: no buckets → the header-derived rate, exactly as before this module
    // existed, and the TOTAL (5a, 5b, 5g) is identical either way — the split only ever moves
    // omzet BETWEEN rubrieken. What is not acceptable is that it used to fail INVISIBLY: with the
    // 414 path closed above, an error here is a real outage, and a rubriek split that quietly
    // degraded on a filed declaration should be findable afterwards.
    // [SPLIT-EERLIJK] Via reportHandledFailure, niet alleen console.error. Deze degradatie is
    // stil per constructie — de aangifte telt daarna exact hetzelfde op — en juist daarom is een
    // logregel die niemand leest de verkeerde plek: het enige moment waarop dit nog te zien is,
    // is nu. En de aanroeper krijgt het te horen, want de auditfile moet het in het bestand zetten.
    reportHandledFailure({
      tag: "RUBRIEK-SPLIT",
      severity: "data-integrity",
      message:
        "invoice_lines kon niet gelezen worden — de rubriekverdeling valt terug op het tarief uit de factuurkop.",
      context: { invoiceCount: ids.length, error: e instanceof Error ? e.message : String(e) },
    });
    degraded = true;
    // [VRIJGESTELD] Both maps are dropped TOGETHER. Today the only throw is the fetch itself,
    // which happens before either map is written, so this clears nothing — it is here so that
    // the invariant survives the next edit: a half-built picture (some invoices classified, the
    // rest silently treated as fully taxed) would be a worse number than the pre-feature one,
    // and the two maps must never be allowed to describe different subsets of the quarter.
    out.clear();
    exemptExByInvoice.clear();
  }
  return { rateShares: out, exemptExByInvoice, degraded };
}
