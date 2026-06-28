// lib/bank-import.ts
// [BOEK-016] Pure import helpers: content fingerprint + cross-upload dedup + DB-row mapping.
// No I/O — testable with `npx tsx`. The route (api/bank/upload) is a thin shell over these.
//
// Dedup design (Tech Lead point, phase 2):
//   - bank_transactions has NO transaction_id / hash column (decision #4: no migration now),
//     so dedup is CONTENT-based.
//   - We must NOT collapse legitimate identical transactions inside a single statement
//     (e.g. two €4 coffees, same day, same description = two real transactions).
//   - Therefore: multiset diff. Insert only the COUNT of each fingerprint that exceeds
//     what is already stored for this user in the same date range.
//       first upload          → existing 0, file 2 coffees → insert 2
//       re-upload same file    → existing 2, file 2 coffees → insert 0
//       new period (new date)  → different key             → insert as new

import type { BankTransaction } from "./bank-parser";

/** Row shape inserted into bank_transactions. status starts 'pending' (human confirms later). */
export interface BankTransactionRow {
  user_id: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  reference: string | null;
  status: "pending";
}

/** Subset of an existing DB row needed for dedup (from a scoped SELECT).
 *  [BANK-DEDUP-DOUBLE] `description` is no longer part of the fingerprint (see
 *  contentKey) but is kept here so the upload route's existing SELECT shape stays
 *  unchanged; it is simply ignored by keyOfRow. */
export interface ExistingTxKey {
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  reference: string | null;
}

function norm(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Stable content fingerprint for cross-upload dedup.
 *
 * [BANK-DEDUP-DOUBLE] The fingerprint deliberately EXCLUDES `description`. Proven
 * by testing the SAME statement exported as both MT940 and CAMT for one period:
 * the stored description (the raw REMI) differs between the two formats for every
 * transaction — MT940 keeps ING's "USTD//29528/" wrapper, CAMT gives a clean
 * "29528" — so a description-based key never matched across formats and every
 * transaction was re-inserted on the second upload (an exact ×2 doubling of
 * in/uit). date + amount + counterpart + reference are IDENTICAL across formats
 * and uniquely identify each transaction (verified: 30/30 match, zero collisions,
 * including 20 reference-less POS settlements distinguished by amount). Two genuine
 * but truly identical transactions in one statement (same day, amount, counterpart
 * and reference) would still collapse — but that is the documented, accepted edge
 * of content-based dedup, and far rarer than the format-difference doubling this fixes.
 */
export function contentKey(
  date: string | null,
  amount: number | null,
  counterpart: string | null,
  reference: string | null
): string {
  return [
    date ?? "",
    (amount ?? 0).toFixed(2),
    norm(counterpart),
    norm(reference),
  ].join("|");
}

function keyOfTx(t: BankTransaction): string {
  return contentKey(t.date, t.amount, t.counterpartName, t.reference);
}

function keyOfRow(r: ExistingTxKey): string {
  return contentKey(r.date, r.amount, r.counterpart_name, r.reference);
}

/** Min/max ISO date in a transaction list — used to scope the existing-rows query. */
export function dateRange(transactions: BankTransaction[]): {
  min: string | null;
  max: string | null;
} {
  const dates = transactions.map((t) => t.date).filter(Boolean).sort();
  return { min: dates[0] ?? null, max: dates[dates.length - 1] ?? null };
}

/**
 * Multiset diff: return the transactions to insert (those not already covered by existing
 * rows of the same fingerprint) plus how many were skipped as duplicates.
 */
export function dedupTransactions(
  incoming: BankTransaction[],
  existing: ExistingTxKey[]
): { toInsert: BankTransaction[]; skipped: number } {
  const existingCount = new Map<string, number>();
  for (const r of existing) {
    const k = keyOfRow(r);
    existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
  }

  const toInsert: BankTransaction[] = [];
  let skipped = 0;

  for (const t of incoming) {
    const k = keyOfTx(t);
    const left = existingCount.get(k) ?? 0;
    if (left > 0) {
      existingCount.set(k, left - 1); // consume one existing → this one is a duplicate
      skipped++;
    } else {
      toInsert.push(t);
    }
  }

  return { toInsert, skipped };
}

/** Map parsed transactions → insertable rows (status 'pending', user_id pinned by caller). */
export function mapToRows(
  transactions: BankTransaction[],
  userId: string
): BankTransactionRow[] {
  return transactions.map((t) => ({
    user_id: userId,
    date: t.date || null,
    amount: t.amount,
    description: t.description || null,
    counterpart_name: t.counterpartName,
    reference: t.reference,
    status: "pending" as const,
  }));
}

/** A stored bank_transactions row, as selected for the matching run (phase 3). */
export interface BankTransactionDbRow {
  id: string;
  date: string | null;
  amount: number | null;
  description: string | null;
  counterpart_name: string | null;
  reference: string | null;
}

/**
 * Map a stored row back into the canonical BankTransaction shape the matcher consumes.
 * The DB row id is carried in `transactionId` so suggestions tie back to the exact row.
 */
export function rowToTransaction(r: BankTransactionDbRow): BankTransaction {
  return {
    date: r.date ?? "",
    amount: r.amount ?? 0,
    currency: "EUR",
    description: r.description ?? "",
    counterpartName: r.counterpart_name,
    counterpartIban: null, // not stored
    reference: r.reference,
    transactionId: r.id, // carry DB id → ties a suggestion to its transaction
    rawLine: "",
  };
}