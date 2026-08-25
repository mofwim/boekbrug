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
import { round2 } from "./invoice-totals";

import { creditLinesFor } from "./creditnota-lines";
import {
  buildCreditSelection,
  checkCreditSelection,
  creditedQuantitiesByLine,
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

// ─── [DEEL-KORTING] A line's OWN discount when only part of the line is credited ────────────────
//
// The document discount below already scales a fixed amount pro rata, with the reasoning written
// out. The same argument applies one level down and was not made there: a percentage on a line is
// already pro rata, a fixed amount on a line belongs to the WHOLE line.
//
// Measured on 10 × € 50 with € 25 off, where the customer paid € 47,50 per unit:
//
//     fair credit for 3 units    3 × 47,50   = € 142,50
//     what was credited          150 − 25    = € 125,00     € 17,50 too little
//
// The two features that produce this shape — line discounts and partial credits — landed on main
// within hours of each other, from different sessions. Neither is wrong on its own.

const KORTINGSREGEL = {
  id: "k1", description: "Advies", quantity: 10, unit_price: 50, btw_rate: 21,
  line_total: 475, discount_type: "amount", discount_value: 25,
};

test("[DEEL-KORTING] a fixed line discount scales with the part being credited", () => {
  const out = buildCreditSelection({ lines: [KORTINGSREGEL], selection: [{ id: "k1", quantity: 3 }] });
  assert.equal(out.lines[0].line_total, 142.5, "3 × € 47,50 — what the customer actually paid per unit");
  // The scaled amount must travel WITH the line, or the e-factuur recomputes
  // quantity × price − allowance (PEPPOL-EN16931-R120), finds € 125, and refuses the file.
  assert.equal(out.lines[0].discount_value, 7.5, "€ 25 × 3/10");
  assert.equal(out.lines[0].discount_type, "amount");
});

test("[DEEL-KORTING] a percentage needs no scaling, and must not get any", () => {
  const pct = { ...KORTINGSREGEL, discount_type: "percent", discount_value: 10, line_total: 450 };
  const out = buildCreditSelection({ lines: [pct], selection: [{ id: "k1", quantity: 3 }] });
  assert.equal(out.lines[0].line_total, 135, "3 × € 45,00");
  assert.equal(out.lines[0].discount_value, 10, "ten percent of three units is still ten percent");
});

test("[DEEL-KORTING] a FULL credit is unchanged, to the cent", () => {
  // The property this file is built on: every creditnota the app has ever made took this path.
  const alles = buildCreditSelection({ lines: [KORTINGSREGEL] });
  assert.equal(alles.lines[0].line_total, 475, "the stored amount, reproduced exactly");
  assert.equal(alles.lines[0].discount_value, 25, "…with the discount it was agreed at");
  const expliciet = buildCreditSelection({ lines: [KORTINGSREGEL], selection: [{ id: "k1", quantity: 10 }] });
  assert.deepEqual(expliciet.lines[0].line_total, alles.lines[0].line_total);
});

test("[DEEL-KORTING] one unit of ten, where the old arithmetic was worst", () => {
  // 50 − 25 = € 25,00 against a fair € 47,50: nearly half. And with a discount LARGER than the
  // partial gross, lineDiscountEx clamps to the amount itself — a credit line of € 0,00 for goods
  // that genuinely went back.
  const out = buildCreditSelection({ lines: [KORTINGSREGEL], selection: [{ id: "k1", quantity: 1 }] });
  assert.equal(out.lines[0].line_total, 47.5);
  const groot = { ...KORTINGSREGEL, discount_value: 60, line_total: 440 };
  const een = buildCreditSelection({ lines: [groot], selection: [{ id: "k1", quantity: 1 }] });
  assert.equal(een.lines[0].line_total, 44, "€ 50 − € 6,00 — not € 0,00");
});

test("[DEEL-KORTING] the scaling rounds to cents, and the line reproduces itself", () => {
  // A third of € 25 is € 8,3333…. The stored discount and the stored line total must be computed
  // from the SAME rounded number, or the two disagree by a cent in the file that gets validated.
  const drie = { ...KORTINGSREGEL, quantity: 3, line_total: 125 };
  const out = buildCreditSelection({ lines: [drie], selection: [{ id: "k1", quantity: 1 }] });
  const line = out.lines[0];
  assert.equal(line.discount_value, 8.33);
  assert.equal(line.line_total, round2(50 - 8.33), "quantity × price − the stored allowance");
});

test("[DEEL-KORTING] a line with no discount at all is untouched", () => {
  const kaal = { id: "k1", description: "Advies", quantity: 10, unit_price: 50, btw_rate: 21, line_total: 500 };
  const out = buildCreditSelection({ lines: [kaal], selection: [{ id: "k1", quantity: 3 }] });
  assert.equal(out.lines[0].line_total, 150);
  assert.equal("discount_type" in out.lines[0], false, "a column the row never had stays absent");
});

// ─── [DEEL-CREDIT-CUMULATIEF] The same line, credited twice ───────────────────
//
// checkCreditSelection compared a requested quantity to the ORIGINAL line and to nothing else,
// which was right while an invoice could be credited once. The ceiling that was supposed to catch
// the repeat (fitsWithinOriginal) sums the GROSS of the whole invoice and is blind to the rate, so
// with mixed rates the double credit fitted straight through it. Measured, on this exact invoice:
//
//     1 x EUR 1.000 @ 21%  +  1 x EUR 1.000 @ 9%     gross EUR 2.300
//     credit the 9% line twice: 2 x 1.090 = 2.180 <= 2.300  -> both passes accepted
//
// EUR 180 of BTW reclaimed on a line that ever carried EUR 90. Art. 29 Wet OB.

const MIXED = [
  { id: "A", description: "21% werk", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000, unit: "stuks" },
  { id: "B", description: "9% werk", quantity: 1, unit_price: 1000, btw_rate: 9, line_total: 1000, unit: "stuks" },
];

test("[DEEL-CREDIT-CUMULATIEF] a line already credited in full cannot be credited again", () => {
  const eersteKeer = creditLinesFor(
    [MIXED[1]] as never, "cn-1", "verkeerd geleverd",
  ) as unknown as Parameters<typeof creditedQuantitiesByLine>[1];

  const al = creditedQuantitiesByLine(MIXED, eersteKeer);
  assert.equal(al.get("B"), 1, "the credit line is attributed back to the line it took away");
  assert.equal(al.get("A"), 0, "…and to that line only");

  assert.equal(checkCreditSelection(MIXED, [{ id: "B", quantity: 1 }], new Map()), null,
    "the first credit of a line is fine");
  assert.equal(checkCreditSelection(MIXED, [{ id: "B", quantity: 1 }], al), "quantity_exceeds_line",
    "the second is not — this is the EUR 180-against-EUR 90 case");

  // The untouched line must stay creditable, or the fix would cost more than the defect.
  assert.equal(checkCreditSelection(MIXED, [{ id: "A", quantity: 1 }], al), null);
});

test("[DEEL-CREDIT-CUMULATIEF] the same line twice inside ONE selection also stops", () => {
  // Otherwise the cap is avoided by putting the line in one creditnota twice rather than in two.
  assert.equal(
    checkCreditSelection(MIXED, [{ id: "B", quantity: 1 }, { id: "B", quantity: 1 }], new Map()),
    "quantity_exceeds_line",
  );
});

test("[DEEL-CREDIT-CUMULATIEF] a partial credit leaves the remainder creditable", () => {
  const tien = [{ id: "T", description: "Uren", quantity: 10, unit_price: 50, btw_rate: 21, line_total: 500, unit: "uur" }];
  const drieGecrediteerd = creditLinesFor(
    [{ ...tien[0], quantity: 3, line_total: 150 }] as never, "cn-1", null,
  ) as unknown as Parameters<typeof creditedQuantitiesByLine>[1];
  const al = creditedQuantitiesByLine(tien, drieGecrediteerd);
  assert.equal(al.get("T"), 3);
  assert.equal(checkCreditSelection(tien, [{ id: "T", quantity: 7 }], al), null, "the other seven are still owed back");
  assert.equal(checkCreditSelection(tien, [{ id: "T", quantity: 8 }], al), "quantity_exceeds_line", "an eighth is not");
});

test("[DEEL-CREDIT-CUMULATIEF] two identical lines share one bucket, which is the honest answer", () => {
  // Crediting "one of two identical lines" twice and crediting both once are the same act. Keying
  // on content therefore loses nothing — and it is what makes the attribution exact rather than a
  // guess, since a creditnota line carries no reference to the line it takes back.
  const twee = [
    { id: "x1", description: "Doos", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100, unit: "stuks" },
    { id: "x2", description: "Doos", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100, unit: "stuks" },
  ];
  const een = creditLinesFor([twee[0]] as never, "cn-1", null) as unknown as Parameters<typeof creditedQuantitiesByLine>[1];
  const al = creditedQuantitiesByLine(twee, een);
  assert.equal(checkCreditSelection(twee, [{ id: "x2", quantity: 1 }], al), null, "the second box may still go back");
  assert.equal(checkCreditSelection(twee, [{ id: "x1", quantity: 2 }], al), "quantity_exceeds_line", "a third may not");
});

test("[DEEL-CREDIT-CUMULATIEF] with no map supplied the answer is exactly what it always was", () => {
  // A caller that cannot read the earlier creditnotas must not silently become more permissive —
  // it gets the old behaviour, and the route fails closed rather than passing an empty map.
  assert.equal(checkCreditSelection(LINES, [{ id: "a", quantity: 1 }]), null);
  assert.equal(checkCreditSelection(LINES, [{ id: "a", quantity: 2 }]), "quantity_exceeds_line");
  assert.equal(
    checkCreditSelection(LINES, [{ id: "a", quantity: 1 }]),
    checkCreditSelection(LINES, [{ id: "a", quantity: 1 }], new Map()),
  );
});

test("[DEEL-CREDIT-CUMULATIEF] only a line that NAMES its original counts as credit", () => {
  // The prefix is the whole reference — a creditnota line carries no column pointing back. A line
  // that merely repeats the original's description, with the same price and rate but WITHOUT the
  // prefix, is some other document's line and says nothing about what was taken back. Counting it
  // would refuse a legitimate credit; the gross ceiling in the route still bounds the total.
  const zonderVoorvoegsel = [
    { id: "z", description: "9% werk", quantity: -1, unit_price: 1000, btw_rate: 9, line_total: -1000, unit: "stuks" },
  ];
  assert.equal(creditedQuantitiesByLine(MIXED, zonderVoorvoegsel).get("B"), 0,
    "no prefix, no attribution");

  // …and WITH the prefix the very same line does count, so the test above is about the prefix and
  // not about some other field failing to match.
  const metVoorvoegsel = [{ ...zonderVoorvoegsel[0], description: "[Creditnota] 9% werk" }];
  assert.equal(creditedQuantitiesByLine(MIXED, metVoorvoegsel).get("B"), 1);
});

test("[DEEL-CREDIT-CUMULATIEF] the LONGEST matching description wins", () => {
  // Two lines whose descriptions share a beginning, at the same price and rate so nothing else can
  // tell them apart. "[Creditnota] Werkdag" must land on "Werkdag" — taking the shorter match would
  // credit "Werk" instead and leave the line that was really returned still fully creditable.
  const lijkend = [
    { id: "w1", description: "Werk", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100, unit: "stuks" },
    { id: "w2", description: "Werkdag", quantity: 1, unit_price: 100, btw_rate: 21, line_total: 100, unit: "stuks" },
  ];
  const credit = [{ id: "c", description: "[Creditnota] Werkdag", quantity: -1, unit_price: 100, btw_rate: 21, line_total: -100, unit: "stuks" }];
  const al = creditedQuantitiesByLine(lijkend, credit);
  assert.equal(al.get("w2"), 1, "the returned line is the one that was credited");
  assert.equal(al.get("w1"), 0, "…and the other one is untouched");
  assert.equal(checkCreditSelection(lijkend, [{ id: "w2", quantity: 1 }], al), "quantity_exceeds_line");
  assert.equal(checkCreditSelection(lijkend, [{ id: "w1", quantity: 1 }], al), null);
});

test("[EMMER-SLEUTEL] twee identieke regels delen ook BINNEN één selectie hun emmer", () => {
  // A en B zijn inhoudelijk dezelfde regel (zelfde tekst/prijs/tarief/eenheid), samen geleverd: 2.
  // Het plafond is per emmer; de teller binnen één selectie liep per id — dus A:1 + B:2 kreeg
  // voor B een verse teller tegen hetzelfde gedeelde plafond en er werden 3 eenheden uit een
  // emmer van 2 teruggenomen. BTW teruggevraagd waar niets tegenover staat, op een genummerd
  // document. Het scherm kan dit niet sturen; de losse aanroep wél.
  const dubbel = [
    { id: "a", description: "Doos appels", quantity: 1, unit_price: 1000, btw_rate: 9, line_total: 1000, unit: "stuks" },
    { id: "b", description: "Doos appels", quantity: 1, unit_price: 1000, btw_rate: 9, line_total: 1000, unit: "stuks" },
    { id: "c", description: "Iets anders", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000, unit: "stuks" },
  ];
  assert.equal(checkCreditSelection(dubbel, [{ id: "a", quantity: 1 }, { id: "b", quantity: 2 }]), "quantity_exceeds_line");
  // De legitieme volle emmer blijft gewoon kunnen: samen precies wat er geleverd is.
  assert.equal(checkCreditSelection(dubbel, [{ id: "a", quantity: 1 }, { id: "b", quantity: 1 }]), null);
});

