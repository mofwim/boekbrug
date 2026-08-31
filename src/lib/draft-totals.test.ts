// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/draft-totals.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDraftTotals, validateDraftLines, ALLOWED_BTW_RATES } from "./draft-totals";
import { computeInvoiceTotals, round2 } from "./invoice-totals";

const r = (quantity: number, unit_price: number, btw_rate: number, description = "werk") =>
  ({ quantity, unit_price, btw_rate, description });

test("the arithmetic is the same as the one in the browser on amounts that land on a cent", () => {
  // The assignment of this file was to move the computation to the server without changing a cent
  // for an existing owner. On amounts that already sit on whole cents — which is nearly every
  // invoice — that still holds exactly.
  const lines = [r(2, 100, 21), r(1, 50, 9)];
  assert.deepEqual(computeDraftTotals(lines), {
    total_ex_btw: 250,
    btw_amount: 46.5, // 200 @ 21% = 42,00 · 50 @ 9% = 4,50 — per rate, each rounded
    total_inc_btw: 296.5,
  });
  // Not merely equal by coincidence: the draft must produce EXACTLY what the same lines produce
  // through the shared function, because /api/invoice/send recomputes with it at issue.
  assert.deepEqual(
    computeDraftTotals(lines),
    computeInvoiceTotals([
      { line_total: 200, btw_rate: 21 },
      { line_total: 50, btw_rate: 9 },
    ]),
  );
});

// ── [REGEL-AFRONDING] the header may never disagree with its own lines ────────────────────────

test("the header equals the sum of the line amounts as they are STORED", () => {
  // This replaces a test that asserted the opposite ("there is NO rounding"), and that test was
  // wrong in the way that matters: it locked in a header computed from raw products while
  // invoice_lines.line_total was written round2(quantity × unit_price). The two then differed by a
  // cent on any invoice with sub-cent line residue.
  //
  // 1,5 uur × € 33,33 = 49,995 → the column prints 50,00 twice. A customer adding up the column
  // gets 100,00, and the invoice used to answer 99,99.
  const t = computeDraftTotals([r(1.5, 33.33, 21), r(1.5, 33.33, 21)]);
  assert.equal(t.total_ex_btw, 100, "the two printed 50,00 lines must total 100,00");
  assert.equal(t.btw_amount, 21);
  assert.equal(t.total_inc_btw, 121);
});

test("the concept shows the amount that is actually issued — Kiwi Food Market", () => {
  // The measured case, from a real quote: four lines at 9%, prices typed INCLUSIVE of btw
  // (€ 0,90 / € 1,90 / € 1,75 / € 1,75 all-in), so every stored ex-price is a long fraction.
  //
  // Before: the concept said € 395,00 and the printed column said 362,38 against a stated
  // subtotal of 362,39 — and issuing the very same invoice produced € 394,99, because the send
  // route recomputes from the stored, rounded lines. The owner promised a number the document
  // could not produce.
  const ex = (incl: number) => incl / 1.09;
  const t = computeDraftTotals([
    r(150, ex(0.9), 9),
    r(100, ex(1.9), 9),
    r(38, ex(1.75), 9),
    r(2, ex(1.75), 9),
  ]);
  assert.equal(t.total_ex_btw, 362.38, "the sum of 123,85 + 174,31 + 61,01 + 3,21");
  assert.equal(t.btw_amount, 32.61, "9% over the base the document itself states");
  assert.equal(t.total_inc_btw, 394.99, "what issuance produces — so the concept must say it too");
});

test("the stated btw is derivable from the stated base, which is what an accountant recomputes", () => {
  // BR-S-09 / BR-CO-17: the tax amount of a category is its taxable amount × the rate. A header
  // built from unrounded lines failed this — it stated 362,39 and 32,61, and 9% of 362,39 is
  // 32,62. Whoever checks the invoice arrives at a different number than the invoice.
  const t = computeDraftTotals([r(150, 0.9 / 1.09, 9), r(100, 1.9 / 1.09, 9)]);
  const recomputed = Math.round(t.total_ex_btw * 9) / 100;
  assert.equal(t.btw_amount, recomputed, "btw must be the rate applied to the base on the page");
});

