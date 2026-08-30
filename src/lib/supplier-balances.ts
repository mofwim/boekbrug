// src/lib/supplier-balances.ts
// [LEVERANCIER-SALDO] What this shop still owes, per supplier, on a chosen date. Pure, no I/O.
//
// ── WHERE THIS COMES FROM ──
//
// A photo of a wholesaler's own accounting package: "Openstaande verkoopfacturen", filtered on
// customer 13168 — Kiwi Food Market. Two invoices, grouped under the customer's name, each with
// its due date and a Vervallen tick, and a subtotal underneath: € 2.383,65. Above the list, a
// PEILDATUM: the whole screen answers "what was open on this date", not "what is open now".
//
// That screen is the supplier's side of invoices BoekBrug already holds. The app had the rows and
// had never once added them up per supplier, which is the one number a shopkeeper is asked for on
// the phone — "wat staat er nog open bij ons?" — and the one an accountant checks a creditors
// balance against.
//
// ── WHY THE PEILDATUM IS NOT A DETAIL ──
//
// "Openstaand" without a date is a figure that changes while you read it, and it is not the figure
// an accountant needs: at year-end they need what was open ON 31 December, which is a different
// number from what is open today and cannot be recovered afterwards by looking at statuses. So the
// date is a parameter of this function and never a clock inside it.
//
// It is computable honestly because bank_tx_invoices records paid_on per settlement. Settled by
// the peildatum = the sum of the links dated on or before it. Where those links are not supplied,
// the module falls back to the invoice's CURRENT amount_paid and SAYS so on the result — because
// that fallback silently answers "now" to a question about a past date, and a figure whose basis
// is invisible is how a wrong balance gets filed.
//
// ── AND WHY UNVERIFIED INVOICES ARE COUNTED, NOT ADDED ──
//
// A bill still in the verify queue has been read by a machine and by nobody else. Folding it into
// a creditors total would put an unchecked amount into a figure people act on; leaving it out
// silently would understate what the shop owes. It is counted beside the total, in its own words.

import { openAmountSigned, settledAmountSigned, toCents } from "./partial-payment";
import { round2 } from "./invoice-totals";

/** One purchase invoice, as the screens already read it. */
export interface SupplierInvoiceRow {
  id: string;
  invoiceNumber: string | null;
  /** The grouping identity. Callers pass supplier_id, or counterpartKey(name) — one or the other. */
  supplierKey: string | null;
  supplierName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  status: string | null;
  invoiceType: string | null;
  totalIncBtw: number | null;
  amountPaid: number | null;
}

/** One settlement dated in time, as bank_tx_invoices holds it. */
export interface SettlementRow {
  invoiceId: string;
  /** Magnitude applied. NULL means a legacy row that settled its invoice IN FULL — see below. */
  amountApplied: number | null;
  paidOn: string | null;
}

/** An open invoice on one supplier's balance. */
export interface OpenSupplierInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  /** Still open, SIGNED: a creditnota reduces what is owed and prints with its minus. */
  open: number;
  isCreditNote: boolean;
  /** Days past the due date on the peildatum, or null when the invoice states no due date. */
  overdueDays: number | null;
}

/**
 * The aging buckets, by days past due on the peildatum.
 *
 * Same four an accountant expects (nog niet vervallen, 1-30, 31-60, 61-90, 90+). An invoice with
 * NO due date cannot be aged and lands in `zonderVervaldatum` rather than being guessed into
 * "current" — a bill with no date is exactly the one nobody chases.
 */
export interface Aging {
  nietVervallen: number;
  dag1tot30: number;
  dag31tot60: number;
  dag61tot90: number;
  dag90plus: number;
  zonderVervaldatum: number;
}

export interface SupplierBalance {
  key: string;
  name: string;
  /** Signed total still open on the peildatum. */
  open: number;
  openCount: number;
  /** Of that total, the part already past its due date. */
  overdue: number;
  overdueCount: number;
  /** The due date of the oldest unpaid invoice — what a supplier phones about. */
  oldestDueDate: string | null;
  aging: Aging;
  /** Bills from this supplier still in the verify queue. Counted, never added to `open`. */
  unverifiedCount: number;
  invoices: OpenSupplierInvoice[];
}

