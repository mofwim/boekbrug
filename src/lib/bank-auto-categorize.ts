// src/lib/bank-auto-categorize.ts
// [BANK-AUTO-CATEGORIZE] Apply the owner's LEARNED categories to fresh, uncategorized bank lines —
// automatically, from every entry point (import, the daily/hourly reconcile cron, a /bank load) —
// instead of only when the owner clicks "bulk" on the categorisatie screen. This is the "smart app"
// idea: once the owner has told us what a counterpart is (huur, telecom, verzekering…), the same
// counterpart is coded for them next time without a tap.
//
// SAFETY — identical decision to the manual bulk (categorize route): it books ONLY the CONFIDENT
// suggestions (a category the owner confirmed for this counterpart before = memory, or a specific
// pattern: tax / prive / transfer / pos_income / fee). The bare kosten/omzet fallback (a guess by
// sign) is never auto-applied, so an unlabeled transfer/tax/private line is never silently dropped
// into the P&L. Every write is category_confirmed=false (reviewable + re-editable) and records
// category_source, and guards `is('category', null)` so it never clobbers a set category. BTW/omzet
// then flow from these on accrual — so a wrong learned code is visible on the categorisatie screen
// (review scope) and one tap fixes it.

import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows } from "./supabase-paginate";
import { counterpartKey, suggestIdentity } from "./bank-identity";

export interface AutoCategorized {
  transactionId: string;
  category: string;
  source: string;
}

/**
 * Auto-code every pending, non-invoice, uncategorized bank line for one user whose counterpart the
 * owner has categorized before (or that matches a specific pattern). Idempotent + safe to re-run:
 * it only ever touches category=null lines and only writes confident suggestions. Returns the
 * codings made (empty when there is no learned memory yet or nothing to code).
 */
export async function applyLearnedBankCategories(args: {
  pipeline: PipelineClient;
  userId: string;
}): Promise<AutoCategorized[]> {
  const { pipeline, userId } = args;

  // The learned memory: counterpart_key → category, taught by every manual categorization.
  //
  // [MEMORY-PAGINATE] Paged past the silent ~1000-row cap, with a stable id order. This table has
  // one row per counterpart the owner ever answered for and only grows, so a shop passes a
  // thousand distinct parties over a few years — and this whole function exists to spend that
  // memory. A truncated map means the counterparts past the cap are never recognised, so their
  // lines are never auto-coded from ANY entry point (import, cron, /bank load) and keep landing
  // on the categorisation screen as work the owner has already done once. Everything below only
  // ever writes a CONFIDENT suggestion, so the effect was pure silent loss, never a wrong code.
  let memRows: { counterpart_key: string; category: string }[] = [];
  try {
    memRows = await fetchAllRows((from, to) =>
      pipeline
        .from("counterpart_memory")
        .select("counterpart_key, category")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    // Best-effort, as before: no memory means nothing is confident, so this pass codes nothing —
    // the honest outcome. It must never break the import or the cron that calls it.
    console.error("[MEMORY-PAGINATE] counterpart memory read failed — auto-categorize codes nothing this run", e);
    return [];
  }
  const memMap = new Map<string, string>();
  for (const m of memRows) memMap.set(m.counterpart_key, m.category);

  // Uncategorized, not-yet-linked bank lines (paginated past the 1000-row cap — a big first import
  // can exceed it, and a silently-skipped tail would leave money uncoded with no signal).
  const rows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("id, amount, counterpart_name, description")
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null)
    .order("id", { ascending: true })
    .range(from, to));

  const applied: AutoCategorized[] = [];
  for (const t of rows as { id: string; amount: number | null; counterpart_name: string | null; description: string | null }[]) {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    const s = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory);
    if (!s.confident) continue; // ambiguous → leave for the human (never a guessed cost/omzet)

    const { data, error } = await pipeline
      .from("bank_transactions")
      .update({ category: s.category, category_source: s.source, category_confirmed: false })
      .eq("id", t.id)
      .eq("user_id", userId)
      .is("category", null) // guard: never clobber a category set meanwhile
      .select("id");
    if (error || !data || data.length === 0) continue;

    applied.push({ transactionId: t.id, category: s.category, source: s.source });
  }

  return applied;
}
