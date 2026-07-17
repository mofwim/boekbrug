// src/lib/cash.ts
// [CASH-LEDGER] Pure helpers for the cash book. No I/O, testable
// (run: npx tsx src/lib/cash.test.ts).

// The category vocabulary a cash entry can carry — the same identities as the bank
// ledger, so both channels combine into one honest picture.
// [CASH-SETTLE] 'betaling' = paying an ALREADY-BOOKED supplier invoice in cash. It is a pure
// BALANCE movement (kas ↓), never a cost: the invoice already booked the cost + voorbelasting on
// accrual. computeResult only ever maps 'omzet'/'kosten' into the P&L (financial-result.ts), so
// any other category — 'betaling' included — is automatically excluded from kosten/omzet/BTW,
// while computeCashBalance still counts it in the drawer. This is exactly how the bank side works
// (a bank line matched to an invoice is skipped as a cost, counted only as settlement).
export const CASH_CATEGORIES = ["omzet", "kosten", "prive", "transfer", "tax", "fee", "betaling"] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

export function isCashCategory(v: unknown): v is CashCategory {
  return typeof v === "string" && (CASH_CATEGORIES as readonly string[]).includes(v);
}

// ─── [CASH-SETTLE] Invoice ↔ kasboek settlement (mirror of the bank circle) ────────────
// Paying an incoming invoice in cash must (a) move the kas balance and (b) NOT re-book the cost.
// So we create a linked 'betaling' entry: direction 'out', amount = the GROSS the owner handed
// over (total_inc_btw), btw_rate null (voorbelasting already came from the invoice). Linked by
// invoice_id so it's idempotent, reversible, and reconcilable — never double-counted.

export interface SettleableInvoice {
  id: string;
  total_inc_btw: number | null;
  payment_date?: string | null;
  invoice_number?: string | null;
  client_name?: string | null;
}

export interface CashSettlementRow {
  invoice_id: string;
  direction: "out";
  amount: number;
  category: "betaling";
  btw_rate: null;
  entry_date?: string;
  description: string;
}

/** The kasboek settlement entry for one cash-paid invoice, or null when its total is unusable
 *  (never write a €0/garbage settlement). Pure. */
export function buildCashSettlement(inv: SettleableInvoice): CashSettlementRow | null {
  const amount = typeof inv.total_inc_btw === "number" ? Math.abs(inv.total_inc_btw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const label = ["Betaling factuur", inv.invoice_number ?? ""].join(" ").trim();
  const desc = inv.client_name ? `${label} — ${inv.client_name}` : label;
  const iso =
    inv.payment_date && /^\d{4}-\d{2}-\d{2}/.test(inv.payment_date) ? inv.payment_date.slice(0, 10) : undefined;
  return {
    invoice_id: inv.id,
    direction: "out",
    amount,
    category: "betaling",
    btw_rate: null,
    ...(iso ? { entry_date: iso } : {}),
    description: desc,
  };
}

/**
 * Reconcile the kasboek against the set of invoices that are currently paid-in-cash. Pure +
 * self-healing, so it is correct no matter WHICH pay path ran (server confirm, the manage-screen
 * executePay, a pen-mark suggestion the owner confirmed):
 *   - toCreate  : paid-kas invoices that have no linked 'betaling' entry yet.
 *   - toDeleteIds: 'betaling' entries whose invoice is no longer paid-in-cash (un-paid, or switched
 *     to bank) — the reversal, so undoing a cash payment removes its kas movement automatically.
 */
export function computeCashSettlementSync(
  paidKasInvoices: SettleableInvoice[],
  existing: Array<{ id: string; invoice_id: string | null }>,
): { toCreate: SettleableInvoice[]; toDeleteIds: string[] } {
  const paidIds = new Set(paidKasInvoices.map((i) => i.id));
  const linked = new Set(existing.map((e) => e.invoice_id).filter((x): x is string => !!x));
  const toCreate = paidKasInvoices.filter((i) => !linked.has(i.id) && buildCashSettlement(i) !== null);
  const toDeleteIds = existing.filter((e) => e.invoice_id && !paidIds.has(e.invoice_id)).map((e) => e.id);
  return { toCreate, toDeleteIds };
}

export interface CashMovement {
  direction: "in" | "out";
  amount: number | null;
}

/**
 * Running kas balance: money in minus money out. A deposit to the bank (storting) is
 * an 'out' (cash leaves the drawer); a withdrawal (opname) is an 'in'. Transfers are
 * included here because they genuinely change the cash on hand — they are only
 * excluded from REVENUE/COST, not from the balance. Pure.
 */
export function computeCashBalance(entries: CashMovement[]): number {
  return entries.reduce(
    (sum, e) => sum + (e.direction === "in" ? e.amount ?? 0 : -(e.amount ?? 0)),
    0,
  );
}