test("a creditnota rounds the same way, mirrored", () => {
  // The credit note copies the invoice it reverses. Rounding one direction differently from the
  // other is how a refund ends up a cent away from the charge — measured before, at € 121.
  const plus = computeDraftTotals([r(1.5, 33.33, 21), r(1.5, 33.33, 21)], 1);
  const minus = computeDraftTotals([r(1.5, 33.33, 21), r(1.5, 33.33, 21)], -1);
  assert.equal(minus.total_ex_btw, -plus.total_ex_btw);
  assert.equal(minus.btw_amount, -plus.btw_amount);
  assert.equal(minus.total_inc_btw, -plus.total_inc_btw);
});

test("a credit note sits negative in the books, and the sign is set in one place", () => {
  const t = computeDraftTotals([r(1, 100, 21)], -1);
  assert.equal(t.total_ex_btw, -100);
  assert.equal(t.btw_amount, -21);
  assert.equal(t.total_inc_btw, -121);
});

test("0% is a real rate and counts normally", () => {
  const t = computeDraftTotals([r(1, 100, 0)]);
  assert.equal(t.btw_amount, 0);
  assert.equal(t.total_inc_btw, 100);
});

test("an empty list is zero, not NaN", () => {
  assert.deepEqual(computeDraftTotals([]), { total_ex_btw: 0, btw_amount: 0, total_inc_btw: 0 });
});

// ── the validation ────────────────────────────────────────────────────────────────────────────

test("a BTW rate that does not exist never reaches the server", () => {
  // The page only offers 0/9/21. But the page is the side you do not control, and an invented
  // rate ends up in a tax return afterwards.
  assert.deepEqual(ALLOWED_BTW_RATES, [0, 9, 21]);
  for (const wrong of [13, 6, 19, 21.5, -21, NaN]) {
    const out = validateDraftLines([r(1, 100, wrong)]);
    assert.equal(out.ok, false, `${wrong}% should be refused`);
  }
  assert.equal(validateDraftLines([r(1, 100, 9)]).ok, true);
});

test("a line without a description must not go on an invoice", () => {
  // Art. 35a Wet OB: the nature of the goods or services supplied belongs on it.
  const out = validateDraftLines([{ quantity: 1, unit_price: 100, btw_rate: 21, description: "   " }]);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.errors[0].field, "description");
});

test("an invoice without lines does not exist", () => {
  assert.equal(validateDraftLines([]).ok, false);
  assert.equal(validateDraftLines(null).ok, false);
  assert.equal(validateDraftLines("regels").ok, false);
});

test("amounts that are not numbers are refused, not silently turned into 0", () => {
  // Without this check "honderd euro" becomes NaN, and NaN in a total makes the whole invoice
  // unusable without any error appearing anywhere.
  const out = validateDraftLines([{ quantity: 1, unit_price: "honderd", btw_rate: 21, description: "x" }]);
  assert.equal(out.ok, false);
  if (!out.ok) assert.ok(out.errors.some((f) => f.field === "unit_price"));
});

test("all errors come back at once, not one at a time", () => {
  const out = validateDraftLines([r(1, 100, 13, ""), r(1, 100, 21)]);
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.ok(out.errors.length >= 2, "rate AND description in one answer");
    assert.ok(out.errors.every((f) => f.index === 0), "and with the line it went wrong on");
  }
});

test("an absurdly long invoice is refused before it touches the database", () => {
  const many = Array.from({ length: 201 }, () => r(1, 1, 21));
  assert.equal(validateDraftLines(many).ok, false);
  assert.equal(validateDraftLines(many.slice(0, 200)).ok, true);
});

// ─── [MIN-REGEL] A credit line at the door ──────────────────────────────────────────────────────
//
// The wholesaler invoice this comes from: ATAPACK 26304787, one line of −3 × € 23,95 for a return,
// netted against nine ordinary ones. The screen allows it; this is the side the screen cannot
// speak for.

test("[MIN-REGEL] a credit line inside an ordinary invoice passes the door", () => {
  const out = validateDraftLines([r(-3, 23.95, 21, "Credit over faktuur 26302362"), r(9, 20, 21)]);
  assert.equal(out.ok, true, "a return settled on the next invoice is an ordinary factuur");
});

test("[MIN-REGEL] a factuur that gives money back is refused, by name", () => {
  const out = validateDraftLines([r(-3, 23.95, 21, "Retour"), r(1, 20, 21)]);
  assert.equal(out.ok, false, "−71,85 + 20,00 is a document that pays the customer");
  if (!out.ok) {
    assert.equal(out.errors[0].field, "lines", "it is about the document, not about one row");
    assert.equal(out.errors[0].index, -1);
    assert.match(out.errors[0].reason, /creditnota/, "the answer must name what to make instead");
    assert.doesNotMatch(out.errors[0].reason, /\.$/, "the routes add the full stop themselves");
  }
});

