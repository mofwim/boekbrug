// src/lib/invoice-line-copy.ts
// [REGEL-KOPIE] The content of an invoice line, ready to be written onto another invoice. Pure.
// Run: npx tsx --test src/lib/invoice-line-copy.test.ts
//
// Three routes copy invoice lines: the creditnota mirrors them, /duplicate repeats them, and the
// recurring cron re-issues them every month. Each typed the columns over by hand, and each time a
// column was ADDED to invoice_lines it had to be added in three places by someone who knew all
// three existed.
//
// It has now gone wrong three times in a row, and the third one is why this file exists:
//
//   `unit`            — added, then had to be chased into every copier so "-2 uur" would not
//                       become "-2 stuks" on the correction.
//   `vat_treatment`   — same, with a more expensive miss: a copied exempt line books as taxed 0%
//                       turnover and lands in a different aangifte rubriek than the original.
//   `discount_type` / `discount_value` — added by [REGEL-KORTING] to the creditnota mirror and to
//                       both write routes, and NOT to /duplicate or to the recurring cron.
//
// That third one is not cosmetic. The copiers write `line_total`, which is already discounted, so
// the copy LOOKS right — until it is opened and saved, when computeDraftTotals recomputes the line
// from quantity × unit_price with no discount to apply. Measured on a € 100 line at 10% off:
//
//     original                 € 90,00 + € 18,90 btw = € 108,90
//     duplicate/recurring      € 100,00 + € 21,00 btw = € 121,00   after one save
//
// € 12,10 more than was agreed, on a recurring invoice that goes out every month without anyone
// reading it. And before that save the copy does not even add up with itself: quantity × unit_price
// is € 100 beside a line_total of € 90, which is the shape PEPPOL-EN16931-R120 recomputes and
// refuses.
//
// ── WHY THE OPTIONAL COLUMNS ARE SPREAD CONDITIONALLY ──
//
// `unit`, `vat_treatment` and the discount pair exist only after their migrations. A database
// without one returns rows WITHOUT that key, and sending it anyway fails the whole INSERT with
// 42703 — on the creditnota path that means a correction whose number is already consumed and
// which has no lines. So a column that is absent from the source row is absent from the copy, and
// the copy is then exactly what it would have been before that column existed.

/** As much of a line as a copy needs. The DB row and every writer's shape satisfy this. */
export interface CopyableLine {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  btw_rate?: number | null;
  line_total?: number | null;
  unit?: string | null;
  vat_treatment?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
}

/**
 * The columns that only exist after a migration, each present only when the source row had it.
 *
 * Shared with the creditnota mirror, which needs exactly these and its own sign rules for the rest
 * — so the two can never again disagree about which columns a line HAS.
 */
export function optionalLineFields(line: CopyableLine): Record<string, unknown> {
  return {
    // [UNIT] A copy is the same delivery, so it carries the same unit.
    ...(line.unit !== undefined ? { unit: line.unit ?? null } : {}),
    // [VRIJGESTELD-KOPIE] Only the literal value counts. An unknown value becomes NULL, never an
    // exemption — the same hardening every writer of this column applies.
    ...(line.vat_treatment !== undefined
      ? { vat_treatment: line.vat_treatment === "exempt" ? "exempt" : null }
      : {}),
    // [REGEL-KORTING] The agreed discount travels with the line it was agreed on. A value without
    // a type is not a discount, so it is dropped rather than carried as a number nothing reads.
    ...(line.discount_type !== undefined
      ? {
          discount_type: line.discount_type ?? null,
          discount_value: line.discount_type ? (line.discount_value ?? null) : null,
        }
      : {}),
  };
}

/**
 * One invoice line, copied verbatim onto `invoiceId`.
 *
 * Verbatim means the amounts too: a duplicate and a recurring issue bill exactly what the original
 * billed. The creditnota is the one copier that does NOT use this — it flips signs and prefixes
 * descriptions — and it shares optionalLineFields above, which is where the drift happened.
 *
 * The line's own `id` is deliberately absent: what is copied is the CONTENT of a line, never its
 * identity. A spread of the source row would carry a primary key that already exists.
 */
export function copiedLineFor(line: CopyableLine, invoiceId: string): Record<string, unknown> {
  return {
    invoice_id: invoiceId,
    description: line.description ?? null,
    quantity: line.quantity ?? null,
    unit_price: line.unit_price ?? null,
    btw_rate: line.btw_rate ?? null,
    line_total: line.line_total ?? null,
    ...optionalLineFields(line),
  };
}

/** Every line of an invoice, copied onto another one, in order. */
export function copiedLinesFor(
  lines: readonly CopyableLine[],
  invoiceId: string,
): Record<string, unknown>[] {
  return lines.map((l) => copiedLineFor(l, invoiceId));
}
