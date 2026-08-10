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
import { computeCashSettlementSync, type SettleableInvoice, type CashInstalment } from "@/lib/cash";
// [PAGINATION] PostgREST truncates at ~1000 rows SILENTLY. Everywhere else that is an
// understatement; here it feeds a DESTRUCTIVE pass — see the note above the reads below.
import { fetchAllRows } from "@/lib/supabase-paginate";
// [KAS-STIL] Caught failures that must still reach someone — the same reporter incasso-settle.ts
// uses for the same class, in the same hourly reconcile. See report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled";

// [CASH-INSTALMENT][DEPLOY-SAFE] Per-instalment kasboek entries need cash_entries.settlement_id
// (cash_settlement_per_instalment.sql). Code ships before a migration is applied — that is normal
// — but here the naive version does REAL damage in that window: selecting a column that does not
// exist fails the read, the reconcile returns early, and NOTHING is created, healed or reversed.
// The drawer would quietly freeze for every cash-paid invoice until someone ran the SQL.
//
// So the capability is probed instead of assumed, and without it the module behaves EXACTLY as it
// did before this change: one aggregate entry per invoice, no settlement_id written anywhere. The
// day the migration lands, per-instalment entries switch on by themselves and the reconcile heals
// the old aggregates into them.
//
// Cached only when TRUE: a false answer must stay re-checkable, or a server instance that started
// before the migration would keep the old behaviour until it happened to restart.
let settlementColumnKnown = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cashInstalmentsSupported(supabase: SupabaseClient<any>): Promise<boolean> {
  if (settlementColumnKnown) return true;
  try {
    const { error } = await supabase.from("cash_entries").select("settlement_id").limit(1);
    if (error) return false;
    settlementColumnKnown = true;
    return true;
  } catch {
    return false;
  }
}

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
    // [DEPLOY-SAFE] Without the column, run the pre-instalment model unchanged (see above).
    const perInstalment = await cashInstalmentsSupported(supabase);
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
    // [CASH-INSTALMENT] Read the instalments THEMSELVES, not just their sum: each one becomes its
    // own drawer movement, on its own day. Summing them (the old model) made the kasboek claim
    // the whole amount left the till on the date of the last payment.
    //
    // [PAGINATION] All three reads below MUST page. PostgREST caps a response at ~1000 rows and
    // says nothing about it, and this function does not merely REPORT what it read — it DELETES
    // on the strength of it. computeCashSettlementSync treats any existing 'betaling' entry whose
    // invoice is missing from the paid set as an orphan and removes it. Truncate the invoice read
    // and hundreds of perfectly good kasboek entries become "orphans" on the next hourly run:
    // real cash outflows vanish from the book the Belastingdienst reads, and the drawer balance
    // is overstated by their sum. They are never recreated, because creation is driven from the
    // same truncated set. A trader with more than a thousand till-settled invoices hits this.
    const kasLinkRows = await fetchAllRows<{ id: string; invoice_id: string; amount_applied: number | null; paid_on: string | null }>(
      (from, to) => supabase
        .from("bank_tx_invoices")
        .select("id, invoice_id, amount_applied, paid_on")
        .eq("user_id", userId)
        .eq("method", "kas")
        .is("transaction_id", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const cashByInvoice = new Map<string, number>();
    const instalmentsByInvoice = new Map<string, CashInstalment[]>();
    const lastCashDate = new Map<string, string>();
    for (const l of kasLinkRows) {
      if (!l.invoice_id) continue;
      const amount = Math.abs(Number(l.amount_applied) || 0);
      cashByInvoice.set(l.invoice_id, (cashByInvoice.get(l.invoice_id) ?? 0) + amount);
      const list = instalmentsByInvoice.get(l.invoice_id) ?? [];
      list.push({ id: l.id, amount, paid_on: l.paid_on ? l.paid_on.slice(0, 10) : null });
      instalmentsByInvoice.set(l.invoice_id, list);
      // Kept for the pre-migration model: it dates its one entry by the last cash instalment.
      const day = l.paid_on ? l.paid_on.slice(0, 10) : null;
      if (day && (!lastCashDate.get(l.invoice_id) || day > lastCashDate.get(l.invoice_id)!)) {
        lastCashDate.set(l.invoice_id, day);
      }
    }

    // [CASH-CREDITNOTA] invoice_type rides along, and without it the fix in cash.ts cannot reach a
    // single real row: settlementDirection would see `undefined` and fall back to the sign alone,
    // so a creditnota stored with positive amounts (the 'conflict' stance import-health flags)
    // would still book the drawer backwards.
    const baseColumns = "id, direction, invoice_type, total_inc_btw, total_ex_btw, btw_amount, payment_date, invoice_number, client_name, amount_paid";
    const invRows = await fetchAllRows<Record<string, unknown> & { id: string }>(
      (from, to) => supabase
        .from("invoices")
        .select(baseColumns)
        .or(`receiver_id.eq.${userId},sender_id.eq.${userId}`)
        .eq("status", "paid")
        .eq("payment_method", "kas")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown> & { id: string }> | null; error: { message: string } | null }>,
    );

    // Invoices that hold cash but are not (yet) fully paid — invisible to the query above.
    // [PAGINATION] Chunked rather than paged: a single .in() with hundreds of uuids builds a URL
    // long enough to be rejected by the gateway, and a rejected read here reads as "no paid
    // invoices" — the same destructive shape as truncation. 200 ids per chunk keeps both the URL
    // and each response well under their caps.
    const knownIds = new Set(invRows.map((r) => r.id));
    const openCashIds = [...cashByInvoice.keys()].filter((id) => !knownIds.has(id));
    const openCashRows: unknown[] = [];
    const ID_CHUNK = 200;
    for (let i = 0; i < openCashIds.length; i += ID_CHUNK) {
      const { data, error } = await supabase
        .from("invoices")
        .select(baseColumns)
        .or(`receiver_id.eq.${userId},sender_id.eq.${userId}`)
        .in("id", openCashIds.slice(i, i + ID_CHUNK));
      // A failed chunk would silently shrink the paid set, so it bails instead of deleting.
      //
      // [KAS-STIL] Bailing is the right call and it is still a failure: the pass that keeps the
      // kasboek in step with the invoices did not run, and every caller ignores the returned
      // `ok: false` (see the header). Refusing to delete on bad data protects the drawer; saying
      // nothing about it is how a drawer stays out of step for weeks.
      if (error) {
        reportHandledFailure({
          tag: "CASH-SETTLE",
          message: "cash reconcile bailed on a failed read — the drawer was not brought in step",
          severity: "gate-unavailable",
          context: { userId, error: error.message },
        });
        return CASH_SETTLE_BAILED;
      }
      openCashRows.push(...(data ?? []));
    }

    // Existing invoice-linked settlement entries (the ones this reconcile owns). We read amount +
    // entry_date + direction so a corrected invoice amount/date/direction can HEAL the linked entry.
    const entryRows = await fetchAllRows<Record<string, unknown>>(
      (from, to) => supabase
        .from("cash_entries")
        .select(perInstalment ? "id, invoice_id, settlement_id, amount, entry_date, direction" : "id, invoice_id, amount, entry_date, direction")
        .eq("user_id", userId)
        .eq("category", "betaling")
        .not("invoice_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>,
    );

    const paid = ([...invRows, ...openCashRows] as Array<Record<string, unknown> & { id: string; direction?: string | null; payment_date?: string | null }>)
      .map((r) => ({
        ...r,
        direction: r.direction === "outgoing" ? "outgoing" : "incoming",
        // [MANUAL-PARTIAL-PAY] Authoritative cash portion (undefined → settlementGross falls
        // back to the legacy gross − amount_paid inference for pre-instalment invoices).
        cash_paid: cashByInvoice.has(r.id) ? cashByInvoice.get(r.id) : undefined,
        // [CASH-INSTALMENT] …and the instalments behind it, each of which becomes its own drawer
        // movement on its own day. The invoice's payment_date is only the fallback: it can be the
        // day a BANK instalment landed, which is a different day from any cash handover.
        cash_instalments: perInstalment ? instalmentsByInvoice.get(r.id) : undefined,
        // [DEPLOY-SAFE] In the old model the single entry is dated by the LAST cash instalment —
        // the day the till last moved — which is what it always did. With per-instalment entries
        // each one carries its own date and this is only the fallback.
        payment_date: (perInstalment ? null : lastCashDate.get(r.id)) ?? r.payment_date ?? null,
      })) as SettleableInvoice[];
    // The projection differs by capability, so PostgREST's inferred row type does too — read it
    // back through `unknown` rather than teach the type system about a runtime-chosen select.
    const existing = (entryRows ?? []) as unknown as Array<{ id: string; invoice_id: string | null; settlement_id?: string | null; amount?: number | null; entry_date?: string | null; direction?: "in" | "out" | null }>;
    const { toCreate, toUpdate, toDeleteIds } = computeCashSettlementSync(paid, existing);

    // Create the missing settlements. Insert one at a time so a single bad row (or the unique
    // index catching a race) never aborts the rest.
    for (const row of toCreate) {
      const { error } = await supabase.from("cash_entries").insert({
        user_id: userId,
        direction: row.direction,
        amount: row.amount,
        category: row.category,
        btw_rate: row.btw_rate,
        description: row.description,
        invoice_id: row.invoice_id,
        ...(perInstalment ? { settlement_id: row.settlement_id } : {}),
        ...(row.entry_date ? { entry_date: row.entry_date } : {}),
      });
      if (error) {
        // Unique-index conflict (a concurrent reconcile already created it) is benign. NOT counted
        // as created either — the entry exists, but this run did not write it.
        if (!/duplicate key|unique/i.test(error.message)) {
          // [KAS-STIL] Not "non-fatal" to the owner: this invoice was paid in cash and its drawer
          // movement was never written, so the kas balance now stands HIGHER than the money that
          // is actually in the drawer, permanently, until someone notices by counting. console
          // output from an hourly cron reaches nobody.
          reportHandledFailure({
            tag: "CASH-SETTLE",
            message: "cash settlement entry not created — the kas balance is now too high",
            severity: "data-integrity",
            context: { userId, invoiceId: row.invoice_id, error: error.message },
          });
        }
      } else {
        created += 1;
      }
    }

    // [CASH-SETTLE] Heal stale settlements: the invoice's gross or payment date changed after it
    // was cash-paid, so the linked entry must move too — else the kas balance drifts permanently.
    for (const { id, row } of toUpdate) {
      const { error } = await supabase
        .from("cash_entries")
        .update({
          amount: row.amount,
          direction: row.direction, // [CASH-SETTLE-BIDIR] heal the drawer direction too
          description: row.description,
          ...(row.entry_date ? { entry_date: row.entry_date } : {}),
        })
        .eq("id", id)
        .eq("user_id", userId);
      if (error) {
        // [KAS-STIL] The invoice's amount or date changed and the linked entry did not follow, so
        // the drawer keeps a figure the invoice no longer says — the drift this pass exists to heal.
        reportHandledFailure({
          tag: "CASH-SETTLE",
          message: "cash settlement entry not healed — the drawer keeps a stale amount or date",
          severity: "data-integrity",
          context: { userId, entryId: id, error: error.message },
        });
      } else updated += 1;
    }

    // Delete the orphaned settlements (their invoice is no longer paid-in-cash) — the reversal.
    if (toDeleteIds.length > 0) {
      const { error } = await supabase
        .from("cash_entries")
        .delete()
        .eq("user_id", userId)
        .in("id", toDeleteIds);
      if (error) {
        // [KAS-STIL] The other direction: the invoice is no longer paid in cash, the drawer still
        // says it was, and the balance stands LOWER than the money really there.
        reportHandledFailure({
          tag: "CASH-SETTLE",
          message: "orphaned cash settlements not removed — the kas balance is now too low",
          severity: "data-integrity",
          context: { userId, entries: toDeleteIds.length, error: error.message },
        });
      } else deleted += toDeleteIds.length;
    }
  } catch (e) {
    // [KAS-STIL] Non-fatal to the REQUEST — paying an invoice must not fail because a reconcile
    // did — but never non-fatal to the books: partial work may already be committed, so the drawer
    // is left half-healed with no other trace than this.
    reportHandledFailure({
      tag: "CASH-SETTLE",
      message: "cash reconcile threw — the drawer may be left half-healed",
      severity: "data-integrity",
      context: { userId, created, updated, deleted, error: e instanceof Error ? e.message : String(e) },
    });
    // Partial work may already be committed (the passes are separate writes), so report what
    // landed — but ok:false so the caller never claims the drawer is fully in sync.
    return { ok: false, created, updated, deleted };
  }
  return { ok: true, created, updated, deleted };
}
