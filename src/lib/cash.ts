// src/lib/cash.ts
// [CASH-LEDGER] Pure helpers for the cash book. No I/O, testable
// (run: npx tsx src/lib/cash.test.ts).

// The category vocabulary a cash entry can carry — the same identities as the bank
// ledger, so both channels combine into one honest picture.
export const CASH_CATEGORIES = ["omzet", "kosten", "prive", "transfer", "tax", "fee"] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

export function isCashCategory(v: unknown): v is CashCategory {
  return typeof v === "string" && (CASH_CATEGORIES as readonly string[]).includes(v);
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
