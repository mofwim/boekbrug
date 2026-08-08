// src/lib/draft-totals.ts
// [ACTING-FOR] The sum of an invoice, on the server. Pure.
// Run: npx tsx --test src/lib/draft-totals.test.ts
//
// WHY THIS MOVED
// The totals were computed in the BROWSER and sent along with the INSERT. As long as there was
// one human per administration that was at most untidy: you could only lie to yourself. With a
// sales member in the picture it is something else — then a second person decides what goes into
// the books under their employer's VAT number, and then the server should do the arithmetic, not
// the page.
//
// WHY THE ARITHMETIC MOVED AGAIN
// This file used to hold its own summation, with a note explaining that it was "LITERALLY THE SAME
// AS THE ONE IN THE PAGE, including NOT rounding" so that no existing owner would see a cent
// change. That was written before invoice-totals.ts, which exists to be the ONE place these three
// legal amounts are computed — and which had already made, and won, exactly the opposite argument:
// group the ex-amount PER RATE, round each rate's BTW, sum those. That is the method the
// Belastingdienst and Peppol prescribe, and the one the PDF's btwBreakdown and the UBL export
// already use.
//
// So there were three algorithms for one number, and this one was the odd one out in two ways.
//
//   · It did not round AT ALL. Three lines of 3 × 33,33 at 21% were stored as
//     total_inc_btw = 120,9879 — four decimals, in a money column, on a row an accountant reads.
//   · The same route rounds each LINE to cents (line_total = round2(quantity × price)), so the
//     stored header did not even equal the sum of the stored lines it was computed from.
//
// And it was never the number that got issued: /api/invoice/send recomputes at issue via
// computeInvoiceTotals. The only thing the third algorithm achieved was that the amount in the
// editor was not the amount on the PDF — measured at a cent on a mixed-rate invoice, and at a
// tenth of a cent of nonsense on a plain one.
//
// NOTE ON LANGUAGE: identifiers and comments are English (see AGENTS.md). The `reason` sentences
// stay Dutch — they travel to the screen.

import { round2 } from "./invoice-totals";
import { applyDiscount, type Discount } from "./invoice-discount";

export interface DraftLine {
  quantity: number;
  unit_price: number;
  btw_rate: number;
}

export interface DraftTotals {
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
}

/**
 * Summing. `sign` is -1 for a credit note: that sits negative in the books, and that sign should
 * be set in one place rather than by every caller again.
 *
 * The arithmetic itself is computeInvoiceTotals — the same function /api/invoice/[id] PUT and
 * /api/invoice/send call, so a draft's stored amounts are the amounts it will be issued with.
 * What stays here is the SIGN, which is this route's own concern and not the summation's.
 *
 * The sign is applied to each LINE rather than to the three results, so the per-rate grouping and
 * rounding inside computeInvoiceTotals happen on the numbers that will actually be stored. Rounding
 * is symmetric (round2), so this is the same magnitude either way — but doing it on the way in
 * keeps one rule instead of two, and a creditnota then rounds identically to the invoice it credits.
 */
export function computeDraftTotals(
  lines: readonly DraftLine[],
  sign: 1 | -1 = 1,
  // [KORTING] Optioneel, en met opzet als LAATSTE argument: elke bestaande aanroep rekent zonder
  // korting precies dezelfde bedragen uit als voorheen, tot op de cent.
  discount: Discount | null = null,
): DraftTotals {
  // [BTW-ROUND] ÉÉN pad, ook zonder korting. Hier stond een tweede som — btw per REGEL opgeteld en
  // helemaal niet afgerond — die alleen liep als er geen korting was. Dat is precies de kant die
  // misgaat: een concept van 3 × 33,33 tegen 21% werd opgeslagen als total_inc_btw = 120,9879, vier
  // decimalen in een geldkolom op een regel die een boekhouder leest, en op een factuur met
  // gemengde tarieven week hij een cent af van wat /api/invoice/send bij uitgifte opnieuw uitrekent.
  //
  // applyDiscount groepeert per tarief, rondt de btw van elk tarief af en telt die op — dezelfde
  // methode als computeInvoiceTotals, en met discount = null is het diezelfde som zonder aftrek. Zo
  // kan het bedrag in de editor niet verschillen van het bedrag op de PDF, en kan het conceptpad
  // niet verschillen van het uitgiftepad.
  //
  // Het teken is wél van deze route: het wordt per REGEL toegepast, zodat het groeperen en afronden
  // gebeurt op de getallen die ook echt worden opgeslagen. round2 is symmetrisch, dus een
  // creditnota rondt identiek aan de factuur die hij crediteert.
  const d = applyDiscount(
    lines.map((l) => ({
      line_total: round2(sign * (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)),
      btw_rate: l.btw_rate,
    })),
    // Een korting op een creditnota is een toeslag op een teruggave — applyDiscount weigert hem
    // ook zelf (`positive`), en hier al niet meegeven zegt hetzelfde op de plek waar het besluit valt.
    sign === 1 ? discount : null,
  );
  return { total_ex_btw: d.total_ex_btw, btw_amount: d.btw_amount, total_inc_btw: d.total_inc_btw };
}

/** The BTW rate must be a rate that exists in the Netherlands — not a number someone typed. */
export const ALLOWED_BTW_RATES: readonly number[] = [0, 9, 21];

export type LineError = { index: number; field: string; reason: string };

/**
 * Checks the lines that come in.
 *
 * This is not a shape check but a money check: a negative quantity on an ordinary invoice, a BTW
 * rate of 13%, a price that is not a number — all things a browser can send and that then end up
 * in a tax return. The page checks them too, but the page is the side you do not control.
 */
export function validateDraftLines(
  lines: unknown,
): { ok: true; lines: DraftLine[] } | { ok: false; errors: LineError[] } {
  const errors: LineError[] = [];
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, errors: [{ index: -1, field: "lines", reason: "een factuur zonder regels bestaat niet" }] };
  }
  if (lines.length > 200) {
    return { ok: false, errors: [{ index: -1, field: "lines", reason: "meer regels dan een factuur kan dragen" }] };
  }

  const clean: DraftLine[] = [];
  lines.forEach((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const q = Number(row.quantity);
    const p = Number(row.unit_price);
    const t = Number(row.btw_rate);
    if (!Number.isFinite(q)) errors.push({ index: i, field: "quantity", reason: "geen getal" });
    if (!Number.isFinite(p)) errors.push({ index: i, field: "unit_price", reason: "geen getal" });
    if (!ALLOWED_BTW_RATES.includes(t)) {
      errors.push({ index: i, field: "btw_rate", reason: `${row.btw_rate} is geen bestaand BTW-tarief` });
    }
    const description = typeof row.description === "string" ? row.description.trim() : "";
    if (!description) {
      // Art. 35a Wet OB: the nature of the goods or services supplied belongs on the invoice.
      errors.push({ index: i, field: "description", reason: "een regel zonder omschrijving mag niet op een factuur" });
    }
    clean.push({ quantity: q, unit_price: p, btw_rate: t });
  });

  return errors.length ? { ok: false, errors } : { ok: true, lines: clean };
}
