// src/lib/tax-letter.ts
// [AANSLAG] A letter from the Belastingdienst is never a cost. Pure, no I/O.
// Run: npx tsx --test src/lib/tax-letter.test.ts
//
// A voorlopige aanslag inkomstenbelasting, a Zvw-aanslag, a btw-naheffing or a motorrijtuigen-
// belasting letter has every mark the reader is told to look for in an invoice: a sender, an
// amount, an IBAN, a betaalkenmerk and a due date. Read as one and confirmed, it lands in
// `kosten`, and the year's result is wrong by the owner's own income tax.
//
//   · inkomstenbelasting / zorgverzekeringswet  → PRIVATE. A zzp'er's income tax is not a cost of
//     the business; paid from the business account it is a privé-opname.
//   · omzetbelasting                            → SETTLEMENT of tax already declared. Never a
//     cost, never voorbelasting.
//   · motorrijtuigenbelasting                   → a COST, when the car is the business's.
//   · anything else from the tax office         → UNKNOWN. Withheld from kosten and NAMED —
//     the safe side is to claim less, not more.
//
// The payable itself stays a payable: the due date reaches the pay screen and the forecast,
// the bank match settles it, the reminder ladder leaves it alone like any paid row. Only its
// place in the result and in the auditfile changes.

export const TAX_KINDS = [
  "inkomstenbelasting",
  "zorgverzekeringswet",
  "omzetbelasting",
  "motorrijtuigenbelasting",
  "overig",
] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export function isTaxKind(v: unknown): v is TaxKind {
  return typeof v === "string" && (TAX_KINDS as readonly string[]).includes(v);
}

/** Where a tax letter books. */
export type TaxLetterBooking = "prive" | "settlement" | "kosten" | "unknown";

export function taxLetterBooking(kind: TaxKind): TaxLetterBooking {
  switch (kind) {
    case "inkomstenbelasting":
    case "zorgverzekeringswet":
      return "prive";
    case "omzetbelasting":
      return "settlement";
    case "motorrijtuigenbelasting":
      return "kosten";
    default:
      return "unknown";
  }
}

/**
 * Is this sender the tax office? Name-based, on the SUPPLIER NAME KEY or the raw name, so the
 * rule also reaches rows written by a path that never asked the reader for a kind (an e-mail
 * import, a row from before the column existed). The bank side uses the same word
 * (bank-identity.ts TAX_RE); "belasting dienst" with a space is a real OCR outcome.
 */
export function isTaxOfficeName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\bbelasting\s?dienst\b/i.test(name);
}

/**
 * The kind that governs a row: the stored kind when there is one, else "overig" when the sender
 * is the tax office, else null (an ordinary invoice). A stored kind on a non-tax-office sender is
 * still honoured — the owner or the reader said so, and a name is the weaker signal.
 */
export function effectiveTaxKind(row: { tax_kind?: string | null; client_name?: string | null }): TaxKind | null {
  if (isTaxKind(row.tax_kind)) return row.tax_kind;
  return isTaxOfficeName(row.client_name) ? "overig" : null;
}

/** True when the row must be kept OUT of kosten (and out of voorbelasting). */
export function taxLetterWithheldFromCosts(row: { tax_kind?: string | null; client_name?: string | null }): boolean {
  const kind = effectiveTaxKind(row);
  return kind !== null && taxLetterBooking(kind) !== "kosten";
}
