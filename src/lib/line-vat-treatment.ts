// src/lib/line-vat-treatment.ts
// [REGEL-BEHANDELING] The btw treatment stored on a sales line, hardened in ONE place. Pure.
// Run: npx tsx --test src/lib/line-vat-treatment.test.ts
//
// invoice_lines.vat_treatment carries a legal fact beside the rate:
//
//   'exempt'          art. 11 Wet OB — no btw, and the turnover reaches NO aangifte rubriek;
//   'reverse_charge'  the verleggingsregeling (art. 12 lid 5 Wet OB jo. art. 24b Uitvoeringsbesluit)
//                     — no btw, the CUSTOMER accounts for it, the turnover is rubriek 1e "niet bij
//                     u belast"; see reverse-charge-invoice.ts for what the document must carry;
//   NULL              the ordinary taxed line, including a real 0% rate.
//
// Every writer used to harden this inline as `=== 'exempt' ? 'exempt' : null` — four copies, and
// each was a place where a second value would have had to be added by hand, by somebody who knew
// all four existed. Only the literals count: an unknown value becomes NULL, never an exemption and
// never a shift of the btw onto somebody else.

export type StoredVatTreatment = "exempt" | "reverse_charge";

/** The stored value for whatever a screen, a copy or an old client sent: a literal, or nothing. */
export function storedVatTreatment(raw: unknown): StoredVatTreatment | null {
  return raw === "exempt" || raw === "reverse_charge" ? raw : null;
}

/** Just enough of a line to read its treatment. The editor's shape and the stored row both fit. */
export interface TreatedLine {
  vat_treatment?: string | null;
  btw_rate?: number | null;
}

export function isReverseChargeLine(l: TreatedLine | null | undefined): boolean {
  return l?.vat_treatment === "reverse_charge";
}

export function hasReverseChargeLine(
  lines: readonly (TreatedLine | null | undefined)[] | null | undefined,
): boolean {
  return (lines ?? []).some(isReverseChargeLine);
}