export interface SupplierBalanceResult {
  /** The date every figure above answers for. Echoed so no caller can restate it wrong. */
  asOf: string;
  /**
   * 'settlements' — computed from dated payment links, so the peildatum is real.
   * 'huidig'      — computed from the invoice's CURRENT amount_paid, which answers "now" whatever
   *                 date was asked for. Honest only when asOf is today; the screen must say so.
   */
  basis: "settlements" | "huidig";
  suppliers: SupplierBalance[];
  /** Signed total across every supplier. */
  total: number;
  totalOverdue: number;
  aging: Aging;
  unverifiedCount: number;
  /** [NO-SILENT-EMPTY] Open invoices whose supplier could not be keyed — never dropped. */
  unkeyedCount: number;
  unkeyedOpen: number;
}

/** Statuses of a purchase invoice the administration counts. Mirrors closing-package's rule. */
const VERIFIED_INCOMING = new Set(["received", "paid"]);
/** Read, not yet confirmed by a person. Counted beside the total, never inside it. */
const UNVERIFIED_INCOMING = new Set(["processing"]);

const EMPTY_AGING = (): Aging => ({
  nietVervallen: 0, dag1tot30: 0, dag31tot60: 0, dag61tot90: 0, dag90plus: 0, zonderVervaldatum: 0,
});

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10));
}

function addToAging(aging: Aging, overdueDays: number | null, amount: number): void {
  if (overdueDays === null) { aging.zonderVervaldatum = round2(aging.zonderVervaldatum + amount); return; }
  if (overdueDays <= 0) { aging.nietVervallen = round2(aging.nietVervallen + amount); return; }
  if (overdueDays <= 30) { aging.dag1tot30 = round2(aging.dag1tot30 + amount); return; }
  if (overdueDays <= 60) { aging.dag31tot60 = round2(aging.dag31tot60 + amount); return; }
  if (overdueDays <= 90) { aging.dag61tot90 = round2(aging.dag61tot90 + amount); return; }
  aging.dag90plus = round2(aging.dag90plus + amount);
}

/**
 * What was still open per supplier on `asOf`.
 *
 * `settlements` is optional and changes the ANSWER, not just the accuracy: with it, the peildatum
 * is real (a payment made after that date does not count); without it the figure is today's, and
 * `basis` says which one the caller got. Passing an empty array is not the same as passing nothing
 * — an administration with no payment links at all is a real state, and reading it as "no data,
 * fall back to now" would silently answer a different question.
 */
export function supplierBalances(args: {
  invoices: SupplierInvoiceRow[];
  asOf: string;
  settlements?: SettlementRow[] | null;
}): SupplierBalanceResult {
  const { invoices, asOf } = args;
  const settlements = args.settlements ?? null;
  const basis: "settlements" | "huidig" = settlements === null ? "huidig" : "settlements";

  // Settled by the peildatum, per invoice.
  //
  // A NULL amount_applied is a row from before that column existed, and by construction it settled
  // its invoice IN FULL — the same reading bank-line-budget.ts and payment-evidence.ts already
  // apply. Treating it as zero would resurrect every historical payment as an open debt.
  const settledByDate = new Map<string, number>();
  const settledInFull = new Set<string>();
  if (settlements) {
    for (const s of settlements) {
      if (!isIsoDate(s.paidOn)) continue;          // undated: cannot be placed in time at all
      if (s.paidOn.slice(0, 10) > asOf) continue;  // paid after the peildatum — not yet paid, then
      if (s.amountApplied === null || s.amountApplied === undefined) {
        settledInFull.add(s.invoiceId);
        continue;
      }
      settledByDate.set(s.invoiceId, round2((settledByDate.get(s.invoiceId) ?? 0) + Math.abs(s.amountApplied)));
    }
  }

  const perSupplier = new Map<string, SupplierBalance>();
  const totalAging = EMPTY_AGING();
  let unverifiedTotalCount = 0;
  let unkeyedCount = 0;
  let unkeyedOpen = 0;

  for (const inv of invoices) {
    // An invoice dated after the peildatum did not exist yet. A missing date cannot be excluded on
    // that ground, so it stays in — losing a bill for want of a date is the worse error, and the
    // aging below already reports it as undateable.
    if (isIsoDate(inv.invoiceDate) && inv.invoiceDate.slice(0, 10) > asOf) continue;

    if (UNVERIFIED_INCOMING.has(inv.status ?? "")) {
      unverifiedTotalCount += 1;
      if (inv.supplierKey) {
        const b = bucketFor(perSupplier, inv);
        b.unverifiedCount += 1;
      }
      continue;
    }
    if (!VERIFIED_INCOMING.has(inv.status ?? "")) continue;

    const open = openOnDate(inv, basis, settledByDate, settledInFull);
    if (Math.abs(open) < 0.005) continue;

    const overdueDays = isIsoDate(inv.dueDate) ? daysBetween(inv.dueDate.slice(0, 10), asOf) : null;

    if (!inv.supplierKey) {
      unkeyedCount += 1;
      unkeyedOpen = round2(unkeyedOpen + open);
      addToAging(totalAging, overdueDays, open);
      continue;
    }

    const b = bucketFor(perSupplier, inv);
    b.open = round2(b.open + open);
    b.openCount += 1;
    if (overdueDays !== null && overdueDays > 0) {
      b.overdue = round2(b.overdue + open);
      b.overdueCount += 1;
    }
    if (isIsoDate(inv.dueDate) && (!b.oldestDueDate || inv.dueDate.slice(0, 10) < b.oldestDueDate)) {
      b.oldestDueDate = inv.dueDate.slice(0, 10);
    }
    addToAging(b.aging, overdueDays, open);
    addToAging(totalAging, overdueDays, open);
    b.invoices.push({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      open,
      isCreditNote: (inv.totalIncBtw ?? 0) < 0 || inv.invoiceType === "creditnota",
      overdueDays,
    });
  }

  const suppliers = [...perSupplier.values()].filter((b) => b.openCount > 0 || b.unverifiedCount > 0);
  for (const b of suppliers) {
    // Oldest first within a supplier: the one being chased is at the top, which is the order a
    // supplier reads them out over the phone.
    b.invoices.sort((a, z) => (a.dueDate ?? a.invoiceDate ?? "") < (z.dueDate ?? z.invoiceDate ?? "") ? -1 : 1);
  }
  // Most owed first. A creditors list read top-down is then a payment order.
  suppliers.sort((a, z) => z.open - a.open);

  return {
    asOf,
    basis,
    suppliers,
    total: round2(suppliers.reduce((s, b) => s + b.open, 0) + unkeyedOpen),
    totalOverdue: round2(suppliers.reduce((s, b) => s + b.overdue, 0)),
    aging: totalAging,
    unverifiedCount: unverifiedTotalCount,
    unkeyedCount,
    unkeyedOpen,
  };
}

