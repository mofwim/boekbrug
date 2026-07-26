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

import { normalizeRef, parseReferenceNumbers } from "./bank-matching";

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
  /**
   * What this payment can still SETTLE on the matched invoice: its gross total minus what
   * earlier instalments already covered ([PARTIAL-PAY] amount_paid), sign preserved. Null when
   * no invoice with this number is in the system yet (the slot shows "Koppelen").
   *
   * It is the OPEN amount, not the total, because that is what actually leaves the bank. The
   * app's own gebundeld betaalverzoek asks the customer for exactly the sum of the open amounts
   * (buildBundelBetaalverzoek), so summing TOTALS here would call the app's own, perfectly
   * correct payment a mismatch as soon as one invoice in the bundle had a prior instalment.
   * For a fully open invoice open == total, so the classic wholesale batch is unchanged.
   */
  amount: number | null;
  /** Already paid/confirmed against this transaction. */
  isConfirmed: boolean;
}

/**
 * The still-settleable amount of an invoice: its magnitude minus what is already paid, carrying
 * the invoice's own sign (a creditnota stays negative so it REDUCES a batch sum — see
 * [BATCH-SIGN] in reconcileBatch). Returns null when the total is unusable, so a corrupt value
 * can never silently pass as a slot amount.
 */
export function settleableAmount(
  totalIncBtw: number | null | undefined,
  amountPaid?: number | null,
): number | null {
  if (totalIncBtw == null || !Number.isFinite(totalIncBtw)) return null;
  const paid = Math.max(0, Number(amountPaid ?? 0));
  const open = Math.max(0, Math.abs(totalIncBtw) - paid);
  const signed = totalIncBtw < 0 ? -open : open;
  return Math.round(signed * 100) / 100;
}

export type BatchStatus =
  | "ties" // every slot matched AND the sum equals the bank amount to the cent
  | "mismatch" // every slot matched BUT the sum differs from the bank amount
  | "incomplete"; // at least one slot has no matched invoice → sum can't be trusted

