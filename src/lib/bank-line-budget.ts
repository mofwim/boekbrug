// src/lib/bank-line-budget.ts
// [BETAALPLAN] What a bank line has already given away. Pure, no I/O.
// Run: npx tsx --test src/lib/bank-line-budget.test.ts
//
// ── ONE SUM, THREE PLACES ──
// The screen that offers a payment to be divided, the route that books the division, and
// allocate_bank_payment under its lock all need the same number: how much of this line is spent.
// It was written three times, and the three then disagreed — which is the whole reason this file
// exists rather than the sum being inlined a fourth time.
//
// ── THE SIGN IS THE POINT ──
// bank_tx_invoices.amount_applied is stored as a MAGNITUDE, deliberately: per INVOICE the link
// means "this much of it was settled", which is positive for a creditnota too, and that is what
// recompute_invoice_amount_paid and the unlink reversal both read.
//
// But the LINE's budget is not a sum of magnitudes. A €150 credit linked to an €850 debit did not
// take €150 from the line, it GAVE €150 to it: the line has €1.000 to give, not €700. Summed as
// magnitudes that is a €300 error, in the direction that refuses plans which are exactly right.
//
// So the sign is re-derived here — and it is NOT simply "is it a creditnota". That was this file's
// first rule and it is right for the case it was written for and wrong for one that also happens:
//
//   · a €850 DEBIT made of a €1.000 supplier invoice and a €150 supplier credit — the credit gives
//     €150 back, so the line has €1.000 to spend;
//   · a €150 CREDIT on the statement, being the supplier actually refunding that credit note —
//     here the very same creditnota SPENDS the line, because the refund IS the money.
//
// A creditnota is not inherently one or the other. What decides is whether it moves money the same
// way the bank line did, which is why every function here takes the line's signed amount. The
// creditnota test itself stays as it is everywhere else in this app (payment-plan.ts's isCreditnota,
// money-invariants.ts's creditnotaIds): the type, OR a negative total, because both are how a
// credit reaches this table — the type is what the app writes, a negative total is what an import
// can leave behind.

/** A row of bank_tx_invoices, as every caller reads it. */
export interface BudgetLink {
  invoice_id: string;
  /** Magnitude, or NULL for a link written before the column existed. */
  amount_applied?: number | null;
}

/** Just enough of an invoice to know which way it moves money. */
export interface BudgetInvoice {
  id: string;
  /** 'incoming' = a bill you pay; 'outgoing' = a sale you are paid for. */
  direction?: string | null;
  invoice_type?: string | null;
  total_inc_btw?: number | null;
}

/** True when this invoice takes money OUT of the owner's account. */
export function invoiceMovesMoneyOut(
  inv: Pick<BudgetInvoice, "direction" | "invoice_type" | "total_inc_btw">,
): boolean {
  const isCredit =
    (inv.invoice_type ?? "factuur") === "creditnota" || (Number(inv.total_inc_btw) || 0) < 0;
  const paysOut = (inv.direction ?? "incoming") === "incoming";
  // A credit reverses its invoice: a supplier's credit brings money IN, a credit you issue to a
  // customer sends money OUT.
  return paysOut !== isCredit;
}

/**
 * Does this invoice SPEND the bank line, or GIVE money back to it?
 *
 * ── WHY THIS IS NOT SIMPLY "IS IT A CREDITNOTA" ──
 * The first version of this rule was `creditnota → gives back`, and that is right for the case it
 * was written for and wrong for one that also happens:
 *
 *   · a €850 debit made of a €1.000 supplier invoice and a €150 supplier credit — the credit gives
 *     €150 back to the line, so the line has €1.000 to spend;
 *   · a €150 CREDIT on the statement, being the supplier actually refunding that credit note —
 *     here the very same creditnota SPENDS the line, because the refund is the money.
 *
 * A creditnota is not inherently one or the other. What decides is whether it moves money the same
 * way the bank line did. So: same direction ⇒ it spends the line; opposite ⇒ it gives back.
 */
export function spendsTheLine(
  inv: Pick<BudgetInvoice, "direction" | "invoice_type" | "total_inc_btw">,
  lineMovesOut: boolean,
): boolean {
  return invoiceMovesMoneyOut(inv) === lineMovesOut;
}

