// src/lib/client-extra-lines.ts
// [KLANT-EXTRA] Two free lines under the customer's name. Pure, no I/O.
// Run: npx tsx --test src/lib/client-extra-lines.test.ts
//
// WHAT THIS IS FOR
// The customer block on an invoice carries a name, an address and a btw number, and for a great
// many real invoices that is not enough to get the document to the right desk:
//
//     Stichting Contour
//     t.a.v. mevrouw Jansen          <- who it is for
//     Afdeling Inkoop / PO-2026-114  <- the reference their system needs to pay it
//     Spoorlaan 444
//     5038 CB Tilburg
//
// Larger customers refuse or delay invoices that arrive without their own reference on them, and
// until now the only place to put one was the description of a line — where it becomes part of
// what was supplied, which it is not.
//
// WHY TWO, AND WHY FREE TEXT
// Two because that is what the addressee case needs: a person and a department or reference. Not
// a fixed "t.a.v." field, because the second line is a reference at one customer, a building at
// another, and a cost centre at a third — and a field that names one of those is wrong for the
// other two. The owner writes what their customer asked for.
//
// PER DOCUMENT, NOT PER CUSTOMER. A purchase-order reference is different on every invoice, so
// this belongs on the invoice. A customer's standing addressee would belong on the customer, and
// that is a separate thing this does not pretend to be.
//
// NOTHING IS INVENTED AND NOTHING IS REQUIRED. Both lines empty is the normal state and produces
// exactly the document that existed before this field — the block collapses, it does not leave a
// gap where a line would have been.

/**
 * The most a single line may carry.
 *
 * Measured: the customer block is 48% of an A4 page, and at 10pt Helvetica roughly 60 characters
 * fill one rendered line. Past that react-pdf wraps rather than clips, so nothing is ever lost on
 * the page — the ceiling exists so a pasted paragraph cannot push the address block down over the
 * rest of the document.
 *
 * Enforced at the INPUT too (maxLength), so the owner meets the limit while typing rather than
 * discovering it on a rendered invoice. Cutting text silently at render is the one behaviour worth
 * avoiding here: the customer would receive a truncated reference and nobody would know.
 */
export const MAX_EXTRA_LINE_LENGTH = 60;

export interface ClientExtraLineSource {
  client_extra_line1?: string | null;
  client_extra_line2?: string | null;
}

/**
 * One line, trimmed, bounded, with any newline flattened.
 *
 * A newline matters: this is a single Text row on the PDF and a single cell in the UBL address, so
 * a pasted two-line signature has to become one line or it breaks the block it sits in.
 */
export function cleanExtraLine(value: string | null | undefined): string {
  // Only text and numbers become text. `String(value)` alone would print "[object Object]" onto a
  // customer's invoice for any body that sent an object here — caught by this file's own test, and
  // the sort of thing nobody notices until it is on a document that has already been sent.
  if (typeof value !== "string" && typeof value !== "number") return "";
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > MAX_EXTRA_LINE_LENGTH ? s.slice(0, MAX_EXTRA_LINE_LENGTH).trimEnd() : s;
}

/**
 * The lines to print under the customer's name, in order, with the empty ones dropped.
 *
 * Dropped rather than rendered blank, and this is the whole reason the function exists: an owner
 * who fills only the second field must not get a hole in their address block where the first would
 * have been. The result is what goes on the page — never a fixed-length pair.
 */
export function clientExtraLines(source: ClientExtraLineSource | null | undefined): string[] {
  return [source?.client_extra_line1, source?.client_extra_line2]
    .map(cleanExtraLine)
    .filter((l) => l.length > 0);
}
