// [DEEL-CREDIT] Run: npx tsx --test src/lib/partial-credit.test.ts
//
// Two properties carry this whole file, and both are invisible on any screen when they break:
//
//   1. A FULL credit must still produce exactly what it produced before partial credits existed.
//      Every creditnota the app has ever made took this path; a cent of drift here is a cent of
//      drift in documents that are already in customers' hands.
//   2. The sum of the credits may never exceed the invoice. Over-credit means reclaiming btw that
//      was never paid and handing the customer a balance out of thin air, on two documents that
//      each look perfectly normal on their own.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCreditSelection,
  checkCreditSelection,
  creditableRemaining,
  fitsWithinOriginal,
  overCreditReason,
} from "./partial-credit";

const line = (id: string, quantity: number, unit_price: number, btw_rate = 21, extra = {}) =>
  ({ id, description: `regel ${id}`, quantity, unit_price, btw_rate, line_total: quantity * unit_price, ...extra });

// EUR 1.000 excl at 21% = EUR 1.210 incl, over four equal lines.
const LINES = [line("a", 1, 250), line("b", 1, 250), line("c", 1, 250), line("d", 1, 250)];

test("[DEEL-CREDIT] no selection is the WHOLE invoice — the road every creditnota already took", () => {
  const out = buildCreditSelection({ lines: LINES });
  assert.equal(out.isFull, true);
  assert.equal(out.lines.length, 4);
  assert.equal(out.totalExBtw, 1000);
  assert.equal(out.btwAmount, 210);
  assert.equal(out.totalIncBtw, 1210);
  assert.equal(out.discount, null);
});

test("[DEEL-CREDIT] naming every line in full is the same creditnota, and says so", () => {
  // An owner who ticks all four boxes has not made a different document.
  const out = buildCreditSelection({
    lines: LINES,
    selection: LINES.map((l) => ({ id: l.id, quantity: l.quantity })),
  });
  assert.equal(out.isFull, true);
  assert.equal(out.totalIncBtw, 1210);
});

test("[DEEL-CREDIT] one line of four", () => {
  const out = buildCreditSelection({ lines: LINES, selection: [{ id: "b", quantity: 1 }] });
  assert.equal(out.isFull, false);
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].id, "b");
  assert.equal(out.totalExBtw, 250);
  assert.equal(out.btwAmount, 52.5);
  assert.equal(out.totalIncBtw, 302.5);
});

test("[DEEL-CREDIT] part of one line — three of the ten delivered", () => {
  const tien = [line("a", 10, 12.5)];
  const out = buildCreditSelection({ lines: tien, selection: [{ id: "a", quantity: 3 }] });
  assert.equal(out.totalExBtw, 37.5, "3 x 12,50 — recomputed from the chosen quantity");
  assert.equal(out.totalIncBtw, 45.38);
});

test("[DEEL-CREDIT] the stored line total is NOT reused for a partial line", () => {
  // line_total belongs to the full quantity. Reading it here would credit the whole line while
  // the document says three units — the amount and the description contradicting each other.
  const tien = [{ ...line("a", 10, 12.5), line_total: 125 }];
  const out = buildCreditSelection({ lines: tien, selection: [{ id: "a", quantity: 3 }] });
  assert.notEqual(out.totalExBtw, 125);
  assert.equal(out.totalExBtw, 37.5);
});

test("[DEEL-CREDIT] a line discount travels, so the credit gives back what was charged", () => {
  // The line was invoiced at 20% off. Crediting it must return the DISCOUNTED amount — returning
  // the list price hands the customer money they never paid.
  const met = [line("a", 10, 12.5, 21, { discount_type: "percent", discount_value: 20, line_total: 100 })];
  const out = buildCreditSelection({ lines: met, selection: [{ id: "a", quantity: 10 }] });
  assert.equal(out.totalExBtw, 100, "125 minus 20%, not 125");
  assert.equal(out.totalIncBtw, 121);
});

test("[DEEL-CREDIT] a PERCENTAGE document discount travels unchanged — it is pro rata by itself", () => {
  const out = buildCreditSelection({
    lines: LINES,
    selection: [{ id: "a", quantity: 1 }],
    discountType: "percent",
    discountValue: 10,
  });
  assert.deepEqual(out.discount, { type: "percent", value: 10 });
  assert.equal(out.totalExBtw, 225, "250 minus 10%");
});

test("[DEEL-CREDIT] a FIXED document discount is SCALED — the trap this module exists for", () => {
  // EUR 1.000 invoiced with EUR 200 off; the customer paid EUR 800 excl. Credit half the lines and
  // carry the EUR 200 across untouched, and you give back EUR 300 for something EUR 400 was paid
  // for — EUR 100 kept, on two documents that each add up perfectly.
  const out = buildCreditSelection({
    lines: LINES,
    selection: [{ id: "a", quantity: 1 }, { id: "b", quantity: 1 }],
    discountType: "amount",
    discountValue: 200,
  });
  assert.deepEqual(out.discount, { type: "amount", value: 100 }, "half the lines, half the discount");
  assert.equal(out.totalExBtw, 400, "500 minus 100 — exactly what was charged for these two");
});

test("[DEEL-CREDIT] a FULL credit with a fixed discount is untouched by the scaling", () => {
  // The share is 1, so the old behaviour has to come out to the cent.
  const out = buildCreditSelection({ lines: LINES, discountType: "amount", discountValue: 200 });
  assert.deepEqual(out.discount, { type: "amount", value: 200 });
  assert.equal(out.totalExBtw, 800);
  assert.equal(out.totalIncBtw, 968);
});

