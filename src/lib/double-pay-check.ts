// src/lib/double-pay-check.ts
// [PAY-SAFE-NUMBER] Which already-paid invoice, if any, should stop the owner before they pay
// this one — decided in one pure function so the route stays I/O and the rule stays testable.
//
// The no-double-pay check exists for ONE case, and /api/incoming/check-paid says so in its own
// header: "the vendor re-sent the same invoice and I paid the first one". A re-sent invoice
// carries the SAME number. But the query behind it never looked at a number — vendor + amount +
// paid within 120 days was the whole test — so it fired just as loudly on the ordinary opposite:
// a supplier who bills the same amount on a rhythm. A boekhouder on a monthly fee, a
// huurcontract, an abonnement: every period the owner was told they might already have paid this,
// about a document that plainly carries a different number. A warning that cries wolf every month
// is worse than no warning — it teaches the owner to tap past the one that matters.
//
// So the invoice number decides. It only gets to decide when it is REAL on both sides: a
// placeholder ("UPLOAD-17", "EMAIL-9") means we never read a number off the document, and two of
// those are not "two different numbers" but two failed reads. There the old vendor+amount signal
// is the only thing between the owner and a second payment, so it stands untouched. The rule
// never weakens the check where it is the only check left.

import { isPlaceholderInvoiceNumber, normalizeInvoiceNumber } from "./safecore";

/** The fields of an already-paid candidate this decision needs. */
export interface PaidTwinCandidate {
  id: string;
  invoice_number: string | null;
  client_name?: string | null;
  total_inc_btw?: number | null;
  payment_date?: string | null;
  marked_paid_at?: string | null;
}

/** Does this string name a real invoice number, or is it a stand-in for one we never read? */
function hasRealNumber(n: string | null | undefined): boolean {
  return normalizeInvoiceNumber(n) !== "" && !isPlaceholderInvoiceNumber(n);
}

/**
 * Pick the paid invoice worth warning about, out of the candidates already narrowed to
 * "same vendor, same amount, paid recently". Returns null when none of them is a re-send —
 * i.e. when every candidate states its own, different invoice number.
 *
 * Order of preference is deliberate: a same-number twin is THE signal and must be the one shown,
 * whatever order the database returned; only when there is none does an unreadable-number
 * candidate stand in.
 */
export function pickPaidTwin<T extends PaidTwinCandidate>(
  targetInvoiceNumber: string | null | undefined,
  candidates: readonly T[],
): T | null {
  const targetNum = normalizeInvoiceNumber(targetInvoiceNumber);
  const targetNumIsReal = hasRealNumber(targetInvoiceNumber);

  const sameNumber = (c: PaidTwinCandidate) => {
    const n = normalizeInvoiceNumber(c.invoice_number);
    return n !== "" && n === targetNum;
  };

  const surviving = candidates.filter((c) => {
    if (sameNumber(c)) return true; // the re-send this check is FOR
    // Both documents state their own, different number → two bills on a running account.
    if (targetNumIsReal && hasRealNumber(c.invoice_number)) return false;
    // At least one side has no readable number → the number cannot separate them; keep warning.
    return true;
  });

  return surviving.find(sameNumber) ?? surviving[0] ?? null;
}
