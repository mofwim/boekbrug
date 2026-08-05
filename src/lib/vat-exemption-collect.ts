// src/lib/vat-exemption-collect.ts
// [VRIJGESTELD] The ONE I/O collector for the exempt regime, shared by every surface that
// produces a BTW figure — /api/aangifte, /api/readiness, the closing package, and
// computeResultForRange (which serves /api/result, the truth lens and the filing snapshot).
//
// It exists for the same reason regime-collect.ts does: four surfaces that each read the
// regime their own way will eventually disagree about it, and a concept aangifte that
// contradicts the closing package handed to the accountant is worse than either being wrong
// alone. One read, one resolution, four callers.
//
// Kept out of vat-exemption.ts so that module stays pure and node-testable.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRowsForIds } from "./supabase-paginate";
import { resolveExemptionForQuarter } from "./vat-exemption";

export interface VatExemptionContext {
  /** Does the exempt regime apply to the period being computed? Feeds ComputeOpts.exemptRegime. */
  active: boolean;
  /** Incoming invoice id → its vat_deduction. Only the rows that actually carry one. */
  deductionByInvoice: Map<string, string | null>;
  /**
   * TRUE when the owner declared exempt activity but the columns could not be read (the
   * migration has not run on this deployment yet). The caller must NOT quietly compute as if
   * the owner were fully taxed — that is the over-claiming behaviour this feature replaces —
   * so it surfaces this as a note instead.
   */
  degraded: boolean;
}

/** The neutral context: no exempt activity, nothing to apportion. What every ordinary owner gets. */
export const NO_EXEMPTION: VatExemptionContext = {
  active: false,
  deductionByInvoice: new Map(),
  degraded: false,
};

/**
 * Resolve the exempt regime for one owner and one period, and read the cost attributions.
 *
 * `periodStart` is the first day of the period being computed ('YYYY-MM-DD'). It is what makes a
 * declaration made today unable to rewrite a quarter that was already filed — see
 * resolveExemptionForQuarter. For a multi-quarter window (the truth lens over a year), pass the
 * window's START: the regime then applies only to windows that begin after the declaration, which
 * is the conservative direction — a window straddling the switch keeps the old computation rather
 * than retroactively re-apportioning a filed quarter inside it.
 *
 * `incomingInvoiceIds` are the purchase invoices in that period. Absent/empty is fine — the
 * regime flag alone still matters, because it changes how sales are bucketed.
 *
 * Never throws. A missing column, a missing profile row or a failed read degrades to "not exempt"
 * with `degraded` set when the owner HAD declared it, exactly like closing-package.ts:1326 does
 * for kor_active when regime_kor.sql lags a deploy.
 */
export async function collectVatExemption(args: {
  client: PipelineClient;
  ownerId: string;
  periodStart: string;
  incomingInvoiceIds?: readonly string[];
}): Promise<VatExemptionContext> {
  const { client, ownerId, periodStart } = args;

  // ── 1. The declaration ──────────────────────────────────────────────────────
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("vat_exempt_activity, vat_exempt_since")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileError) {
    // The column does not exist yet (migration lag) or the read failed. We cannot tell from here
    // whether this owner is exempt, and guessing "no" is the direction that over-claims. There is
    // nothing to apportion without the flag, so the computation proceeds unchanged — but it is
    // NOT silent: `degraded` travels to the notes.
    console.error("[VRIJGESTELD] profile read failed — regime treated as inactive", {
      ownerId,
      error: profileError.message,
    });
    return { active: false, deductionByInvoice: new Map(), degraded: true };
  }

  const row = profile as { vat_exempt_activity?: boolean | null; vat_exempt_since?: string | null } | null;
  const active = resolveExemptionForQuarter(
    !!row?.vat_exempt_activity,
    row?.vat_exempt_since ?? null,
    periodStart,
  );
  if (!active) return NO_EXEMPTION;

  // ── 2. What each cost serves ────────────────────────────────────────────────
  const { deductionByInvoice, degraded } = await fetchVatDeductions(client, ownerId, args.incomingInvoiceIds);
  return { active: true, deductionByInvoice, degraded };
}

/**
 * [VRIJGESTELD · KASSTELSEL] Read the cost attributions for a given set of purchase invoices.
 *
 * Split out of collectVatExemption because the KASSTELSEL needs it for a DIFFERENT set. Every
 * caller of the collector passes the invoices DATED in the period, which is right for the accrual
 * path — but under cash basis the costs that count are the ones SETTLED in the period, and those
 * routinely belong to invoices dated in an earlier quarter (payment lags the invoice date).
 *
 * A cost whose attribution is missing falls to 'mixed' in the engine — the pro-rata share — and
 * that is wrong in BOTH directions depending on what the owner actually attributed: a cost they
 * marked 'direct_taxed' loses part of a deduction it was fully entitled to, and one they marked
 * 'direct_exempt' gains a share of a deduction it was entitled to none of. The owner did the work
 * of attributing their costs and the number came out as if they hadn't.
 *
 * Never throws — same contract as the collector it came from.
 */
export async function fetchVatDeductions(
  client: PipelineClient,
  ownerId: string,
  incomingInvoiceIds?: readonly string[],
): Promise<{ deductionByInvoice: Map<string, string | null>; degraded: boolean }> {
  const ids = (incomingInvoiceIds ?? []).filter((id): id is string => !!id);
  const deductionByInvoice = new Map<string, string | null>();
  if (ids.length === 0) return { deductionByInvoice, degraded: false };

  try {
    // [IN-CHUNK] Chunked for the same reason every other id-keyed read here is: the list travels
    // in the URL and a few hundred uuids outgrow the request line (414), which supabase-js
    // reports as an ordinary error rather than throwing — see supabase-paginate.ts:22-31.
    const rows = await fetchAllRowsForIds<{ id: string; vat_deduction: string | null }, string>(
      ids,
      (chunk, from, to) =>
        client
          .from("invoices")
          .select("id, vat_deduction")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    );
    for (const r of rows) if (r.id) deductionByInvoice.set(r.id, r.vat_deduction);
    return { deductionByInvoice, degraded: false };
  } catch (e) {
    // The regime IS active and we could not read the attributions. Every cost then falls back to
    // 'mixed' in the engine — the pro-rata share — which is the legally-default treatment for a
    // general cost and understates rather than over-claims. Flagged, never quiet.
    console.error("[VRIJGESTELD] vat_deduction read failed — every cost falls back to pro-rata", {
      ownerId,
      invoiceCount: ids.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return { deductionByInvoice: new Map(), degraded: true };
  }
}
