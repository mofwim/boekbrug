// src/lib/creditnota.ts
// [CREDITNOTA-REF] The sentence a credit note is legally required to carry. Pure; no I/O.
// Run: npx tsx src/lib/creditnota.test.ts
//
// Art. 219 Richtlijn 2006/112/EG (art. 35 Wet OB): a document that amends an earlier invoice is
// only EQUATED WITH an invoice when it "refers specifically and unambiguously to the initial
// invoice". A credit note that names only itself is not such a document.
//
// The generated PDF used to say exactly one thing: "Deze creditnota crediteert het bovenstaande
// bedrag. Er is geen betaling vereist." — its own number, its own date, negative amounts, and no
// word about WHICH invoice it corrects. Every credit note the app produced was therefore formally
// deficient: the customer's own correction can be challenged, and the owner's BTW correction is
// left without its documentary basis.
//
// The link was always there (invoices.original_invoice_id, written and FK-guarded by the
// creditnota route) — it simply never reached the page.

/** ISO 'YYYY-MM-DD' → 'DD-MM-YYYY'. Pure string surgery, so no timezone can shift the day. */
function dayNL(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * The reference line for a credit note, or null when there is nothing to point at.
 *
 * Returns null rather than a vague sentence when the original's number is unknown: an
 * unidentifiable reference is not a reference, and printing "corrigeert een eerdere factuur"
 * would look like compliance without being it. A legacy credit note whose link was never stored
 * cannot be repaired at render time — that is a data gap, not something to paper over.
 *
 * The DATE is included when known. It is not required by itself, but it is what makes the
 * reference unambiguous when a number was ever reused across years.
 */
export function creditnotaReferenceLine(args: {
  originalNumber: string | null | undefined;
  originalDate?: string | null;
}): string | null {
  const number = String(args.originalNumber ?? "").trim();
  if (!number) return null;
  const day = dayNL(args.originalDate);
  return day
    ? `Deze creditnota corrigeert factuur ${number} van ${day}.`
    : `Deze creditnota corrigeert factuur ${number}.`;
}
