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

import { computeInvoiceTotals } from "./invoice-totals";
import { applyDiscount, lineNetEx, parseDiscount, type Discount } from "./invoice-discount";
// [MIN-REGEL] When a set of lines stops describing a factuur — one definition, shared with the
// screen that refuses it before the request is sent. See negative-line.ts.
import { staysAFactuur, NOT_A_FACTUUR_REASON } from "./negative-line";

export interface DraftLine {
  quantity: number;
  unit_price: number;
  btw_rate: number;
  // [REGEL-KORTING] The line's own discount, as the owner agreed it. Optional: a line without one
  // computes to exactly the amount it computed before this field existed.
  discount_type?: string | null;
  discount_value?: number | string | null;
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
  // [REGEL-KORTING] And the line's own discount comes off HERE, before anything is summed, because
  // this is the amount the route stores in invoice_lines.line_total. The document discount below
  // then works on the reduced amounts — the order EN 16931 prescribes (a line allowance lowers
  // BT-131; the document allowance works on the sum of those lowered line amounts).
  const stored = lines.map((l) => ({
    line_total: lineNetEx({ quantity: sign * l.quantity, unit_price: l.unit_price,
      discount_type: l.discount_type, discount_value: l.discount_value }),
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
 * This is not a shape check but a money check: a document that gives money back while calling
 * itself a factuur, a BTW rate of 13%, a price that is not a number — all things a browser can
 * send and that then end up in a tax return. The page checks them too, but the page is the side
 * you do not control.
 *
 * [MIN-REGEL] This doc comment used to say it refused "a negative quantity on an ordinary
 * invoice". It never did — nothing here has ever looked at a sign — and now it must not: a
 * wholesaler settles a return as a negative line on the next invoice, and that is an ordinary
 * factuur (see negative-line.ts). What DOES have to be refused is the document that has gone past
 * that point, and `documentKind` is how this function is told which one it is looking at.
 *
 * @param documentKind The invoice_type this line set belongs to. A creditnota is exempt: its lines
 *   are stored negative by design ([CREDIT-SIGN]), so the sum being below zero is what makes it
 *   correct. Everything else — including an omitted value — is judged as a factuur, so a caller
 *   that forgets gets the check rather than skips it.
 */
export function validateDraftLines(
  lines: unknown,
  documentKind?: string | null,
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

    // [REGEL-KORTING] A discount that cannot be read is REFUSED, not dropped.
    //
    // parseDiscount answers null for "no discount" and for "121%" alike, and the difference
    // matters here: dropping the second one silently sends the customer an invoice at the full
    // price while the owner believes they gave a discount. A typed number that the app will not
    // honour has to come back as a question, not as a quietly higher amount.
    //
    // An EMPTY field is not a typo — clearing a discount is a normal edit — so both fields blank
    // is simply no discount, exactly as before this feature.
    const filled = (v: unknown) => v != null && String(v).trim() !== "";
    const wantsDiscount = filled(row.discount_type) || filled(row.discount_value);
    const discount = parseDiscount(row.discount_type, row.discount_value);
    if (wantsDiscount && !discount) {
      errors.push({
        index: i,
        field: "discount_value",
        reason: "een korting is een percentage tot 100 of een bedrag boven nul",
      });
    }

    clean.push({
      quantity: q,
      unit_price: p,
      btw_rate: t,
      // The PARSED value, never the raw input: what was checked is what gets stored, so the
      // database never sees a string the CHECK constraint would have to catch.
      discount_type: discount?.type ?? null,
      discount_value: discount?.value ?? null,
    });
  });

  // [MIN-REGEL] A factuur that gives more money back than it asks for is a creditnota, and issuing
  // it as a factuur is wrong in three places at once: the number comes out of the doorlopende reeks
  // (Art. 35 Wet OB) for a document that credits, the BTW is declared as omzet instead of on the
  // other side of the aangifte, and the customer books a negative purchase invoice their own
  // software may refuse. The screen refuses it first; this is the door, and the door is the side
  // that is not the browser.
  //
  // Only when nothing else is wrong, so the owner gets ONE answer. A line that is not a number
  // counts as zero in the sum (lineNetEx is defensive), so it cannot invent this refusal on its
  // own — but next to a genuine credit line it would add "this is a creditnota" underneath "regel
  // 1 is geen getal", which is advice about a document that has not been read yet.
  if (errors.length === 0 && documentKind !== "creditnota" && !staysAFactuur(clean)) {
    errors.push({ index: -1, field: "lines", reason: NOT_A_FACTUUR_REASON });
  }

  return errors.length ? { ok: false, errors } : { ok: true, lines: clean };
}
