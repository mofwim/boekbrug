// src/lib/cash-settle.ts
// [CASH-SETTLE] Keep the kasboek in sync with the invoices that are paid IN CASH — the cash
// analog of the bank auto-confirm circle. This is the I/O wrapper around the pure reconcile in
// cash.ts (computeCashSettlementSync); all the money rules live there and are unit-tested.
//
// Self-healing + path-independent: it does not matter WHICH pay path marked the invoice paid-kas
// (the server verify-queue pay, the manage-screen executePay, a confirmed pen-mark suggestion) —
// running this reconciles the truth. So we call it after a pay/undo AND on the kasboek load, and
// it converges either way:
//   - a paid-in-cash invoice with no linked 'betaling' entry  → create one (balance ↓, NOT a cost)
//   - a 'betaling' entry whose invoice is no longer paid-in-cash → delete it (the reversal)
//
// Never double-counts: 'betaling' is excluded from the P&L/BTW by computeResult (it only maps
// omzet/kosten), while computeCashBalance still counts it in the drawer.
//
// Best-effort: any failure is swallowed and logged — a reconcile hiccup must never break paying
// an invoice or opening the kasboek. Requires the cash_settlement_invoice_link.sql migration
// (cash_entries.invoice_id); until it is applied the inserts no-op via the catch.
//
// [MATCH-BUTTON] It now RETURNS what it changed (CashSettleSummary) instead of nothing. Still
// best-effort — every existing caller ignores the value — but the on-demand "Matchen met bank &
// kas" run has to tell the owner what happened to their drawer, and it can only report numbers
// this function actually produced.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCashSettlement, computeCashSettlementSync, type SettleableInvoice } from "@/lib/cash";

/**
 * [MATCH-BUTTON] What this reconcile actually changed in the drawer. Every existing caller
 * ignores the return value (the reconcile stays fire-and-forget), but the on-demand matcher
 * has to REPORT its work to the owner — and "kasboek bijgewerkt" with no numbers behind it
 * would be a claim we cannot back. `ok: false` means the pass bailed on a read error or threw:
 * nothing was reconciled, and the caller must not present the cash side as done.
 */
export interface CashSettleSummary {
  ok: boolean;
  /** New 'betaling' entries written (a cash-paid invoice that had none). */
  created: number;
  /** Existing entries HEALED (invoice amount / date / direction changed after the payment). */
  updated: number;
  /** Orphans removed (their invoice is no longer paid-in-cash) — the reversal. */
  deleted: number;
}

