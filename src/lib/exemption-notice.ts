// src/lib/exemption-notice.ts
// [VRIJSTELLING-OP-PAPIER] The sentence an exempt invoice must CARRY, and the one place it lives.
// Pure, no I/O. Run: npx tsx --test src/lib/exemption-notice.test.ts
//
// Not to be confused with vat-exemption.ts next to it. That module answers what an exemption does
// to the BOOKS — which rubriek the turnover avoids, and how much input BTW may still be deducted
// (the pro rata). This one answers what it must say on the DOCUMENT. Two different questions about
// the same fact, and keeping them in one file would have meant importing the pro-rata machinery
// into the PDF renderer to print a sentence.
//
// ── WHAT WAS WRONG ──
//
// A shop invoices €500 of exported goods at a genuine 0% and €500 of a course that is EXEMPT under
// art. 11 Wet OB. Two supplies, two different legal facts. Rendered and read back out of the real
// PDF with pdfjs, the customer received exactly one line about the tax:
//
//     0,00% BTW over € 1.000,00        € 0,00
//
// and nowhere the words "vrijgesteld" or "artikel 11".
//
// The e-invoice for that same sale is right: the UBL splits it into category Z (€500) and category
// E (€500), and the E subtotal carries the reason text, because BR-E-10 of Peppol BIS 3.0 refuses
// the file without it.
//
// So the app knew the difference in the XML and not on the paper — and the paper is what the
// customer files and an inspector asks for. Art. 226 punt 11 of directive 2006/112/EG (art. 35a
// lid 1 sub k Wet OB) requires an exempt invoice to REFERENCE the exemption. An invoice without it
// is formally deficient, and that is the ground on which the exemption gets challenged.
//
// ── WHY A MODULE FOR ONE SENTENCE ──
//
// Because there were nearly two of them. The UBL already had this text inside taxExemptionReason();
// writing a second copy for the PDF is how two documents start disagreeing about a legal claim —
// the defect this audit has now met three times over (the leverdatum, the reverse charge, and
// this). ubl-export.ts imports the constant from here, so there is one string.
//
// ── WHAT IS DELIBERATELY NOT FIXED HERE ──
//
// The summary still prints ONE "0,00% BTW" row over the combined €1.000 rather than splitting it
// in two. That row is not false — the BTW on both halves really is zero — it is incomplete about
// WHY, and the sentence below supplies the why and names the exempt amount so the halves can be
// told apart. Splitting the row itself would mean changing applyDiscount(), which groups by rate
// and is shared by the screen, the PDF and the UBL; a rounding change there travels to every
// invoice in the product to improve the wording of one. The legal gap is the missing reference,
// and that is what this closes.

/** The reason text, verbatim. The UBL sends this string; the PDF prints it. */
export const EXEMPT_REASON_NL = "Vrijgesteld van btw op grond van artikel 11 Wet OB 1968";

/** A line, as little of it as this question needs. */
export interface ExemptLineLike {
  /** Carried so a caller can hand over its own line objects unchanged; not read here — an exempt
   *  supply is identified by the flag, never by a rate that happens to be 0. */
  btw_rate?: number | string | null;
  line_total?: number | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  /** The flag the aangifte reads to keep this turnover out of every rubriek. */
  vat_treatment?: string | null;
}

/** Only the literal 'exempt' counts. An unknown value is not an exemption. */
export function isExemptLine(l: ExemptLineLike): boolean {
  return l.vat_treatment === "exempt";
}

/**
 * The ex-BTW total of the exempt lines, signed as the document is.
 *
 * Reads line_total when it is there and falls back to quantity x unit_price — the same order and
 * the same precedence the PDF's own rate breakdown uses, so the two can never name different
 * amounts for the same lines. A creditnota's negative amounts come through negative.
 */
export function exemptTotal(lines: readonly ExemptLineLike[]): number {
  let sum = 0;
  for (const l of lines) {
    if (!isExemptLine(l)) continue;
    sum +=
      l.line_total !== null && l.line_total !== undefined
        ? Number(l.line_total) || 0
        : (Number(l.quantity ?? 0) || 0) * (Number(l.unit_price ?? 0) || 0);
  }
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}

/** € 1.000,00 — kept local so this module stays dependency-free for the PDF renderer. */
function euro(n: number): string {
  return `€ ${new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

/**
 * The mandatory exemption sentence for this invoice, or null when it does not apply.
 *
 * Shaped like reverseChargeNotice() in icp.ts on purpose — same kind of question, same answer
 * type, and the same two refusals: only a legal invoice may carry a BTW statement, and an owner
 * who already wrote the reference himself is not told it twice.
 */
export function exemptionNotice(args: {
  lines: readonly ExemptLineLike[];
  invoiceType: string | null | undefined;
  /** The invoice's own line texts — if the owner already referenced it, we do not repeat it. */
  lineTexts?: ReadonlyArray<string | null | undefined>;
}): string | null {
  // An offerte or pro forma is not a legal invoice and may not carry a BTW statement at all.
  const type = args.invoiceType ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") return null;

  const total = exemptTotal(args.lines);
  if (total === 0) return null;

  for (const t of args.lineTexts ?? []) {
    if (/vrijgesteld|artikel\s*11|art\.?\s*11/i.test(String(t ?? ""))) return null;
  }

  // The amount is named because the invoice may also carry taxed or genuinely 0%-rated lines:
  // without it the reader cannot tell WHICH part of the total the exemption covers, and that is
  // the whole point of the reference. Magnitude, so a creditnota does not print a minus sign
  // inside a sentence about a rule.
  return `${EXEMPT_REASON_NL} — over ${euro(Math.abs(total))} van dit bedrag is geen btw berekend.`;
}
