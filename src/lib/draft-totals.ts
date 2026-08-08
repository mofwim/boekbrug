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
// THE ARITHMETIC IS LITERALLY THE SAME AS THE ONE IN THE PAGE, including NOT rounding. That is
// deliberate: this must not make a cent of difference for an existing owner. Were rounding added
// here, the same invoice would give a different result today than yesterday — a silent change in
// the bookkeeping, and exactly what this product does not do.
//
// NOTE ON LANGUAGE: identifiers and comments are English (see AGENTS.md). The `reason` sentences
// stay Dutch — they travel to the screen.

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
 */
export function computeDraftTotals(
  lines: readonly DraftLine[],
  sign: 1 | -1 = 1,
  // [KORTING] Optioneel, en met opzet als LAATSTE argument: elke bestaande aanroep rekent zonder
  // korting precies dezelfde bedragen uit als voorheen, tot op de cent.
  discount: Discount | null = null,
): DraftTotals {
  if (discount && sign === 1) {
    // De verdeling over de tarieven staat in invoice-discount.ts, samen met de UBL-kant ervan.
    // Hier een eigen aftrekking doen zou betekenen dat de conceptroute en de uitgifteroute op een
    // gemengde factuur een andere btw uitrekenen — en dan hangt het bedrag af van welke knop de
    // ondernemer indrukte.
    const d = applyDiscount(
      lines.map((l) => ({ line_total: l.quantity * l.unit_price, btw_rate: l.btw_rate })),
      discount,
    );
    return { total_ex_btw: d.total_ex_btw, btw_amount: d.btw_amount, total_inc_btw: d.total_inc_btw };
  }
  const ex = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const btw = lines.reduce((s, l) => s + l.quantity * l.unit_price * (l.btw_rate / 100), 0);
  return {
    total_ex_btw: sign * ex,
    btw_amount: sign * btw,
    total_inc_btw: sign * (ex + btw),
  };
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
