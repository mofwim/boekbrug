// src/lib/zelfstandig.ts
// [ZIEL] How much of the week's bookkeeping BoekBrug did by itself, and how much waits for the
// owner. Pure, no I/O. Run: npx tsx --test src/lib/zelfstandig.test.ts
//
// docs/ZIEL.md states the equation: the app does the work, the owner keeps the say. This is the
// number that says whether the first half is true — measured on what HAPPENED (audit rows), never
// on what a screen claims — and the number that says how much of the second half is waiting.

/** Audit actions that are the app booking something with no human tap. */
export const SELF_ACTIONS = [
  "bank.auto_confirmed", "bank.auto_confirmed_batch",
  "invoice.auto_verified", "invoice.auto_paid",
  "turnover.auto_imported", "ledger.auto_imported",
] as const;

/** Audit actions that are the owner (or their accountant) booking something themselves. */
export const HAND_ACTIONS = [
  "bank.confirmed", "bank.confirmed_batch", "bank.payment_allocated", "bank.partial_payment",
  "bank.ignored", "bank.storno_applied",
  "invoice.created", "invoice.status_changed", "turnover.day_entered", "cash.entry_added",
  "accountant.invoice_confirmed",
] as const;

export interface SelfShareCounts {
  self: number;
  hand: number;
  /** Items that wait for a decision right now: verify queue + unexplained bank lines. */
  waiting: number;
}

export interface SelfShare {
  /** 0..1, or null when nothing was booked at all — a share of nothing is not a number. */
  share: number | null;
  self: number;
  total: number;
  waiting: number;
}

export function selfShare(c: SelfShareCounts): SelfShare {
  const self = Math.max(0, Math.floor(c.self));
  const hand = Math.max(0, Math.floor(c.hand));
  const total = self + hand;
  return { share: total > 0 ? self / total : null, self, total, waiting: Math.max(0, Math.floor(c.waiting)) };
}
