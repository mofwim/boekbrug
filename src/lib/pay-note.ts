// src/lib/pay-note.ts
// [BETAALNOTITIE] An optional note the owner adds to ONE payment, after the supplier's reference.
// Pure, no I/O. Run: npx tsx --test src/lib/pay-note.test.ts
//
// ── THE REQUEST, AND WHY THE FIRST ANSWER WAS NO ──
//
// Paying an invoice in instalments (pay-part.ts), the owner wanted to write "eerste deel" so the
// payment says which one it is. The first answer was no, because the obvious version — making the
// Kenmerk field editable — hands the owner the one thing on that sheet that is not theirs to
// write. It is the SUPPLIER's reference: it is how they find the money, and payment-reference.ts
// already carries a measured invoice that charged interest over a payment it could not place.
//
// The version in this file is a different shape and it is safe:
//
//   · the reference is never replaced, only APPENDED to;
//   · the 140-character EPC limit is measured on the FINAL string, and a note that does not fit is
//     refused out loud instead of silently cut;
//   · the note belongs to the PAYMENT, not to the invoice, so it never touches payment_reference —
//     a per-payment word written onto a per-invoice column is two facts in one place.
//
// ── THE ONE CASE WHERE APPENDING IS STILL WRONG ──
//
// A STRUCTURED creditor reference. structured-reference.ts says it in its own words: such a
// payment "is matched on that reference and on nothing else, because the reference carries its own
// checksum". ISO 11649 (RF…) is standard on e-invoices and increasingly on Dutch bills; the
// Belgian +++…+++ turns up on every Belgian supplier's invoice. Adding words beside one of those is
// exactly the unallocatable payment this whole design exists to avoid — so there, no note is
// offered at all, and the screen says why rather than silently hiding a field.

import { EPC_REMITTANCE_MAX } from "./epc-qr";
import { structuredReferences } from "./structured-reference";

/** What separates the supplier's reference from the owner's note. */
export const NOTE_SEPARATOR = " - ";

export interface PayNotePlan {
  /** May the owner add a note to this payment at all? */
  allowed: boolean;
  /** Dutch, owner-facing: why not, when not. Never a silently hidden field. */
  blocked?: string;
  /** Characters still free for the note once the reference and separator are counted. */
  budget: number;
  /** The note exactly as it would be sent — sanitised, so the counter cannot disagree with it. */
  note: string;
  /** What the QR, the copy row and the preview must ALL carry. One value, or they drift. */
  remittance: string;
  /** Set when the typed note does not fit. The note is then NOT applied — remittance stays clean. */
  error?: string;
}

/**
 * Sanitise the way buildEpcQrPayload will, BEFORE anything is counted.
 *
 * It strips CR/LF because the EPC payload is newline-delimited — a pasted line break there would
 * shift every following line of the QR. Counting first and stripping later would mean the string
 * the budget was measured against is not the string that gets sent, and the counter would lie by
 * exactly the characters removed.
 */
function sanitize(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Decide what one payment's remittance becomes.
 *
 * `reference` is what paymentReferenceFor() produced for this invoice — kenmerk and invoice number
 * together. It is taken as given and never rewritten here.
 */
export function planPayNote(reference: string | null | undefined, typed: string | null | undefined): PayNotePlan {
  const ref = sanitize(reference);
  const note = sanitize(typed);

  // A structured reference is matched on itself alone. Nothing may ride along beside it.
  if (structuredReferences(ref).length > 0) {
    return {
      allowed: false,
      blocked:
        "Dit is een gestructureerd betalingskenmerk. De leverancier zoekt jouw betaling op precies " +
        "deze code, dus er mag niets bij — anders vindt hij hem niet terug.",
      budget: 0,
      note: "",
      remittance: ref,
    };
  }

  const budget = EPC_REMITTANCE_MAX - ref.length - NOTE_SEPARATOR.length;
  if (budget <= 0) {
    return {
      allowed: false,
      blocked:
        "Het kenmerk van deze factuur vult de omschrijving al helemaal. Er is geen ruimte voor een " +
        "eigen tekst zonder dat er iets van het kenmerk afvalt.",
      budget: 0,
      note: "",
      remittance: ref,
    };
  }

  if (!note) {
    return { allowed: true, budget, note: "", remittance: ref };
  }

  // Too long → refused, and the reference is left exactly as it was. The alternative is the thing
  // this module exists to prevent: a .slice() that quietly drops the end of what someone typed.
  if (note.length > budget) {
    return {
      allowed: true,
      budget,
      note: "",
      remittance: ref,
      error: `Je tekst is ${note.length - budget} teken${note.length - budget === 1 ? "" : "s"} te lang. In de omschrijving van een betaling passen ${EPC_REMITTANCE_MAX} tekens, en het kenmerk hoort er ook in.`,
    };
  }

  return { allowed: true, budget, note, remittance: `${ref}${NOTE_SEPARATOR}${note}` };
}
