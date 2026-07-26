// src/lib/credited-invoices.ts
// [CREDITNOTA-NO-CHASE] One rule for "is this outgoing invoice still money owed TO me?", because
// getting it wrong has now been possible on four separate surfaces (the reminder cron, the daily
// truth tile, the Vandaag to-do list, the public pay page) and each of them re-derived it.
//
// A creditnota withdraws an invoice, but NOTHING in the invoice row says so. The original keeps
// its 'sent'/'overdue' status, its positive total and its due date — deliberately, because that
// +omzet must stay to be netted by the creditnota's −omzet. Meanwhile the creditnota itself is
// ALSO an outgoing row with status 'sent' and a NEGATIVE total, so the naive query
// (sender_id + direction 'outgoing' + status sent/overdue) returns BOTH.
//
// That pairing is why a receivable list must exclude BOTH sides together or neither:
//   · both in   → the euro total nets out by accident, but the COUNT and the overdue count are
//                 inflated by two, and the owner is told to chase an invoice they withdrew;
//   · only the original removed → the −X creditnota is left alone in the list and the receivable
//                 total goes NEGATIVE (worse than where we started);
//   · both out   → count, overdue and total are all correct. This is the rule below.
//
// NO I/O. The caller supplies the set of invoice ids that have a creditnota against them.

/** The fields the receivable rule reads. A subset of the invoices row. */
export interface CreditableInvoiceRow {
  id: string;
  invoice_type?: string | null;
  status?: string | null;
  total_inc_btw?: number | null;
}

/** Is this row a creditnota (a credit the owner OWES, never a receivable)? */
export function isCreditnota(row: CreditableInvoiceRow): boolean {
  return (row.invoice_type ?? "") === "creditnota";
}

/**
 * Is this outgoing invoice still money owed TO the owner?
 *
 * False for a creditnota (it is the opposite of a receivable) and false for an invoice that has
 * been withdrawn by one. Everything else is unchanged — this never looks at amounts or dates, so
 * it cannot alter a normal invoice's treatment.
 *
 * @param creditedIds ids of invoices that HAVE a creditnota against them
 *                    (i.e. the original_invoice_id values of the owner's creditnotas).
 */
export function isOpenReceivable(
  row: CreditableInvoiceRow,
  creditedIds: ReadonlySet<string>
): boolean {
  if (isCreditnota(row)) return false;
  return !creditedIds.has(row.id);
}

/** Keep only the rows that are genuinely still owed. Order preserved. */
export function filterOpenReceivables<T extends CreditableInvoiceRow>(
  rows: readonly T[],
  creditedIds: ReadonlySet<string>
): T[] {
  return rows.filter((r) => isOpenReceivable(r, creditedIds));
}

/**
 * Build the credited-ids set from the owner's creditnota rows.
 * Tolerates nulls so a caller can pass a raw query result straight in.
 */
export function creditedIdsFrom(
  creditnotaRows: readonly { original_invoice_id?: string | null }[] | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const r of creditnotaRows ?? []) {
    const id = r?.original_invoice_id;
    if (id) out.add(id);
  }
  return out;
}
