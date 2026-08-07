// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/draft-totals.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDraftTotals, validateDraftLines, ALLOWED_BTW_RATES } from "./draft-totals";
import { computeInvoiceTotals, round2 } from "./invoice-totals";

const r = (quantity: number, unit_price: number, btw_rate: number, description = "werk") =>
  ({ quantity, unit_price, btw_rate, description });

test("the arithmetic is the one every other route uses — computeInvoiceTotals", () => {
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

test("a draft is stored in CENTS, not in whatever the multiplication produced", () => {
  // 3 × 33,33 at 21%. This file used to leave that alone on purpose — "rounding here would
  // silently change the bookkeeping" — and the result was total_inc_btw = 120,9879 written into a
  // money column, four decimals, on a row an accountant reads. It was never the issued number
  // either: /api/invoice/send recomputes at issue, so the only effect was that the editor showed
  // an amount the PDF would not.
  const t = computeDraftTotals([r(3, 33.33, 21)]);
  assert.equal(t.total_ex_btw, 99.99);
  assert.equal(t.btw_amount, 21, "20,9979 is not an amount of money");
  assert.equal(t.total_inc_btw, 120.99);
  for (const v of [t.total_ex_btw, t.btw_amount, t.total_inc_btw]) {
    assert.equal(v, Number(v.toFixed(2)), "every stored total lands on a cent");
  }
});

test("the stored header equals the sum of the stored lines", () => {
  // /api/invoice/draft writes line_total = round2(quantity × price) per line. The header used to
  // be computed from the UNROUNDED products, so the invoice disagreed with its own lines — the
  // one inconsistency nothing downstream can explain, because both numbers came from us.
  const lines = [r(3, 33.335, 21), r(7, 1.115, 9)];
  const t = computeDraftTotals(lines);
  const storedLineSum = lines.reduce((s, l) => s + round2(l.quantity * l.unit_price), 0);
  assert.equal(t.total_ex_btw, round2(storedLineSum));
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