const CASH_SETTLE_BAILED: CashSettleSummary = { ok: false, created: 0, updated: 0, deleted: 0 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reconcileCashSettlements(supabase: SupabaseClient<any>, userId: string): Promise<CashSettleSummary> {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  try {
    // Invoices settled in cash, BOTH directions: an incoming (purchase) paid in cash (drawer ↓)
    // AND an outgoing (sales) invoice paid in cash (drawer ↑). Owner-scoped via the RLS .or so a
    // cash sale finally reaches the drawer instead of being invisible. Both stay P&L-neutral.
    // [CASH-PARTIAL] amount_paid = the portion already settled (instalments). For LEGACY rows
    // without instalment records that still means "paid by bank", and the cash settlement books
    // the REMAINDER — see settlementGross.
    //
    // [MANUAL-PARTIAL-PAY] Two changes here, both required by manual cash instalments:
    //  1. An invoice can hold cash while still OPEN (paid €200 of €500 from the till). It is not
    //     status 'paid', yet the drawer really moved — so the eligible set is "settled in cash"
    //     (status paid + method kas) UNION "has a kas instalment", not status alone.
    //  2. The cash amount comes from those instalment rows (method='kas'), not from
    //     gross − amount_paid: amount_paid now includes cash too, so the old formula would
    //     compute €0 for a fully cash-paid invoice and the reconciler would DELETE its entry.
    const { data: kasLinkRows } = await supabase
      .from("bank_tx_invoices")
      .select("invoice_id, amount_applied, paid_on")
      .eq("user_id", userId)
      .eq("method", "kas")
      .is("transaction_id", null);
    const cashByInvoice = new Map<string, number>();
    const lastCashDate = new Map<string, string>();
    for (const l of (kasLinkRows ?? []) as Array<{ invoice_id: string; amount_applied: number | null; paid_on: string | null }>) {
      if (!l.invoice_id) continue;
      cashByInvoice.set(l.invoice_id, (cashByInvoice.get(l.invoice_id) ?? 0) + Math.abs(Number(l.amount_applied) || 0));
      // The drawer entry is dated by the LAST cash instalment — the day the till last moved.
      if (l.paid_on && (!lastCashDate.get(l.invoice_id) || l.paid_on > lastCashDate.get(l.invoice_id)!)) {
        lastCashDate.set(l.invoice_id, l.paid_on.slice(0, 10));
      }
    }

    const baseColumns = "id, direction, total_inc_btw, total_ex_btw, btw_amount, payment_date, invoice_number, client_name, amount_paid";
    const { data: invRows, error: invErr } = await supabase
      .from("invoices")
      .select(baseColumns)
      .or(`receiver_id.eq.${userId},sender_id.eq.${userId}`)
      .eq("status", "paid")
      .eq("payment_method", "kas");
    if (invErr) return CASH_SETTLE_BAILED;

    // Invoices that hold cash but are not (yet) fully paid — invisible to the query above.
    const knownIds = new Set((invRows ?? []).map((r) => (r as { id: string }).id));
    const openCashIds = [...cashByInvoice.keys()].filter((id) => !knownIds.has(id));
    let openCashRows: unknown[] = [];
    if (openCashIds.length > 0) {
      const { data } = await supabase
        .from("invoices")
        .select(baseColumns)
        .or(`receiver_id.eq.${userId},sender_id.eq.${userId}`)
        .in("id", openCashIds);
      openCashRows = data ?? [];
    }

    // Existing invoice-linked settlement entries (the ones this reconcile owns). We read amount +
    // entry_date + direction so a corrected invoice amount/date/direction can HEAL the linked entry.
    const { data: entryRows, error: entryErr } = await supabase
      .from("cash_entries")
      .select("id, invoice_id, amount, entry_date, direction")
      .eq("user_id", userId)
      .eq("category", "betaling")
      .not("invoice_id", "is", null);
    if (entryErr) return CASH_SETTLE_BAILED;

    const paid = ([...(invRows ?? []), ...openCashRows] as Array<Record<string, unknown> & { id: string; direction?: string | null; payment_date?: string | null }>)
      .map((r) => ({
        ...r,
        direction: r.direction === "outgoing" ? "outgoing" : "incoming",
        // [MANUAL-PARTIAL-PAY] Authoritative cash portion (undefined → settlementGross falls
        // back to the legacy gross − amount_paid inference for pre-instalment invoices).
        cash_paid: cashByInvoice.has(r.id) ? cashByInvoice.get(r.id) : undefined,
        // Date the drawer entry by the last cash instalment when we have one; the invoice's
        // payment_date can be the day a BANK instalment landed, which is a different day.
        payment_date: lastCashDate.get(r.id) ?? r.payment_date ?? null,
      })) as SettleableInvoice[];
    const existing = (entryRows ?? []) as Array<{ id: string; invoice_id: string | null; amount?: number | null; entry_date?: string | null; direction?: "in" | "out" | null }>;
    const { toCreate, toUpdate, toDeleteIds } = computeCashSettlementSync(paid, existing);

    // Create the missing settlements. Insert one at a time so a single bad row (or the unique
    // index catching a race) never aborts the rest.
    for (const inv of toCreate) {
      const s = buildCashSettlement(inv);
      if (!s) continue;
      const { error } = await supabase.from("cash_entries").insert({
        user_id: userId,
        direction: s.direction,
        amount: s.amount,
        category: s.category,
        btw_rate: s.btw_rate,
        description: s.description,
        invoice_id: s.invoice_id,
        ...(s.entry_date ? { entry_date: s.entry_date } : {}),
      });
      if (error) {
        // Unique-index conflict (a concurrent reconcile already created it) is benign. NOT counted
        // as created either — the entry exists, but this run did not write it.
        if (!/duplicate key|unique/i.test(error.message)) {
          console.error("[CASH-SETTLE] settlement insert failed (non-fatal)", { invoice: inv.id, error: error.message });
        }
      } else {
        created += 1;
      }
    }

    // [CASH-SETTLE] Heal stale settlements: the invoice's gross or payment date changed after it
    // was cash-paid, so the linked entry must move too — else the kas balance drifts permanently.
    for (const { id, inv } of toUpdate) {
      const s = buildCashSettlement(inv);
      if (!s) continue;
      const { error } = await supabase
        .from("cash_entries")
        .update({
          amount: s.amount,
          direction: s.direction, // [CASH-SETTLE-BIDIR] heal the drawer direction too
          description: s.description,
          ...(s.entry_date ? { entry_date: s.entry_date } : {}),
        })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) console.error("[CASH-SETTLE] settlement update failed (non-fatal)", { entry: id, error: error.message });
      else updated += 1;
    }

    // Delete the orphaned settlements (their invoice is no longer paid-in-cash) — the reversal.
    if (toDeleteIds.length > 0) {
      const { error } = await supabase
        .from("cash_entries")
        .delete()
        .eq("user_id", userId)
        .in("id", toDeleteIds);
      if (error) console.error("[CASH-SETTLE] orphan cleanup failed (non-fatal)", error.message);
      else deleted += toDeleteIds.length;
    }
  } catch (e) {
    console.error("[CASH-SETTLE] reconcile threw (non-fatal)", e);
    // Partial work may already be committed (the passes are separate writes), so report what
    // landed — but ok:false so the caller never claims the drawer is fully in sync.
    return { ok: false, created, updated, deleted };
  }
  return { ok: true, created, updated, deleted };
}
