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
import { computeCashSettlementSync, type SettleableInvoice } from "@/lib/cash";
// [KAS-SAMENSTELLING] The pure half of this reconcile — how three reads become one shape, and what
// each of those four decisions costs when it is wrong. Imported, never copied: the cron discovers
// owners by the same definition. See the module header there.
import {
  assembleSettleableInvoices, indexCashInstalments, openCashInvoiceIds,
  type CashInvoiceRow, type KasLinkRow,
} from "@/lib/cash-settle-assemble";
// [PAGINATION] PostgREST truncates at ~1000 rows SILENTLY. Everywhere else that is an
// understatement; here it feeds a DESTRUCTIVE pass — see the note above the reads below.
import { chunkIds, fetchAllRows } from "@/lib/supabase-paginate";
// [KAS-STIL] Caught failures that must still reach someone — the same reporter incasso-settle.ts
// uses for the same class, in the same hourly reconcile. See report-handled.ts.
import { reportHandledFailure } from "@/lib/report-handled";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "@/lib/cash-live";
// [KAS-PROBE] One definition for "does this database have that column yet" — see the module header.
import { columnExists } from "@/lib/column-probe";

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

/**
 * [DEPLOY-SAFE][KAS-PROBE] Does cash_entries carry settlement_id?
 *
 * A NO here is not a small answer. It switches this module into the pre-instalment model, and in
 * that model `existing` is read WITHOUT settlement_id — so every drawer entry of an invoice keys to
 * the same AGGREGATE_KEY, the first is kept and healed to the aggregate amount on the last cash
 * date, and computeCashSettlementSync marks EVERY OTHER ONE a duplicate and hard-deletes it. An
 * invoice paid in three till handovers loses two real cash movements and has the third re-dated
 * onto a day the money did not move — which, across a quarter boundary, is a BTW period.
 *
 * The discrimination that makes that safe now lives in column-probe.ts, because this was never one
 * module's problem: five probes were written from the same eight lines and every one of them read
 * a statement timeout as a missing column. That file states the rule and what each caller's reduced
 * mode costs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cashInstalmentsSupported(supabase: SupabaseClient<any>): Promise<boolean> {
  return columnExists(supabase, "cash_entries", "settlement_id", "per-instalment drawer entries would be deleted as duplicates");
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

/**
 * [GELD-INVARIANT] The two sides this module reconciles, read once and shared.
 *
 * It was inlined in reconcileCashSettlements, which was fine while the reconcile was the only
 * caller. It is not the only one any more: money-audit.ts looks BACKWARD at the same two sides to
 * ask whether the drawer is still in step with the invoices it claims to settle — the three states
 * this module's own reportHandledFailure calls admit can persist ("the kas balance is now too
 * high", "…too low", "the drawer may be left half-healed").
 *
 * Extracted rather than re-read there, because "which invoices are settled in cash" is a
 * DEFINITION, not a query: status paid + method kas, UNION anything holding a kas instalment, with
 * the cash portion taken from the instalment rows and not from gross − amount_paid. An audit that
 * spelled that out a second time would eventually spell it differently, and then it would report
 * differences that only exist between the two spellings. One definition, two readers.
 *
 * `ok: false` means a read failed and the answer must not be used: the reconcile bails rather than
 * delete on it, and the audit says it could not look rather than report a clean drawer.
 */
export interface CashSettlementState {
  ok: boolean;
  perInstalment: boolean;
  paid: SettleableInvoice[];
  existing: Array<{
    id: string; invoice_id: string | null; settlement_id?: string | null;
    amount?: number | null; entry_date?: string | null; direction?: "in" | "out" | null;
  }>;
}

/**
 * [CASH-RETRY] Reconcile the kasboek, and if the pass reported it bailed, ask exactly once more.
 *
 * One retry, not a loop: the failure this covers is a transient read (a chunked invoice fetch that
 * errored), and a pass that fails twice is a real outage the hourly cron and the Kas page load are
 * there for. Still best-effort by contract — the invoice write already succeeded and must never be
 * undone over a drawer entry that will heal by itself.
 *
 * ── WHY IT LIVES HERE AND NOT IN ONE ROUTE ──
 *
 * It was written inside /api/invoice/pay-toggle, with that argument attached, while FOUR other doors
 * that also turn a cash payment into a drawer movement called the bare reconcile and dropped its
 * verdict on the floor: the verify-queue confirm, the intake auto-book, the e-mail intake, and moving
 * a booked payment between invoices. The confirm route is the sharpest case, because its own comment
 * states the stakes — "the kasboek settlement is UNCONDITIONAL … the pay path has nothing else that
 * would do it" — and it was the one not checking whether the thing had worked.
 *
 * Every door that CREATES a cash payment calls this. The three that merely REPORT the pass keep using
 * reconcileCashSettlements directly and read its summary themselves (the Kas load, the on-demand
 * matcher, /api/cash/settle), and the hourly cron does not retry because it IS the retry.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reconcileCashWithRetry(supabase: SupabaseClient<any>, userId: string): Promise<void> {
  try {
    const first = await reconcileCashSettlements(supabase, userId);
    if (first.ok) return;
    // Not a failure yet — the retry exists precisely because this one is usually transient.
    console.warn("[CASH-RETRY] kasboek reconcile bailed — retrying once", { userId });
    const second = await reconcileCashSettlements(supabase, userId);
    if (!second.ok) {
      // [KAS-STIL] Through the reporter, not the console, and this file's own rule is why: a cron or
      // a route writing to stdout is the same as writing nothing. Twice in a row is also a stronger
      // fact than the inner pass's own bail report — it happened at a door that had JUST booked a
      // cash payment, so the drawer is out of step with an invoice the owner was told is paid.
      reportHandledFailure({
        tag: "CASH-RETRY",
        message: "cash reconcile bailed twice right after a cash payment — the drawer is out of step with the invoice",
        severity: "data-integrity",
        context: { userId },
      });
    }
  } catch (e) {
    // Documented as never-throwing, but a contract is not a guarantee: a payment must not fail here.
    reportHandledFailure({
      tag: "CASH-RETRY",
      message: "cash reconcile threw at a pay door — the payment stands, the drawer entry may not",
      severity: "data-integrity",
      context: { userId, error: e instanceof Error ? e.message : String(e) },
    });
  }
}

/**
 * [KAS-RICHTING] Say out loud that the direction had to be guessed.
 *
 * The guess itself lives in cash-settle-assemble.ts, with the argument for why it defaults rather
 * than refuses. This is the half that cannot live in a pure module: somebody has to be told.
 */