export interface AllocatedResult {
  /** Signed: what earlier links took from this line. Negative when credits outweigh invoices. */
  allocated: number;
  /**
   * Links whose invoice was not among the ones supplied. NOT counted — and named, because a caller
   * that silently drops them computes a budget that is too large, which is the direction that lets
   * the same euros be spent twice. money-invariants.ts treats the same situation the same way.
   */
  unknownInvoiceIds: string[];
}

/**
 * Sum what a bank line has already given away, signed.
 *
 * A link with a NULL amount comes from before amount_applied existed and by construction settled
 * its invoice in full, so the invoice's own total is what it took. Reading NULL as 0 would let the
 * same euros be spent twice — which is why the invoice rows have to be supplied here at all.
 */
export function allocatedOnLine(
  links: readonly BudgetLink[] | null | undefined,
  invoices: readonly BudgetInvoice[] | null | undefined,
  /** The bank line's SIGNED amount. Negative is money out. Decides which way each link counts. */
  txAmount: number,
): AllocatedResult {
  const lineMovesOut = (Number(txAmount) || 0) < 0;
  const byId = new Map((invoices ?? []).map((i) => [i.id, i]));
  const unknownInvoiceIds: string[] = [];
  let allocated = 0;

  for (const link of links ?? []) {
    const inv = byId.get(link.invoice_id);
    if (!inv) {
      unknownInvoiceIds.push(link.invoice_id);
      continue;
    }
    const magnitude =
      link.amount_applied != null
        ? Math.abs(Number(link.amount_applied) || 0)
        : Math.abs(Number(inv.total_inc_btw) || 0);
    allocated += (spendsTheLine(inv, lineMovesOut) ? 1 : -1) * magnitude;
  }

  return { allocated: Math.round(allocated * 100) / 100, unknownInvoiceIds };
}

/** A link that knows which transaction it belongs to. */
export interface GroupedLink extends BudgetLink {
  transaction_id?: string | null;
}

/**
 * The same signed sum, per transaction — for the bank page, which measures every pending line at
 * once to decide which are fully covered.
 *
 * Summed as magnitudes this hides money. A €850 debit with a €150 credit and a €700 invoice on it
 * has €300 still to assign; magnitudes make that 150 + 700 = 850, the line reads as fully covered,
 * and it leaves "te bevestigen" with €300 nobody is looking at any more. Signed it is 700 − 150 =
 * 550 against 850, and the line stays where the owner can see it.
 *
 * Links whose invoice was not supplied are reported per transaction rather than counted, for the
 * same reason as above: a budget that is too large is the direction that loses money.
 */
export function allocatedByTransaction(
  links: readonly GroupedLink[] | null | undefined,
  invoices: readonly BudgetInvoice[] | null | undefined,
  /**
   * Each line's SIGNED amount. A link counts against the line it belongs to, and which way it
   * counts depends on that line's own direction — so a caller measuring many lines at once has to
   * say which is which. A transaction missing from this map is reported as unmeasurable rather
   * than assumed: guessing its direction is guessing the sign of money.
   */
  txAmountById: ReadonlyMap<string, number>,
): { byTransaction: Map<string, number>; unknownByTransaction: Map<string, string[]> } {
  const byId = new Map((invoices ?? []).map((i) => [i.id, i]));
  const byTransaction = new Map<string, number>();
  const unknownByTransaction = new Map<string, string[]>();

  for (const link of links ?? []) {
    const txId = link.transaction_id;
    if (!txId) continue;
    const inv = byId.get(link.invoice_id);
    const txAmount = txAmountById.get(txId);
    if (!inv || txAmount == null) {
      const list = unknownByTransaction.get(txId) ?? [];
      list.push(link.invoice_id);
      unknownByTransaction.set(txId, list);
      continue;
    }
    const magnitude =
      link.amount_applied != null
        ? Math.abs(Number(link.amount_applied) || 0)
        : Math.abs(Number(inv.total_inc_btw) || 0);
    const signed = (spendsTheLine(inv, (Number(txAmount) || 0) < 0) ? 1 : -1) * magnitude;
    byTransaction.set(txId, (byTransaction.get(txId) ?? 0) + signed);
  }

  for (const [txId, total] of byTransaction) {
    byTransaction.set(txId, Math.round(total * 100) / 100);
  }
  return { byTransaction, unknownByTransaction };
}
