// src/lib/invoice-editable.ts
// [OFFERTE-BEWERKBAAR] May this document still be changed? Pure, no I/O.
// Run: npx tsx --test src/lib/invoice-editable.test.ts
//
// WHY THIS IS A FILE AND NOT AN `if`
// The rule was `status === 'draft'`, written once in the screen and once in the route. That is the
// right rule for a FACTUUR and the wrong one for an OFFERTE, and the difference matters in both
// directions:
//
//   · A factuur that has been sent carries a legal number from a gapless series (Art. 35 Wet OB,
//     forward-only). Editing it is not a correction, it is rewriting a document someone already
//     has — that is what a creditnota is for. This must stay impossible.
//   · An offerte is a PRICE QUOTE. It has no number, it is in no series, it is not a legal
//     invoice, and the Belastingdienst does not count it. A customer asking "can you do it for
//     less?" is the ordinary course of business — and until now, an offerte that had been sent
//     could not be touched. The owner's only route was to make a second one and hope the customer
//     looked at the right one.
//
// So the two questions were being answered by one flag, and the quote inherited the invoice's
// restrictions for no reason anyone had chosen.

/** The invoice_type values that mean "this is a quote, not an invoice". */
const QUOTE_TYPES = new Set(["pro_forma", "offerte"]);

/** Is this document a quote rather than a legal invoice? */
export function isQuote(invoiceType: string | null | undefined): boolean {
  return QUOTE_TYPES.has((invoiceType ?? "").trim());
}

export interface EditableInput {
  /** invoices.status */
  status: string | null | undefined;
  /** invoices.invoice_type */
  invoiceType: string | null | undefined;
  /** invoices.invoice_number — the thing that makes a document legally issued. */
  invoiceNumber: string | null | undefined;
}

/**
 * May this document still be edited?
 *
 * A draft is editable, as before. A QUOTE is editable for as long as it is still a quote — which
 * is exactly the owner's own rule: change it until you turn it into an invoice.
 *
 * THE SECOND CONDITION IS NOT REDUNDANT. A quote is editable only while it carries NO number.
 * Sending a quote CONVERTS it (see /api/invoice/send: `isConversion` → invoice_type becomes
 * 'factuur'), so after conversion the type alone would already refuse. But a row that somehow
 * holds a number while still typed as a quote is a legally issued document whatever its type says,
 * and the one thing this function may never do is open one of those for editing. Two conditions,
 * so no single wrong field can unlock a numbered document.
 */
export function isInvoiceEditable(input: EditableInput): boolean {
  const status = (input.status ?? "").trim();
  const number = (input.invoiceNumber ?? "").trim();

  if (status === "draft") return true;
  return isQuote(input.invoiceType) && number.length === 0;
}

/**
 * Why an edit was refused, in Dutch, for the owner.
 *
 * Never a bare "niet toegestaan": the two reasons need different actions from the owner, and
 * telling them which one they hit is the difference between "make a creditnota" and "you are
 * looking at the wrong row".
 */
export function editRefusalText(input: EditableInput): string {
  if (isInvoiceEditable(input)) return "";
  if (isQuote(input.invoiceType)) {
    return "Deze offerte heeft al een factuurnummer gekregen en telt daarmee als verstuurde factuur. Corrigeer hem met een creditnota.";
  }
  return "Een verstuurde factuur kan niet meer worden gewijzigd. Corrigeer hem met een creditnota.";
}
