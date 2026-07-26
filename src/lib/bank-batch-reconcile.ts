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

import { normalizeRef, parseReferenceNumbers, referenceMatches } from "./bank-matching";

/** The payment text a batch is read from: the extracted reference AND the raw remittance. */
export interface BatchPaymentText {
  reference: string | null | undefined;
  /** The full statement line. REQUIRED in practice — see resolveBatchNumbers. */
  description?: string | null;
}

// [BANK-PSP-MATCH] Which of the invoice numbers we KNOW does this payment actually reference?
//
// This is the ONLY safe signal for "is this a genuine multi-invoice batch?". A PSP / order
// gateway (Mollie, webshop) writes a transaction hash + an order number in the remittance, so
// the reference has several fragments even though ZERO of them are invoice numbers. Counting
// fragments alone (the old bug) forced the slot view and hid a real amount-matched invoice.
// Counting FULL-amount candidates instead (the second bug an adversarial review caught) let an
// UNRELATED invoice that happened to equal the whole debit collapse a genuine batch and
// auto-select the wrong invoice. Resolving against real invoice numbers avoids both.
//
// [BUNDEL-REF-RECOVER] It reads the DESCRIPTION as well as the reference, and that is the whole
// point. `reference` is what extractInvoiceReference could carve out of the remittance, and its
// token regex cuts a number at every separator and drops a leading year as "a bare year":
//     "2026-045, 2026-046"  →  reference "045, 046"
//     "F-1001, F-1002"      →  reference "1001, 1002"
// Both are then unmatchable — "045" is below the 4-char safety floor, and "1001" is not the
// invoice's number ("F-1001"). So for every owner whose invoices are NOT on the app's default
// {year}{seq} template — which is EVERY supplier invoice, since the supplier numbers those —
// the app could not recognise the bundled payment IT asked the owner to make. Matching the
// invoice's own number against the full text with referenceMatches' whole-token rules recovers
// it: the raw "2026-045" is still in the description, and normalizeRef makes the separator
// irrelevant. The 4-char floor stays (a 3-digit "045" can never be identified safely).
export function resolveBatchNumbers(
  tx: BatchPaymentText,
  knownInvoiceNumbers: Array<string | null | undefined>,
): string[] {
  // The equality path splits the reference the way the extractor JOINED it ("num1, num2") and
  // applies NO length floor: comparing a whole fragment to a whole invoice number is exact
  // identity, so a short number like "501" is safe here (it is not a substring search). The
  // 4-char floor belongs to the text scan below, and to the automatic booking path, which keeps
  // its own bar — see planBatchAutoConfirm.
  const refTokens = new Set(
    (tx.reference ?? "").split(",").map((part) => normalizeRef(part)).filter((t) => t.length > 0),
  );
  const scan = { reference: tx.reference ?? null, description: tx.description ?? "" };
  const seen = new Set<string>();
  const found: string[] = [];
  for (const raw of knownInvoiceNumbers) {
    const number = (raw ?? "").trim();
    if (!number) continue;
    const key = normalizeRef(number);
    if (key.length === 0 || seen.has(key)) continue; // dedup: a doubled number isn't two invoices
    // Either the extracted reference lists this exact number (the classic case), or the number
    // is printed as a whole token somewhere in the payment text (the recovery case above).
    if (refTokens.has(key) || referenceMatches(scan, number)) {
      seen.add(key);
      found.push(number);
    }
  }
  return found;
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
  /** [BUNDEL-REF-RECOVER] The raw statement line. Without it a bundle whose invoice numbers
   *  carry a prefix or a separator can never be recognised — see resolveBatchNumbers. */
  description?: string | null;
  bankAmount: number | null; // signed: debit negative, credit positive
  invoices: BatchCandidateInvoice[];
}): BatchAutoPlan | null {
  const { reference, description, bankAmount, invoices } = args;
  if (bankAmount == null || !Number.isFinite(bankAmount) || bankAmount === 0) return null;

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

  // Which of those numbers does this payment actually print? (One representative per number —
  // they normalize equal, and an ambiguous number is rejected right below.)
  // [BANK-BATCH-SHORT-NUMBER] Booking money unattended keeps the 4-character identity floor the
  // matcher uses everywhere else: "501" is a plausible order number, postcode fragment or line
  // count, and no sum-tie makes that safe to act on without a human. The manual slot UI does
  // resolve short numbers (exact fragment equality, a human confirms) — that asymmetry is the
  // point. A batch containing one falls through to the unresolved-token guard below and stays
  // for the owner.
  const printed = resolveBatchNumbers(
    { reference, description },
    [...byNum.values()].map((group) => group[0].invoice_number),
  ).filter((number) => normalizeRef(number).length >= 4);
  if (printed.length < 2) return null; // 1:1 is handled by the single-invoice safe pass

  const picked: BatchCandidateInvoice[] = [];
  const usedIds = new Set<string>();
  for (const number of printed) {
    const cands = byNum.get(normalizeRef(number));
    if (!cands || cands.length !== 1) return null; // ambiguous number → not auto-safe
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

  // [BANK-BATCH-UNRESOLVED] Every number-shaped token the extractor found must be accounted for.
  // A token that is neither one of the picked numbers nor a FRAGMENT of one (the extractor cuts
  // "2026-045" down to "045", so "045" ⊂ "2026045" is that same invoice) is a number this payment
  // references and we could not resolve — a not-yet-imported invoice, or a customer number that
  // makes the reference untrustworthy. Either way it is not provably-exact, so it stays for the
  // human. This is the guard the old number-driven loop got for free; keeping it means the wider
  // recognition above can only ever ADD batches that reconcile, never loosen the bar.
  const pickedKeys = picked.map((p) => normalizeRef(p.invoice_number ?? ""));
  const unresolved = parseReferenceNumbers(reference).filter(
    (token) => !pickedKeys.some((key) => key === token || key.includes(token)),
  );
  if (unresolved.length > 0) return null;

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
