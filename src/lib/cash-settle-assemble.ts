// src/lib/cash-settle-assemble.ts
// [KAS-SAMENSTELLING] The pure half of the cash reconcile: turning three database reads into the
// invoices computeCashSettlementSync is allowed to act on.
//
// ── WHY THIS IS ITS OWN FILE ──
//
// MONEY_PATH_AUDIT_2026-08.md §6 item 4 asked for behavioural tests on cash-settle.ts and
// incasso-settle.ts, and §8 answered half of it: the DECISIONS those modules carry were extracted
// and asserted, the I/O halves were left. What stayed behind in `loadCashSettlementState` is not
// I/O. It is ASSEMBLY — three reads merged into one shape — welded to the awaits that produced
// them, and therefore reachable by no test.
//
// That is the layer worth pinning. The arithmetic downstream (cash.ts) has 30+ assertions and is
// the strongest part of this path; every defect this repo found in the last week was in the layer
// ABOVE it: a value that was correct but carried in the field that means something else, a
// definition spelled twice, a read whose emptiness was taken as an answer.
//
// ── WHAT A WRONG ANSWER COSTS, PER DECISION ──
//
// This function decides four things, and each one has a way to be silently wrong about money:
//
//   1. HOW MUCH cash an invoice holds. From the instalment rows, never from gross − amount_paid:
//      amount_paid includes cash, so the old formula returned €0 for a fully cash-paid invoice and
//      the reconcile DELETED its drawer entry.
//   2. Whether it holds any at all. `undefined` and `0` are different answers here —
//      settlementGross takes `cash_paid != null` as authoritative, so a 0 written where nothing was
//      known means "settle nothing", which the reconcile carries out by removing a real movement.
//   3. WHICH DAY the money moved. Per-instalment: each handover keeps its own. Without the column:
//      the LAST cash date, which across a quarter boundary is a different BTW-aangifte.
//   4. WHICH WAY it moved. An unreadable direction is booked as a purchase — and if it was a sale
//      the drawer is out by twice the amount. That default is deliberate (see cash-settle.ts) and
//      it must never be silent.
//
// Imported by cash-settle.ts, never copied: the cron discovers owners by the same definition, and
// two spellings of "which invoices hold cash" is how the two halves drift.

import type { SettleableInvoice, CashInstalment } from "@/lib/cash";

/** A kas instalment as `bank_tx_invoices` stores it: method 'kas', no transaction_id. */
export interface KasLinkRow {
  id: string;
  invoice_id: string | null;
  amount_applied: number | null;
  paid_on: string | null;
}

/** An invoice row as the reconcile reads it — only the fields the assembly itself looks at. */
export interface CashInvoiceRow {
  id: string;
  direction?: string | null;
  payment_date?: string | null;
  [column: string]: unknown;
}

/**
 * What the kas instalments say, indexed three ways. Derived once and shared, because
 * `openCashIds` (invoices holding cash while still open) is read off the same index the assembly
 * uses — a second derivation would eventually disagree with the first.
 */
export interface CashInstalmentIndex {
  /** invoice id → total cash applied. Absent means NOTHING IS KNOWN, which is not the same as 0. */
  cashByInvoice: Map<string, number>;
  /** invoice id → the individual handovers, each of which becomes its own drawer movement. */
  instalmentsByInvoice: Map<string, CashInstalment[]>;
  /** invoice id → the LATEST cash day, for the pre-migration model's single dated entry. */
  lastCashDate: Map<string, string>;
}

/** A date column may arrive as a timestamp; the drawer books days. */
const day = (value: string | null | undefined): string | null => (value ? value.slice(0, 10) : null);

/**
 * Index the kas instalments.
 *
 * `amount_applied` is taken as an ABSOLUTE value. A link stored negative is still cash that moved,
 * and letting the sign through would subtract one handover from another — leaving an invoice
 * holding, on paper, less cash than the till actually took.
 *
 * `lastCashDate` is the MAXIMUM day, not the last row seen. The rows arrive ordered by `id` so
 * that the read can page, and id order is not date order.
 */
