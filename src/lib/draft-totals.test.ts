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
