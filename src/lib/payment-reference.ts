// src/lib/payment-reference.ts
// [KENMERK-BEIDE] What one payment to a supplier must quote. Pure, no I/O.
// Run: npx tsx --test src/lib/payment-reference.test.ts
//
// WHAT WAS MEASURED
//
// A pension invoice from Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf,
// € 362,70. The app read it correctly — factuurnummer PN000037785, and the betalingskenmerk
// E100732098 (the werkgevernummer, which the paper labels as the thing to quote). Then the payment
// sheet offered ONE of them:
//
//     const reference = (inv.payment_reference ?? inv.invoice_number ?? '').trim()
//
// `??` short-circuits, so the moment a betalingskenmerk exists the invoice number is dropped. The
// QR, the copy row and therefore the bank transfer carried E100732098 alone.
//
// The invoice asks for both, twice, in its own words:
//
//     "onder vermelding van E100732098 / PN000037785"
//     "Bij betalingen dient u altijd uw werkgevernummer EN factuurnummer te vermelden waarop uw
//      betaling betrekking heeft."
//
// A creditor who cannot tell WHICH invoice a payment settles books it against the account and not
// against the document. The same page spells out what that costs: "Bij te late betaling ... wordt
// rente in rekening gebracht" — and this invoice already carries € 2,81 of exactly that.
//
// So the two identifiers are not alternatives. One says WHO is paying (the account, the
// werkgevernummer, the acceptgiro kenmerk); the other says WHAT is being paid (the document). A
// creditor's reconciliation needs both, and so does ours: extractInvoiceReference() in
// bank-parser.ts reads every invoice-number-like token back off the statement, so naming both puts
// the document's own number on the bank line where the matcher can find it.
//
// SAFE BY CONSTRUCTION on the bank side: buildEpcQrPayload writes the UNSTRUCTURED remittance
// (EPC line 11, max 140) and leaves the structured ISO 11649 field empty. There is no structured
// reference here to corrupt by adding to it — free text is what that field is for.
//
// NOTE ON LANGUAGE: identifiers and comments are English (AGENTS.md). This module produces no
// user-facing sentence: it composes an identifier that goes on a bank transfer.

/** The two fields an incoming invoice can carry to identify a payment. */
export interface PaymentReferenceFields {
  /** The document's own number — WHAT is being paid. */
  invoice_number?: string | null;
  /** The creditor's betalingskenmerk — WHO is paying, or which account. */
  payment_reference?: string | null;
}

/**
 * The separator the creditors themselves use.
 *
 * Taken from the invoice this was measured on, which prints "E100732098 / PN000037785". The
 * remittance then reads the way the creditor asked for it, and the separator is irrelevant to both
 * readers: extractInvoiceReference() matches tokens, not delimiters.
 */
const JOIN = " / ";

/** Comparable form: case and separators removed, so "PN-000037785" and "pn000037785" are one. */
function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * What this payment quotes.
 *
 * Both identifiers when the invoice carries two DIFFERENT ones, because the creditor's own
 * instruction is routinely "werkgevernummer en factuurnummer" and quoting half of it is what makes
 * a payment unallocatable. One of them when that is all there is. Never both when one already
 * contains the other — a kenmerk read off the paper as "E100732098 / PN000037785" is already the
 * whole answer, and repeating the invoice number would put it on the transfer twice.
 *
 * Order is deliberate: the betalingskenmerk leads, because a creditor whose system keys on it
 * finds it first, and because that is the order the invoices print. Nothing depends on it — both
 * readers scan the whole string — so this is a readability choice, not a rule.
 */
export function paymentReferenceFor(invoice: PaymentReferenceFields): string {
  const kenmerk = String(invoice.payment_reference ?? "").trim();
  const nummer = String(invoice.invoice_number ?? "").trim();
  if (!kenmerk) return nummer;
  if (!nummer) return kenmerk;

  const k = comparable(kenmerk);
  const n = comparable(nummer);
  // Identical, or one already spells out the other. Say it once.
  if (k === n) return kenmerk;
  if (k.includes(n)) return kenmerk;
  if (n.includes(k)) return nummer;

  return `${kenmerk}${JOIN}${nummer}`;
}