export function indexCashInstalments(links: readonly KasLinkRow[]): CashInstalmentIndex {
  const cashByInvoice = new Map<string, number>();
  const instalmentsByInvoice = new Map<string, CashInstalment[]>();
  const lastCashDate = new Map<string, string>();

  for (const link of links) {
    if (!link.invoice_id) continue;
    const amount = Math.abs(Number(link.amount_applied) || 0);
    cashByInvoice.set(link.invoice_id, (cashByInvoice.get(link.invoice_id) ?? 0) + amount);

    const list = instalmentsByInvoice.get(link.invoice_id) ?? [];
    list.push({ id: link.id, amount, paid_on: day(link.paid_on) });
    instalmentsByInvoice.set(link.invoice_id, list);

    const on = day(link.paid_on);
    const known = lastCashDate.get(link.invoice_id);
    if (on && (!known || on > known)) lastCashDate.set(link.invoice_id, on);
  }

  return { cashByInvoice, instalmentsByInvoice, lastCashDate };
}

/**
 * [MANUAL-PARTIAL-PAY] Which invoices hold cash without being paid — invisible to a
 * `status = paid AND payment_method = kas` query, and real: €200 of a €500 invoice taken from the
 * till leaves the invoice OPEN and the drawer moved.
 *
 * Separate from the query that finds them so both halves of "settled in cash" are stated once,
 * beside each other.
 */
export function openCashInvoiceIds(index: CashInstalmentIndex, alreadyRead: ReadonlySet<string>): string[] {
  return [...index.cashByInvoice.keys()].filter((id) => !alreadyRead.has(id));
}

/**
 * [KAS-RICHTING] The direction the drawer movement will be booked from.
 *
 * Anything that is not "outgoing" is read as "incoming" — a purchase paid from the till, the
 * overwhelmingly common case. The default stays because the alternative is worse: dropping the
 * invoice would not mean leaving it alone, it would mean computeCashSettlementSync deleting its
 * linked entry as an orphan. Between a movement that might point the wrong way and no movement at
 * all, the movement is recoverable.
 *
 * What must never happen is that the guess is silent, so `report` is called every time one is made.
 */
export function readableDirection(
  value: unknown,
  report: (value: unknown) => void,
): "incoming" | "outgoing" {
  if (value === "outgoing" || value === "incoming") return value;
  report(value ?? null);
  return "incoming";
}

/**
 * Build the invoices the reconcile may act on.
 *
 * `perInstalment` is the schema capability (cash_entries.settlement_id), and it changes the answer
 * rather than the format:
 *   ON  — every handover is its own dated movement, so the invoice's own payment_date is used only
 *         where no instalment carries a day.
 *   OFF — one aggregate movement, dated by the LAST cash day. This is what the module always did,
 *         and it is why the capability is probed and never assumed: running the OFF model while the
 *         column exists deletes two of every three handovers as duplicates.
 */
export function assembleSettleableInvoices(input: {
  invoiceRows: readonly CashInvoiceRow[];
  index: CashInstalmentIndex;
  perInstalment: boolean;
  /** Called for every invoice whose stored direction could not be read. Never swallowed. */
  onUnreadableDirection?: (invoiceId: string, value: unknown) => void;
}): SettleableInvoice[] {
  const { invoiceRows, index, perInstalment, onUnreadableDirection } = input;

  return invoiceRows.map((row) => ({
    ...row,
    direction: readableDirection(row.direction, (v) => onUnreadableDirection?.(row.id, v)),
    // [MANUAL-PARTIAL-PAY] The authoritative cash portion — or `undefined`, which is a different
    // answer from 0 and the reason this is a `has` and not a `?? 0`. settlementGross treats any
    // non-null cash_paid as the whole truth, so a 0 here reads as "no cash moved" and the reconcile
    // removes a drawer entry that records money the owner actually took.
    cash_paid: index.cashByInvoice.has(row.id) ? index.cashByInvoice.get(row.id) : undefined,
    // [CASH-INSTALMENT] …and the handovers behind it, each becoming its own movement on its own
    // day. Left undefined without the column: the pre-instalment model has no settlement_id to
    // write them against.
    cash_instalments: perInstalment ? index.instalmentsByInvoice.get(row.id) : undefined,
    // [DEPLOY-SAFE] In the old model the single entry is dated by the last cash instalment — the
    // day the till last moved. With per-instalment entries each one carries its own date and the
    // invoice's payment_date is only the fallback, because that date can be the day a BANK
    // instalment landed, which is a different day from any cash handover.
    payment_date: (perInstalment ? null : index.lastCashDate.get(row.id)) ?? row.payment_date ?? null,
  })) as SettleableInvoice[];
}
