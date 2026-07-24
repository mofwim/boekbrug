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

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCashSettlement, computeCashSettlementSync, type SettleableInvoice } from "@/lib/cash";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reconcileCashSettlements(supabase: SupabaseClient<any>, userId: string): Promise<void> {
  try {
    // Invoices settled in cash, BOTH directions: an incoming (purchase) paid in cash (drawer ↓)
    // AND an outgoing (sales) invoice paid in cash (drawer ↑). Owner-scoped via the RLS .or so a
    // cash sale finally reaches the drawer instead of being invisible. Both stay P&L-neutral.
    // [CASH-PARTIAL] amount_paid = the portion the BANK already settled (instalments). The cash
    // settlement books only the REMAINDER — see settlementGross.
    const { data: invRows, error: invErr } = await supabase
      .from("invoices")
      .select("id, direction, total_inc_btw, total_ex_btw, btw_amount, payment_date, invoice_number, client_name, amount_paid")
      .or(`receiver_id.eq.${userId},sender_id.eq.${userId}`)
      .eq("status", "paid")
      .eq("payment_method", "kas");
    if (invErr) return;

    // Existing invoice-linked settlement entries (the ones this reconcile owns). We read amount +
    // entry_date + direction so a corrected invoice amount/date/direction can HEAL the linked entry.
    const { data: entryRows, error: entryErr } = await supabase
      .from("cash_entries")
      .select("id, invoice_id, amount, entry_date, direction")
      .eq("user_id", userId)
      .eq("category", "betaling")
      .not("invoice_id", "is", null);
    if (entryErr) return;

    const paid = (invRows ?? []).map((r) => ({
      ...r,
      direction: r.direction === "outgoing" ? "outgoing" : "incoming",
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
        // Unique-index conflict (a concurrent reconcile already created it) is benign.
        if (!/duplicate key|unique/i.test(error.message)) {
          console.error("[CASH-SETTLE] settlement insert failed (non-fatal)", { invoice: inv.id, error: error.message });
        }
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
    }

    // Delete the orphaned settlements (their invoice is no longer paid-in-cash) — the reversal.
    if (toDeleteIds.length > 0) {
      const { error } = await supabase
        .from("cash_entries")
        .delete()
        .eq("user_id", userId)
        .in("id", toDeleteIds);
      if (error) console.error("[CASH-SETTLE] orphan cleanup failed (non-fatal)", error.message);
    }
  } catch (e) {
    console.error("[CASH-SETTLE] reconcile threw (non-fatal)", e);
  }
}
