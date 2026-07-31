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
// So the invoice number decides — but going silent is the dangerous direction, so it only gets to
// silence the warning where it actually proves the two are different documents. Two fences:
//
//  1. The number must be REAL on both sides. A placeholder ("UPLOAD-17", "EMAIL-9") means we never
//     read a number off the document, and two of those are not "two different numbers" but two
//     failed reads. There the old vendor+amount signal is the only thing between the owner and a
//     second payment, so it stands untouched.
//  2. The invoice DATES must differ. Same supplier, same amount, same invoice date, two different
//     numbers is the shape of ONE document read twice — an OCR digit misread on one copy — and
//     that is exactly a double payment waiting to happen. A running account does not bill the same
//     amount twice on the same day; a misread does. So the number only clears a pair that also
//     sits on different days. A missing date on either side cannot clear anything, and doesn't.

import { isPlaceholderInvoiceNumber, normalizeInvoiceNumber } from "./safecore";

/** The fields of an already-paid candidate this decision needs. */
export interface PaidTwinCandidate {
  id: string;
  invoice_number: string | null;
  invoice_date?: string | null;
  client_name?: string | null;
  total_inc_btw?: number | null;
  payment_date?: string | null;
  marked_paid_at?: string | null;
}

/** The invoice the owner is about to pay — only the two fields that decide this. */
export interface PayTarget {
  invoice_number: string | null | undefined;
  invoice_date?: string | null;
}

/** Does this string name a real invoice number, or is it a stand-in for one we never read? */
function hasRealNumber(n: string | null | undefined): boolean {
  return normalizeInvoiceNumber(n) !== "" && !isPlaceholderInvoiceNumber(n);
}

/** The calendar day, or null when nothing usable was stored. */
function day(raw: string | null | undefined): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/**
 * Pick the paid invoice worth warning about, out of the candidates already narrowed to
 * "same vendor, same amount, paid recently". Returns null when none of them can be the same
 * document — i.e. when every candidate states its own real number AND sits on its own date.
 *
 * Order of preference is deliberate: a same-number twin is THE signal and must be the one shown,
 * whatever order the database returned; only when there is none does a weaker candidate stand in.
 */
export function pickPaidTwin<T extends PaidTwinCandidate>(
  target: PayTarget,
  candidates: readonly T[],
): T | null {
  const targetNum = normalizeInvoiceNumber(target.invoice_number);
  const targetNumIsReal = hasRealNumber(target.invoice_number);
  const targetDay = day(target.invoice_date);

  const sameNumber = (c: PaidTwinCandidate) => {
    const n = normalizeInvoiceNumber(c.invoice_number);
    return n !== "" && n === targetNum;
  };

  const surviving = candidates.filter((c) => {
    if (sameNumber(c)) return true; // the re-send this check is FOR
    // Fence 1 — at least one side has no readable number: the number cannot separate them.
    if (!targetNumIsReal || !hasRealNumber(c.invoice_number)) return true;
    // Fence 2 — the dates must PROVE the pair apart before the number is allowed to clear it.
    // A missing date on either side proves nothing: absence of evidence is not evidence, and
    // reading it as "different documents" would silence the warning on exactly the invoices we
    // understand least. Only two readable dates that differ let a pair through.
    const cDay = day(c.invoice_date);
    if (!targetDay || !cDay) return true;
    if (targetDay === cDay) return true; // one document, read twice (an OCR digit misread)
    // Two documents that state their own number AND their own date → a running account.
    return false;
  });

  return surviving.find(sameNumber) ?? surviving[0] ?? null;
}