function reportUnreadableDirection(where: { userId: string; invoiceId: string }, value: unknown): void {
  reportHandledFailure({
    tag: "CASH-SETTLE",
    message: "a cash-settled invoice has no readable direction — the drawer movement was booked as a purchase, and if it was a sale the kas balance is now wrong by twice its amount",
    severity: "data-integrity",
    context: { ...where, direction: (value ?? null) as string | null },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadCashSettlementState(supabase: SupabaseClient<any>, userId: string): Promise<CashSettlementState> {
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
  const kasLinkRows = await fetchAllRows<KasLinkRow>(
    (from, to) => supabase
      .from("bank_tx_invoices")
      .select("id, invoice_id, amount_applied, paid_on")
      .eq("user_id", userId)
      .eq("method", "kas")
      .is("transaction_id", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  // How much cash, on which days, per invoice — one derivation, read by both the query that finds
  // the still-open cash holders below and the assembly at the end.
  const cashIndex = indexCashInstalments(kasLinkRows);

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
  const openCashIds = openCashInvoiceIds(cashIndex, knownIds);
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
      return { ok: false, perInstalment, paid: [], existing: [] };
    }
    openCashRows.push(...(data ?? []));
  }

  // Existing invoice-linked settlement entries (the ones this reconcile owns). We read amount +
  // entry_date + direction so a corrected invoice amount/date/direction can HEAL the linked entry.
  // [KAS-ZACHT] Live entries only, and this is the read where that matters most in BOTH directions:
  // a removed settlement must not be seen (or the reconcile thinks the drawer movement exists and
  // never re-creates it), and must not be deleted again. The unique index is partial on deleted_at
  // for the same reason — see cash_entry_soft_delete.sql.
  const liveCash = await liveCashEntries(supabase);
  const entryRows = await fetchAllRows<Record<string, unknown>>(
    (from, to) => liveCash.only(supabase
      .from("cash_entries")
      .select(perInstalment ? "id, invoice_id, settlement_id, amount, entry_date, direction" : "id, invoice_id, amount, entry_date, direction")
      .eq("user_id", userId)
      .eq("category", "betaling")
      .not("invoice_id", "is", null))
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>,
  );

  // [KAS-SAMENSTELLING] Four decisions about somebody's money — how much cash, whether any at
  // all, on which day, and which way — none of which is I/O. They live in cash-settle-assemble.ts
  // with what each one costs when it is wrong, and they are asserted there against rows rather
  // than read out of this file's source.
  //
  // `direction` is the one that keeps a foot in here: the guess is pure, but a guess nobody hears
  // about is how this line would quietly decide which way somebody's money went. The field is
  // nullable in the schema with no default and no check constraint, so nothing but the write paths
  // keeps it honest. It is clean today — 605 invoices, 586 incoming, 19 outgoing, not one null —
  // and this reports rather than repairs, so it will be what tells us the day that stops being true.
  const paid = assembleSettleableInvoices({
    invoiceRows: [...invRows, ...openCashRows] as CashInvoiceRow[],
    index: cashIndex,
    perInstalment,
    onUnreadableDirection: (invoiceId, value) => reportUnreadableDirection({ userId, invoiceId }, value),
  });
  // The projection differs by capability, so PostgREST's inferred row type does too — read it
  // back through `unknown` rather than teach the type system about a runtime-chosen select.
  const existing = (entryRows ?? []) as unknown as Array<{ id: string; invoice_id: string | null; settlement_id?: string | null; amount?: number | null; entry_date?: string | null; direction?: "in" | "out" | null }>;
  return { ok: true, perInstalment, paid, existing };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reconcileCashSettlements(supabase: SupabaseClient<any>, userId: string): Promise<CashSettleSummary> {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  try {
    const state = await loadCashSettlementState(supabase, userId);
    // A read it could not trust: bail rather than delete on it — the reason is written at the
    // failing read inside loadCashSettlementState, which also reports it.
    if (!state.ok) return CASH_SETTLE_BAILED;
    const { perInstalment, paid, existing } = state;
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
      // [IN-CHUNK] Per brok: de id-lijst reist in de URL, en één 414 liet ALLE verweesde
      // afrekeningen staan — precies de toestand die het blok hieronder als data-integriteit
      // rapporteert. De eerste mislukte brok stopt de lus en rapporteert, zoals voorheen.
      let error: { message: string } | null = null;
      for (const chunk of chunkIds(toDeleteIds)) {
        const { error: chunkError } = await supabase
          .from("cash_entries")
          .delete()
          .eq("user_id", userId)
          .in("id", chunk);
        if (chunkError) { error = chunkError; break; }
      }
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