export interface BatchReconcile {
  slotCount: number;
  /** Slots whose invoice is in the system with a usable (finite) amount. */
  matchedCount: number;
  /** NET sum of matched invoice totals (a creditnota is negative), absolute euros. */
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
  // [BATCH-SIGN] NET sum, not Σ|amount|. A creditnota slot carries a NEGATIVE total and REDUCES
  // what the supplier debits: invoice €300 + creditnota −€20 against a −€280 debit is the real
  // tie. The old magnitude sum showed "ties" for that batch against a −€320 debit (300+|−20|=320)
  // — a green light on a €40 over-charge. All-positive batches are unchanged (net == Σ|…|). The
  // magnitude of the net is compared, so credit(+) and debit(−) batches both reconcile.
  const total = Math.abs(known.reduce((sum, s) => sum + (s.amount as number), 0));
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

// ─── AUTOMATIC batch booking ──────────────────────────────────────────────────────────────
// The manual UI has always understood multi-invoice batches (reconcileBatch above); the
// AUTOMATIC path (runBankAutoConfirm) historically did not — it only booked 1:1 matches, so a
// wholesale shop whose supplier payments are ALL batched saw nothing auto-reconcile. This is the
// root fix: the same tested tie-logic, exposed as a PURE plan the auto-confirm path can act on.
//
// A batch is auto-bookable ONLY when it is provably unambiguous — the exact same bar as a green
// "ties" in the UI, plus the guards that make blind booking safe:
//   • ≥ 2 resolved invoice numbers in the reference (a real batch, not a 1:1 or a PSP hash),
//   • EVERY referenced number resolves to EXACTLY ONE unpaid invoice of the correct direction
//     (a debit pays purchases, a credit pays sales) — zero matches OR an ambiguous number aborts,
//   • no invoice used for two references, and all invoices from ONE supplier (block a coincidental
//     cross-vendor sum-tie),
//   • the matched gross totals sum to the bank amount TO THE CENT (reconcileBatch "ties").
// Anything short → null → the batch stays for the human (mismatch like a €2.000 short-payment, or
// incomplete like a not-yet-imported invoice). Pure: the caller does the guarded DB writes.

export interface BatchCandidateInvoice {
  id: string;
  invoice_number: string | null;
  total_inc_btw: number | null;
  /** [PARTIAL-PAY] Already settled by earlier instalments. Absent/0 = fully open. The batch
   *  ties on what is STILL OPEN, so a bundle whose customer was asked for the open sum
   *  reconciles against exactly what the bank shows. */
  amount_paid?: number | null;
  client_name: string | null;
  direction: "incoming" | "outgoing" | null;
  status: string | null; // 'paid' invoices are excluded as candidates
}

export interface BatchAutoPlan {
  /** The tie set — every one must be booked paid together, or none (the caller keeps it atomic-ish). */
  invoiceIds: string[];
}

export function planBatchAutoConfirm(args: {
  reference: string | null;
  bankAmount: number | null; // signed: debit negative, credit positive
  invoices: BatchCandidateInvoice[];
}): BatchAutoPlan | null {
  const { reference, bankAmount, invoices } = args;
  if (bankAmount == null || !Number.isFinite(bankAmount) || bankAmount === 0) return null;

  const refNums = parseReferenceNumbers(reference);
  if (refNums.length < 2) return null; // 1:1 is handled by the single-invoice safe pass

  // A debit (money out) settles INCOMING (purchase) invoices; a credit settles OUTGOING (sales).
  const wantDirection: "incoming" | "outgoing" = bankAmount < 0 ? "incoming" : "outgoing";

  // Index unpaid, correctly-directed invoices by normalized number. A number that maps to MORE
  // THAN ONE invoice is ambiguous → the whole batch is unsafe to auto-book.
  const byNum = new Map<string, BatchCandidateInvoice[]>();
  for (const inv of invoices) {
    if ((inv.status ?? "") === "paid") continue;
    if ((inv.direction ?? "") !== wantDirection) continue;
    const key = normalizeRef(inv.invoice_number ?? "");
    if (key.length === 0) continue;
    const arr = byNum.get(key) ?? [];
    arr.push(inv);
    byNum.set(key, arr);
  }

  const picked: BatchCandidateInvoice[] = [];
  const usedIds = new Set<string>();
  for (const ref of refNums) {
    const cands = byNum.get(ref);
    if (!cands || cands.length !== 1) return null; // unmatched OR ambiguous number → not auto-safe
    const inv = cands[0];
    if (inv.total_inc_btw == null || !Number.isFinite(inv.total_inc_btw)) return null;
    // A credit note (negative gross) must never enter the automatic path: reconcileBatch sums by
    // MAGNITUDE, so a credit could satisfy a tie for the wrong (magnitude) amount. A net-of-credit
    // batch is genuinely ambiguous — leave it for the human. (≤ 0 covers creditnota + any junk.)
    if (inv.total_inc_btw <= 0) return null;
    // [PARTIAL-PAY] Nothing left to settle → this invoice cannot be part of what the bank paid.
    // Booking it would settle it for €0 and let the rest of the batch tie on a short amount.
    const open = settleableAmount(inv.total_inc_btw, inv.amount_paid);
    if (open == null || open <= 0) return null;
    if (usedIds.has(inv.id)) return null; // the same invoice can't satisfy two references
    usedIds.add(inv.id);
    picked.push(inv);
  }

  // One batch = one supplier. Reject a coincidental cross-supplier sum-tie (blank names are
  // "unknown" and don't by themselves veto — the exact number+sum tie already carries it).
  const suppliers = new Set(picked.map((p) => normalizeRef(p.client_name ?? "")));
  suppliers.delete("");
  if (suppliers.size > 1) return null;

  // Tie on what is still OPEN per invoice — that is the money the bank line actually moved.
  const slots: BatchSlotInput[] = picked.map((p) => ({
    refNum: normalizeRef(p.invoice_number ?? ""),
    amount: settleableAmount(p.total_inc_btw, p.amount_paid),
    isConfirmed: false,
  }));
  if (reconcileBatch(slots, bankAmount).status !== "ties") return null;

  return { invoiceIds: picked.map((p) => p.id) };
}
