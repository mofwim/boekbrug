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
// [REGEL-AFRONDING] WHY THIS ROUNDS PER LINE, AND WHY IT USED NOT TO
//
// This header used to say the opposite: "the arithmetic is LITERALLY the same as the one in the
// page, including NOT rounding — this must not make a cent of difference for an existing owner."
// The promise was about the MOVE from browser to server, and for that move it was right. What it
// preserved, though, was a divergence that was already there, and the promise is what kept it
// alive: the header summed the raw products while invoice_lines.line_total was written
// round2(quantity x unit_price) three hundred lines away in the same route.
//
// Measured, on a real quote (Kiwi Food Market, four lines at 9%, prices typed INCLUSIVE of btw):
//
//     printed line column   123,85 + 174,31 + 61,01 + 3,21  =  362,38
//     stored header                                            362,39
//     stated btw            32,61, while 9% of 362,39 is       32,62
//     concept said                                             395,00
//     the same invoice re-saved via the edit screen, or issued: 394,99
//
// Three separate contradictions out of one cause. The customer adds up the column and gets a
// different number than the total; an accountant recomputing the btw from the stated base gets a
// different number again; and the amount the owner sees in the concept is not the amount that
// goes out — the precise failure the header of invoice-totals.ts says it fixed, still open on the
// other axis. In the UBL export it is fatal rather than confusing: Peppol BIS 3.0 BR-CO-10
// requires LegalMonetaryTotal/LineExtensionAmount to equal the sum of the line amounts, so the
// file is refused at the receiving access point and the invoice never arrives.
//
// It is not an inclusive-price problem. 1,5 uur x EUR 33,33 = 49,995 rounds to 50,00 in the
// column; two such lines print 100,00 and used to total 99,99.
//
// So the rounding moves here, ONE step earlier than it was, onto exactly the number that lands in
// invoice_lines.line_total. The header is then the sum of its own lines by construction, and the
// create route, the edit route, issuance, the PDF and the UBL export cannot drift apart again —
// they all read the same rounded amounts.
//
// The cent this costs is real and belongs to whoever types prices INCLUSIVE of btw: "EUR 0,90
// all-in" x 150 at 9% cannot produce a document that both adds up and totals exactly EUR 395,00,
// because no two-decimal ex-amount X satisfies X + round2(0,09X) = 395,00 (362,38 gives 394,99,
// 362,39 gives 395,01). That cent is arithmetic, not a defect. What WAS the defect is that it
// stayed hidden until issuance; now the concept shows the same 394,99 the customer will get.
//
// NOTE ON LANGUAGE: identifiers and comments are English (see AGENTS.md). The `reason` sentences
// stay Dutch — they travel to the screen.

import { computeInvoiceTotals, round2 } from "./invoice-totals";
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
  // [REGEL-AFRONDING] The line amounts as they will be STORED — the same expression as the insert
  // in /api/invoice/draft, sign and all. Everything below sums these and nothing else, so the
  // header can never claim a different subtotal than the column the customer reads. See the block
  // at the top of this file for what the raw-product version produced.
  const stored = lines.map((l) => ({
    line_total: round2(sign * l.quantity * l.unit_price),
    btw_rate: l.btw_rate,
  }));

  if (discount && sign === 1) {
    // De verdeling over de tarieven staat in invoice-discount.ts, samen met de UBL-kant ervan.
    // Hier een eigen aftrekking doen zou betekenen dat de conceptroute en de uitgifteroute op een
    // gemengde factuur een andere btw uitrekenen — en dan hangt het bedrag af van welke knop de
    // ondernemer indrukte.
    const d = applyDiscount(stored, discount);
    return { total_ex_btw: d.total_ex_btw, btw_amount: d.btw_amount, total_inc_btw: d.total_inc_btw };
  }
  // Per tarief, precies zoals de uitgifteroute en de PDF het doen — één functie, geen tweede
  // methode die op een gemengde factuur een cent afwijkt.
  return computeInvoiceTotals(stored);
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