test("[DEEL-CREDIT] the share is measured on GROSS line amounts", () => {
  // Two lines of EUR 100 gross, one of them 50% off. The delivered SHARE of the discounted line is
  // still half the invoice; measuring on net amounts would make it a third and hand the fixed
  // discount out unevenly between the credit and what stays open.
  const ongelijk = [
    line("a", 1, 100, 21, { discount_type: "percent", discount_value: 50, line_total: 50 }),
    line("b", 1, 100),
  ];
  const out = buildCreditSelection({
    lines: ongelijk,
    selection: [{ id: "a", quantity: 1 }],
    discountType: "amount",
    discountValue: 20,
  });
  assert.deepEqual(out.discount, { type: "amount", value: 10 }, "half the gross, half the discount");
});

test("[DEEL-CREDIT] a credit line inside the invoice keeps its direction", () => {
  // [MIN-REGEL] A return settled on the invoice is a negative line. Crediting it takes back a
  // negative — the magnitude is what is bounded, in both directions.
  const met = [line("a", 5, 100), line("b", -2, 100)];
  assert.equal(checkCreditSelection(met, [{ id: "b", quantity: -2 }]), null);
  assert.equal(checkCreditSelection(met, [{ id: "b", quantity: 2 }]), "quantity_negative",
    "you cannot flip a credit line into a delivery by crediting it the other way");
  assert.equal(checkCreditSelection(met, [{ id: "b", quantity: -3 }]), "quantity_exceeds_line");
});

test("[DEEL-CREDIT] a selection is checked against the lines it claims to credit", () => {
  assert.equal(checkCreditSelection(LINES, null), null, "no selection is the whole invoice");
  assert.equal(checkCreditSelection(LINES, []), null);
  assert.equal(checkCreditSelection([], null), "no_lines");
  assert.equal(checkCreditSelection(LINES, [{ id: "zzz", quantity: 1 }]), "unknown_line");
  assert.equal(checkCreditSelection(LINES, [{ id: "a", quantity: 2 }]), "quantity_exceeds_line",
    "never more than was delivered");
  assert.equal(checkCreditSelection(LINES, [{ id: "a", quantity: 0 }]), "nothing_selected");
  assert.equal(checkCreditSelection(LINES, [{ id: "a", quantity: Number.NaN }]), "quantity_negative");
});

test("[DEEL-CREDIT] the ceiling: credits may never exceed the invoice", () => {
  assert.equal(creditableRemaining(1210, 0), 1210);
  assert.equal(creditableRemaining(1210, 302.5), 907.5);
  assert.equal(creditableRemaining(1210, 1210), 0);
  assert.equal(creditableRemaining(1210, 5000), 0, "already over-credited is never an invitation");
  assert.equal(creditableRemaining(-1210, 302.5), 907.5, "magnitudes — the direction is not the question");

  assert.equal(fitsWithinOriginal(1210, 0, 1210), true, "the whole invoice fits");
  assert.equal(fitsWithinOriginal(1210, 302.5, 907.5), true, "and so does the exact remainder");
  // The margin is half a cent, and no more: it is there so float noise cannot refuse a credit for
  // the exact remainder, not so a credit can be a cent bigger than the invoice.
  assert.equal(fitsWithinOriginal(1210, 302.5, 907.503), true, "sub-cent noise is tolerated");
  assert.equal(fitsWithinOriginal(1210, 302.5, 907.51), false, "a whole cent past it is not");
  assert.equal(fitsWithinOriginal(1210, 302.5, 910), false, "and three euros certainly is not");
  assert.equal(fitsWithinOriginal(1210, 1210, 0.01), false, "nothing fits into a fully credited invoice");
});

test("[DEEL-CREDIT] the refusal names the amount that would still fit", () => {
  assert.match(overCreditReason(907.5), /907,50/);
  assert.match(overCreditReason(0), /volledig gecrediteerd/);
});

test("[DEEL-CREDIT] crediting everything twice is exactly what the ceiling stops", () => {
  // The scenario in one line: a full creditnota exists, and a second one is attempted. Before
  // partial credits a unique index refused it; now the ceiling does, and it has to be just as firm.
  const eerste = buildCreditSelection({ lines: LINES });
  assert.equal(fitsWithinOriginal(1210, eerste.totalIncBtw, eerste.totalIncBtw), false);
});

test("[DEEL-CREDIT] a partial line carries the PARTIAL amount, not the whole line's", () => {
  // The mirror in creditnota-lines.ts flips line_total. Leave the stored one in place and a credit
  // for 3 of 10 says "-3 stuks" beside the amount of ten — the customer gets more than three times
  // too much back, on a document where neither number looks wrong on its own.
  const tien = [{ ...line("a", 10, 12.5), line_total: 125 }];
  const out = buildCreditSelection({ lines: tien, selection: [{ id: "a", quantity: 3 }] });
  assert.equal(out.lines[0].quantity, 3);
  assert.equal(out.lines[0].line_total, 37.5, "3 x 12,50 — the amount belongs to the quantity beside it");
});

test("[DEEL-CREDIT] a FULL credit reproduces the stored line totals exactly", () => {
  // Every creditnota the app has ever made took this path. Same rounding, same line discount.
  const met = [
    { ...line("a", 1.5, 33.33), line_total: 50 },
    { ...line("b", 10, 12.5, 21, { discount_type: "percent", discount_value: 20 }), line_total: 100 },
  ];
  const out = buildCreditSelection({ lines: met });
  assert.deepEqual(out.lines.map((l) => l.line_total), [50, 100]);
});
