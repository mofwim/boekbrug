// src/lib/bank-batch-reconcile.ts
// [BANK-BATCH-RECONCILE] Pure reconciliation of a multi-invoice bank payment.
//
// A single bank debit can pay SEVERAL invoices at once (a wholesaler batches a week of
// deliveries into one direct debit; the bank writes every invoice number in the
// reference). The card lists one slot per referenced number. The honest question the
// owner needs answered before confirming is NOT "does each amount appear in my
// statement" (it does NOT — only the SUM was debited) but "do the invoices I found add
// up to exactly what left my account".
//
// This module answers that, and ONLY asserts a tie when every referenced number has a
// matched invoice with a known amount AND their gross totals sum to the bank amount to
// the cent. Anything short of that is reported honestly as a mismatch or as incomplete
// (some invoices not yet in the administration) — never a false green.
//
// Run: npx tsx src/lib/bank-batch-reconcile.test.ts

import { normalizeRef } from "./bank-matching";

// [BANK-PSP-MATCH] How many of a payment's reference fragments actually resolve to a real
// invoice — a candidate the engine matched, or a number already confirmed against this tx.
//
// This is the ONLY safe signal for "is this a genuine multi-invoice batch?". A PSP / order
// gateway (Mollie, webshop) writes a transaction hash + an order number in the remittance,
// so refParts.length > 1 even though ZERO of them are invoice numbers. Counting fragments
// alone (the old bug) forced the slot view and hid a real amount-matched invoice. Counting
// FULL-amount candidates instead (the second bug an adversarial review caught) let an
// UNRELATED invoice that happened to equal the whole debit collapse a genuine batch and
// auto-select the wrong invoice. Counting resolved references avoids both: only ≥2 real
// invoice numbers in the reference makes it a batch; junk fragments resolve to 0.
export function countResolvedReferences(
  refParts: string[],
  knownInvoiceNumbers: Array<string | null | undefined>,
): number {
  const known = new Set(
    knownInvoiceNumbers.map((n) => normalizeRef(n ?? "")).filter((n) => n.length > 0),
  );
  const seen = new Set<string>();
  let count = 0;
  for (const rp of refParts) {
    const key = normalizeRef(rp);
    if (key.length === 0 || seen.has(key)) continue; // dedup: a doubled ref isn't two invoices
    seen.add(key);
    if (known.has(key)) count++;
  }
  return count;
}

export interface BatchSlotInput {
  refNum: string;
  /** The matched invoice's gross total (total_inc_btw), or null when no invoice with
   *  this number is in the system yet (the slot shows "Koppelen"). */
  amount: number | null;
  /** Already paid/confirmed against this transaction. */
  isConfirmed: boolean;
}

export type BatchStatus =
  | "ties" // every slot matched AND the sum equals the bank amount to the cent
  | "mismatch" // every slot matched BUT the sum differs from the bank amount
  | "incomplete"; // at least one slot has no matched invoice → sum can't be trusted

export interface BatchReconcile {
  slotCount: number;
  /** Slots whose invoice is in the system with a usable (finite) amount. */
  matchedCount: number;
  /** Sum of matched invoice gross totals, absolute euros. */
  total: number;
  /** The bank transaction amount, absolute euros. */
  bankAmount: number;
  /** total − bankAmount (can be negative), absolute-bank basis. Meaningful when allMatched. */
  diff: number;
  allMatched: boolean;
  anyConfirmed: boolean;
  status: BatchStatus;
}

/** Compare two euro amounts at cent precision, float-safe. */
function centsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Reconcile the slots of one multi-invoice payment against the bank amount.
 *
 * `bankAmount` may arrive signed (credit +, debit −) — only its magnitude matters, so a
 * −€2.902,60 debit reconciles against three positive invoice totals just the same.
 * A slot amount that is null / non-finite is treated as "not matched" (unknown), so a
 * corrupt value can never silently pass as a tie.
 */
export function reconcileBatch(
  slots: BatchSlotInput[],
  bankAmount: number,
): BatchReconcile {
  const bankAbs = Math.abs(bankAmount);
  const known = slots.filter(
    (s) => s.amount != null && Number.isFinite(s.amount),
  );
  const matchedCount = known.length;
  const allMatched = slots.length > 0 && matchedCount === slots.length;
  const total = known.reduce((sum, s) => sum + Math.abs(s.amount as number), 0);
  const anyConfirmed = slots.some((s) => s.isConfirmed);

  let status: BatchStatus;
  if (!allMatched) status = "incomplete";
  else if (centsEqual(total, bankAbs)) status = "ties";
  else status = "mismatch";

  return {
    slotCount: slots.length,
    matchedCount,
    total,
    bankAmount: bankAbs,
    diff: total - bankAbs,
    allMatched,
    anyConfirmed,
    status,
  };
}