test("[MIN-REGEL] a creditnota is exempt — its lines are negative by design", () => {
  // [CREDIT-SIGN]. The edit route sends a creditnota's lines back already signed, so without the
  // exemption every edit of one would be refused with a sentence telling the owner to make the
  // document they are already looking at.
  const credit = [r(-3, 23.95, 21, "Retour"), r(-1, 20, 21, "Retour")];
  assert.equal(validateDraftLines(credit, "creditnota").ok, true);
  assert.equal(validateDraftLines(credit, "factuur").ok, false);
  assert.equal(validateDraftLines(credit).ok, false, "a caller that says nothing gets the check");
  // An offerte or a pro forma is judged as a factuur: it becomes one.
  assert.equal(validateDraftLines(credit, "pro_forma").ok, false);
  assert.equal(validateDraftLines(credit, "offerte").ok, false);
});

test("[MIN-REGEL] exactly zero still passes, and a cent below it does not", () => {
  assert.equal(validateDraftLines([r(-1, 71.85, 21, "Retour"), r(3, 23.95, 21)]).ok, true, "nothing flows back");
  assert.equal(validateDraftLines([r(-1, 71.86, 21, "Retour"), r(3, 23.95, 21)]).ok, false, "one cent does");
});

test("[MIN-REGEL] a line that is not a number gets its own answer, not this one", () => {
  // A quantity of "twee" counts as zero in the sum, so it cannot invent this refusal by itself.
  // Beside a real credit line it can: the total then IS below zero, and the owner would be told to
  // make a creditnota of an invoice whose first line has not been read yet. One problem at a time.
  const out = validateDraftLines([
    { quantity: "twee", unit_price: 100, btw_rate: 21, description: "Werk" },
    r(-1, 50, 21, "Retour"),
  ]);
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.errors.length, 1, `one problem, one answer: ${JSON.stringify(out.errors)}`);
    assert.equal(out.errors[0].field, "quantity");
    assert.equal(out.errors[0].index, 0, "…and it points at the line the owner has to fix");
  }
});

// ─── [REGEL-KORTING] The discount that belongs to one line ────────────────────

test("[REGEL-KORTING] a line discount lowers the total, and the BTW with it", () => {
  const totals = computeDraftTotals(
    [{ quantity: 10, unit_price: 12.5, btw_rate: 21, discount_type: "percent", discount_value: 20 }],
    1,
  );
  assert.equal(totals.total_ex_btw, 100, "125 minus 20%");
  assert.equal(totals.btw_amount, 21, "BTW is owed over the reduced amount, not the list price");
  assert.equal(totals.total_inc_btw, 121);
});

test("[REGEL-KORTING] the two discounts stack, line first and document second", () => {
  // The other order is a different, wrong, number: 10% of 225 is 22,50, not the 20 that is right.
  const totals = computeDraftTotals(
    [
      { quantity: 10, unit_price: 12.5, btw_rate: 21, discount_type: "percent", discount_value: 20 },
      { quantity: 1, unit_price: 100, btw_rate: 21 },
    ],
    1,
    { type: "percent", value: 10 },
  );
  assert.equal(totals.total_ex_btw, 180);
  assert.equal(totals.btw_amount, 37.8);
});

test("[REGEL-KORTING] a creditnota mirrors the line discount exactly", () => {
  // [CREDIT-SIGN] The credit note must reproduce the invoice it reverses to the cent — a residue
  // left behind here is turnover that never gets taken back out of the aangifte.
  const line = { quantity: 4, unit_price: 25, btw_rate: 21, discount_type: "percent", discount_value: 10 };
  const factuur = computeDraftTotals([line], 1);
  const credit = computeDraftTotals([line], -1);
  assert.equal(factuur.total_ex_btw, 90);
  assert.equal(credit.total_ex_btw, -90);
  assert.equal(credit.total_inc_btw, round2(-factuur.total_inc_btw));
});

