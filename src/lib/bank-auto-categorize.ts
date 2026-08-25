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

import { round2 } from "./invoice-totals";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows, fetchAllRowsForIds } from "./supabase-paginate";
import { counterpartKey, suggestIdentity, isPosPayoutDescription } from "./bank-identity";

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
/** A paid-invoice row as the double-booking guard needs it. */
export interface PaidExplainerRow {
  direction: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  payment_date: string | null;
  marked_paid_at: string | null;
  invoice_date: string | null;
}

/**
 * [DUBBEL-GEDEKT] Does a PAID invoice already explain this bank line's money? Pure — the caller
 * reads, this decides. Same direction, same magnitude to the cent, settled within two weeks of
 * the line. An UNDATABLE pair errs toward true: the guard prevents a double booking, and holding
 * a line for a human is recoverable where a doubled cost in the aangifte is not.
 */
export function paidInvoiceExplainsLine(
  paidRows: readonly PaidExplainerRow[],
  txAmount: number,
  txDate: string | null,
): boolean {
  const mag = round2(Math.abs(txAmount));
  const wantDir = txAmount < 0 ? "incoming" : "outgoing";
  const txMs = txDate ? Date.parse(txDate) : NaN;
  return paidRows.some((inv) => {
    if ((inv.direction ?? "") !== wantDir) return false;
    const invMag = round2(Math.abs(Number(inv.total_inc_btw) || 0));
    if (Math.abs(invMag - mag) > 0.01) return false;
    const settled = inv.payment_date ?? inv.marked_paid_at ?? inv.invoice_date;
    if (!settled || Number.isNaN(txMs)) return true; // undatable → err toward NOT double-booking
    const d = Math.abs(txMs - Date.parse(settled));
    return d <= 14 * 86_400_000;
  });
}

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
    .select("id, amount, counterpart_name, description, date")
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null)
    .order("id", { ascending: true })
    .range(from, to));

  // ── [DUBBEL-GEDEKT] Is this money already explained by a PAID invoice? ──────────────────────
  //
  // The engine books a bank line's kosten/omzet only when invoice_id is NULL — and the invoice
  // itself books through INCOMING_OK. So a bill the owner marked paid by hand (or incasso-settle
  // paid with no bank line) has its cost in the books ALREADY; when its bank debit then arrives,
  // the matcher excludes paid invoices, the line finds no candidate, and a confident memory hit
  // used to code it 'kosten' — the same cost twice, in resultaat and the closing package, with
  // nothing flagging it (readiness only counts excluded categories). So before a MEMORY hit is
  // allowed to write a P&L category, the paid invoices are consulted: same direction, same
  // magnitude to the cent-tolerance, settled within two weeks of the line's date → skip, leave
  // the line for the human, who will link it instead of double-booking it. Only kosten/omzet —
  // 'transfer'/'prive' carry no P&L and cannot double-book.
  //
  // Fail-open on a failed read, deliberately: this guard prevents a DOUBLE booking, and its own
  // hiccup must not turn auto-coding off wholesale — the pre-guard behaviour was live for months.
  const candidateAmounts = [...new Set(
    (rows as { amount: number | null }[])
      .map((t) => Math.abs(Number(t.amount) || 0))
      .filter((a) => a > 0.005)
      .map((a) => round2(a)),
  )];
  let paidRows: PaidExplainerRow[] = [];
  try {
    paidRows = await fetchAllRowsForIds<PaidExplainerRow, number>(candidateAmounts, (chunk, from, to) => pipeline
      .from("invoices")
      .select("direction, total_inc_btw, amount_paid, payment_date, marked_paid_at, invoice_date")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq("status", "paid")
      .in("total_inc_btw", chunk)
      .order("id", { ascending: true })
      .range(from, to));
  } catch (e) {
    console.error("[DUBBEL-GEDEKT] paid-invoice read failed — auto-categorize proceeds without the double-booking guard this run", e);
  }
  const paidExplains = (txAmount: number, txDate: string | null): boolean =>
    paidInvoiceExplainsLine(paidRows, txAmount, txDate);

  // ── [MOLLIE-UITBETALING] Does this owner receive iDEAL money through their own Mollie? ──────
  //
  // A Mollie payout credit is the BATCHED, FEE-REDUCED sum of payments whose invoices the
  // webhook already marked paid — so [DUBBEL-GEDEKT]'s cent-exact amount match can never catch
  // it (the fee shifts every amount). For an owner with recent webhook-paid links, an
  // auto-written category on a Mollie-named credit is therefore a double booking waiting for a
  // click. Those lines stay uncategorized: the owner codes them consciously (usually as the
  // settlement of already-booked invoices), the human channel this app routes every ambiguity
  // through. Owners WITHOUT Mollie links keep today's behaviour untouched.
  // Fail-open like the guard above, same reason — and 42P01 (mollie.sql not applied) simply
  // means no links, so no hold.
  let hasRecentMolliePayout = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mollieLinks } = await (pipeline as any)
      .from("mollie_payment_links")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .limit(1);
    hasRecentMolliePayout = Array.isArray(mollieLinks) && mollieLinks.length > 0;
  } catch { /* no table, no links, no hold */ }
  const molliePayoutHold = (t: { amount: number | null; counterpart_name: string | null; description: string | null }): boolean =>
    hasRecentMolliePayout && (t.amount ?? 0) > 0 && isPosPayoutDescription(t.description, t.counterpart_name);

  const applied: AutoCategorized[] = [];
  for (const t of rows as { id: string; amount: number | null; counterpart_name: string | null; description: string | null; date: string | null }[]) {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    const s = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory);
    if (!s.confident) continue; // ambiguous → leave for the human (never a guessed cost/omzet)
    // [DUBBEL-GEDEKT] A P&L category over money a paid invoice already explains is a double
    // booking, not a coding. The human links it instead.
    if ((s.category === "kosten" || s.category === "omzet") && paidExplains(t.amount ?? 0, t.date)) continue;
    // [MOLLIE-UITBETALING] A PSP payout at an owner whose invoices Mollie already settled: the
    // money is (largely) booked. Leave the line for the human, never pre-fill it.
    if (molliePayoutHold(t)) continue;

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