function bucketFor(map: Map<string, SupplierBalance>, inv: SupplierInvoiceRow): SupplierBalance {
  const key = inv.supplierKey as string;
  const found = map.get(key);
  if (found) {
    if ((!found.name || found.name === key) && inv.supplierName) found.name = inv.supplierName;
    return found;
  }
  const made: SupplierBalance = {
    key, name: inv.supplierName || key, open: 0, openCount: 0, overdue: 0, overdueCount: 0,
    oldestDueDate: null, aging: EMPTY_AGING(), unverifiedCount: 0, invoices: [],
  };
  map.set(key, made);
  return made;
}

/**
 * What is open on this invoice on the peildatum, signed.
 *
 * On the 'huidig' basis this is openAmountSigned verbatim — the app's one authority, so a
 * creditors list and an invoice row can never print two different numbers for the same bill.
 *
 * On the 'settlements' basis the status is deliberately NOT consulted: an invoice marked 'paid'
 * whose only settlement is dated AFTER the peildatum was open on that date, and reading the status
 * would answer today's question again. The identity openAmountSigned + settledAmountSigned === the
 * signed total is what makes the two bases agree when asOf is today.
 */
function openOnDate(
  inv: SupplierInvoiceRow,
  basis: "settlements" | "huidig",
  settledByDate: Map<string, number>,
  settledInFull: Set<string>,
): number {
  const pay = { total_inc_btw: inv.totalIncBtw ?? 0, amount_paid: inv.amountPaid ?? 0, status: inv.status ?? null };
  if (basis === "huidig") return openAmountSigned(pay);

  if (settledInFull.has(inv.id)) return 0;
  const total = Math.abs(inv.totalIncBtw ?? 0);
  const settled = Math.min(settledByDate.get(inv.id) ?? 0, total);
  const open = toCents(Math.max(0, total - settled));
  if (open === 0) return 0;
  return (inv.totalIncBtw ?? 0) < 0 ? -open : open;
}

/** The signed total this module claims, re-derived from the rows, for a caller that wants to check. */
export function totalOf(result: SupplierBalanceResult): number {
  return round2(result.suppliers.reduce((s, b) => s + b.open, 0) + result.unkeyedOpen);
}

/** Exported for the tests and for any caller that needs the identity above. */
export { settledAmountSigned };
