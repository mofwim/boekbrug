// src/lib/creditnota-lines.ts
// [CREDIT-SIGN] The mirror image of an invoice line, as a creditnota carries it. Pure.
// Run: npx tsx --test src/lib/creditnota-lines.test.ts
//
// A creditnota takes back a delivery that was invoiced. In this app it is stored NEGATIVE — the
// header, the lines and the aangifte all read that sign to know the money runs the other way — so
// building one is a per-line transformation of the invoice it corrects.
//
// It lived inline in /api/invoice/creditnota as an object literal inside a .map(). Everything it
// decides is a rule with a reason, and not one of them could be tested without a database:
//
//   · WHICH FIELDS FLIP. The quantity and the line total, and nothing else. The unit price stays
//     as it was, because it is a price: "-2 uur at EUR 75" is what happened, not "2 uur at
//     EUR -75". That is also the only form an e-factuur may carry (EN 16931 BR-27 — see
//     negative-line.ts), so the mirror and the export agree by construction.
//   · WHICH FIELDS TRAVEL. The unit, because a creditnota corrects the SAME delivery: "-2 uur",
//     never "-2 stuks". And the exemption flag, which is the expensive one — see below.
//   · WHICH FIELDS ARE HARDENED. vat_treatment is written from the literal 'exempt' or not at all.
//
// ── WHY THE EXEMPTION FLAG IS THE EXPENSIVE ONE ──
//
// Without it a copied exempt line is classified as TAXED turnover at 0%. On a creditnota that
// means the correction does not undo the original: the original stays +EUR 1.000 of exempt
// turnover and the creditnota lands as -EUR 1.000 in the 0%/verlegd rubriek. Two rubrieken wrong
// at once, in opposite directions, while 5a/5b still reconcile — so no screen shows it.
//
// ── AND WHY THE SPREADS ARE CONDITIONAL ──
//
// `unit` and `vat_treatment` are columns that not every installation has. Writing `unit: null` on
// a database without that column fails the whole INSERT with 42703, and the creditnota — whose
// number has already been consumed from the reeks — would be left without lines. So a column that
// is absent from the source row is absent from the copy, which is the behaviour of before the flag
// existed.

/** As much of an invoice line as the mirror reads. The DB row satisfies this. */
export interface OriginalLine {
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  btw_rate?: number | null
  line_total?: number | null
  unit?: string | null
  vat_treatment?: string | null
}

/** A line as it is inserted for the creditnota. */
export interface CreditLine {
  invoice_id: string
  description: string
  quantity: number
  unit_price: number | null
  btw_rate: number | null
  line_total: number
  unit?: string | null
  vat_treatment?: string | null
}

/**
 * The prefix on every credited description, so the correction names itself on the document the
 * customer reads. Dutch, because it is printed on the creditnota — see AGENTS.md.
 */
export const CREDIT_PREFIX = '[Creditnota] '

/**
 * The other side of an amount.
 *
 * `-(0)` is negative zero, and that is not a curiosity here: Intl formats it as "€ -0,00", so an
 * empty line on a creditnota would print a minus in front of nothing on the document the customer
 * keeps. JSON.stringify writes it as 0, so the database never saw it — only the paper would.
 */
const flip = (n: number | null | undefined): number => {
  const v = -(Number(n) || 0)
  return v === 0 ? 0 : v
}

/** One line of a creditnota, built from the invoice line it takes back. */
export function creditLineFor(
  line: OriginalLine,
  creditnotaId: string,
  reason?: string | null,
): CreditLine {
  const toelichting = typeof reason === 'string' && reason.trim() !== '' ? ` — ${reason}` : ''
  return {
    invoice_id: creditnotaId,
    description: `${CREDIT_PREFIX}${line.description ?? ''}${toelichting}`,
    // The sign lives in the quantity, and the price is left alone. flip() also absorbs a missing
    // amount: -(undefined) is NaN, and a NaN line total reaches the header, the PDF and the
    // aangifte without anything on the way refusing it.
    quantity: flip(line.quantity),
    unit_price: line.unit_price ?? null,
    btw_rate: line.btw_rate ?? null,
    line_total: flip(line.line_total),
    ...(line.unit !== undefined ? { unit: line.unit ?? null } : {}),
    // Only the literal value counts. An unknown value becomes NULL, never an exemption.
    ...(line.vat_treatment !== undefined
      ? { vat_treatment: line.vat_treatment === 'exempt' ? 'exempt' : null }
      : {}),
  }
}

/** Every line of a creditnota, in the order of the invoice it corrects. */
export function creditLinesFor(
  lines: readonly OriginalLine[],
  creditnotaId: string,
  reason?: string | null,
): CreditLine[] {
  return lines.map((l) => creditLineFor(l, creditnotaId, reason))
}