test("[REGEL-KORTING] a discount the app will not honour is refused, not dropped", () => {
  // Dropping it silently issues the invoice at the FULL price while the owner believes they gave
  // a discount — a money surprise on a numbered document.
  for (const bad of [{ discount_type: "percent", discount_value: 150 },
                     { discount_type: "korting", discount_value: 10 },
                     { discount_type: "amount", discount_value: -5 }]) {
    const out = validateDraftLines([{ ...r(1, 100, 21), ...bad }]);
    assert.equal(out.ok, false, `${JSON.stringify(bad)} must be refused`);
    if (!out.ok) assert.equal(out.errors[0].field, "discount_value");
  }
});

test("[REGEL-KORTING] no discount, and a cleared discount, both pass and store nothing", () => {
  for (const none of [{}, { discount_type: "", discount_value: "" },
                      { discount_type: null, discount_value: null }]) {
    const out = validateDraftLines([{ ...r(1, 100, 21), ...none }]);
    assert.equal(out.ok, true, `${JSON.stringify(none)} is simply no discount`);
    if (out.ok) {
      assert.equal(out.lines[0].discount_type, null);
      assert.equal(out.lines[0].discount_value, null);
    }
  }
});

test("[REGEL-KORTING] the validated line carries the PARSED discount, not the raw input", () => {
  // What was checked is what gets stored: the database never sees a string its CHECK would catch.
  const out = validateDraftLines([{ ...r(1, 100, 21), discount_type: "amount", discount_value: "12,50" }]);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.lines[0].discount_type, "amount");
    assert.equal(out.lines[0].discount_value, 12.5, "the Dutch comma is read as a decimal point");
  }
});

test("[REGEL-KORTING] a line discounted to nothing does not turn the invoice into a creditnota", () => {
  // 100% off is a free line, not money flowing back. Exactly zero stays a factuur (negative-line.ts).
  const out = validateDraftLines([{ ...r(1, 100, 21), discount_type: "percent", discount_value: 100 }]);
  assert.equal(out.ok, true);
  assert.equal(computeDraftTotals(out.ok ? out.lines : [], 1).total_inc_btw, 0);
});

test("[REGEL-KORTING] discounts are judged on the NET amount when deciding factuur vs creditnota", () => {
  // A EUR 100 line at 100% off next to a EUR 20 credit line gives money back — it is a creditnota,
  // and judging the gross would have called it a factuur and issued it from the wrong series.
  const out = validateDraftLines([
    { ...r(1, 100, 21), discount_type: "percent", discount_value: 100 },
    r(-1, 20, 21, "retour"),
  ]);
  assert.equal(out.ok, false, "the credits are worth more than what is delivered");
});

test("[TARIEF-STRIKT] a line with no btw_rate is refused, not stored as 0%", () => {
  // The invoice door tested `ALLOWED_BTW_RATES.includes(Number(row.btw_rate))`. Number(null),
  // Number(""), Number(" "), Number([]) and Number(false) are all 0 — and 0 IS a legal rate — so a
  // line carrying no rate at all was accepted and written as a 0% line.
  //
  // What that costs, on one 10 x EUR 100 line: the header is stored 1000 / 0 / 1000 where 21%
  // gives 1000 / 210 / 1210. EUR 210 of verschuldigde BTW off a sales invoice — and ex + btw = inc
  // balances perfectly at 0%, so no arithmetic check anywhere can notice. The customer's copy and
  // the e-factuur both state EUR 0 BTW, so their bookkeeping deducts nothing either.
  const line = (btw_rate: unknown) =>
    [{ description: "Advieswerk", quantity: 10, unit_price: 100, btw_rate }] as never;

  for (const missing of [null, "", " ", [], false, undefined]) {
    const out = validateDraftLines(line(missing), "factuur");
    assert.equal(out.ok, false, `${JSON.stringify(missing) ?? "undefined"} is not a rate and may not be accepted`);
  }
  // An unknown NUMBER was always refused and still is — that half was never broken.
  assert.equal(validateDraftLines(line(12), "factuur").ok, false);
  assert.equal(validateDraftLines(line("abc"), "factuur").ok, false);

  // And every real rate still passes, including the text form a field hands over.
  for (const real of [21, 9, 0, "21", "9", "0"]) {
    const out = validateDraftLines(line(real), "factuur");
    assert.equal(out.ok, true, `${JSON.stringify(real)} is a legal rate`);
    assert.equal(out.lines?.[0]?.btw_rate, Number(real), "…and is stored as the number it is");
  }
});
