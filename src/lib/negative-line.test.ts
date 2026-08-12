import test from "node:test";
import assert from "node:assert/strict";
import { lineNetEx, invoiceNetEx, lineSignFault, staysAFactuur, hasCreditLine } from "./negative-line";

// The invoice this was built from: ATAPACK Cash & Carry 26304787, 17-07-2026. One credit line for a
// return, netted inside nine ordinary ones.
const ATAPACK = [
  { quantity: -3, unit_price: 23.95, btw_rate: 21 },   // AP290004 — credit over faktuur 26302362
  { quantity: 2, unit_price: 15.95, btw_rate: 21 },    // Houtskool, Elly, 2kg
  { quantity: 2, unit_price: 13.95, btw_rate: 21 },    // Elly, briketten, 2kg
  { quantity: 1, unit_price: 13.95, btw_rate: 21 },    // Bak, aluminium, 9950ml
  { quantity: 1, unit_price: 5.50, btw_rate: 21 },     // Bak, aluminium, 2500ml
  { quantity: 3, unit_price: 5.75, btw_rate: 21 },     // Prikker, bamboe
  { quantity: 2, unit_price: 10.95, btw_rate: 21 },    // Toiletpapier, Only
  { quantity: 1, unit_price: 10.90, btw_rate: 21 },    // Keukenrol, Evo
  { quantity: 16, unit_price: 2.0208, btw_rate: 21 },  // Magnetronbak — a price that is not round
  { quantity: 1, unit_price: 11.40, btw_rate: 21 },    // PB Dikbleek, Javel
];

test("[MIN-REGEL] the credit line is worth what the paper says", () => {
  assert.equal(lineNetEx(ATAPACK[0]), -71.85, "−3 × 23,95 = −71,85");
});

test("[MIN-REGEL] the whole invoice nets to the printed total", () => {
  // € 173,03 of deliveries minus € 71,85 of credit. The document says € 101,18 excl.
  assert.equal(invoiceNetEx(ATAPACK), 101.18);
  // And without the credit line it is the gross figure, which is the other half of the check —
  // an invoiceNetEx that ignored the sign would also produce 101,18 from the wrong arithmetic.
  assert.equal(invoiceNetEx(ATAPACK.slice(1)), 173.03);
});

test("[MIN-REGEL] a negative quantity is allowed; a negative price is not", () => {
  // The whole feature, in one assertion: the line the editor used to refuse is now valid.
  assert.equal(lineSignFault({ quantity: -3, unit_price: 23.95 }), null);
  // BR-27 — an e-factuur with a negative cbc:PriceAmount is rejected by the access point, so a
  // negative price would look right on the PDF and never arrive at the customer.
  assert.equal(lineSignFault({ quantity: 3, unit_price: -23.95 }), "price_negative");
  assert.equal(lineSignFault({ quantity: -3, unit_price: -23.95 }), "price_negative");
});

test("[MIN-REGEL] a line that moves nothing is still a mistake", () => {
  // Zero is not a small credit — it is a half-typed line, and it was an error before this change
  // for the same reason it is one after.
  assert.equal(lineSignFault({ quantity: 0, unit_price: 10 }), "quantity_zero");
  assert.equal(lineSignFault({ quantity: null, unit_price: 10 }), "quantity_zero");
  assert.equal(lineSignFault({ quantity: 0.001, unit_price: 10 }), "quantity_zero", "under half a cent of a unit");
  assert.equal(lineSignFault({ quantity: NaN, unit_price: 10 }), "quantity_zero");
  // …and a price of exactly zero is allowed: a free item on an otherwise ordinary invoice.
  assert.equal(lineSignFault({ quantity: 1, unit_price: 0 }), null);
});

test("[MIN-REGEL] a document that gives money back is a creditnota, not a factuur", () => {
  // Credits inside an invoice are fine while it still asks for money. Once they exceed the
  // deliveries the number would come out of the doorlopende factuurreeks for a document that
  // behaves like a credit, and the BTW would be declared on the wrong side of the aangifte.
  assert.equal(staysAFactuur(ATAPACK), true);
  assert.equal(staysAFactuur([{ quantity: -3, unit_price: 23.95 }]), false, "a credit on its own");
  assert.equal(
    staysAFactuur([{ quantity: -3, unit_price: 23.95 }, { quantity: 1, unit_price: 20 }]),
    false,
    "credits worth more than the deliveries",
  );
  assert.equal(
    staysAFactuur([{ quantity: -3, unit_price: 23.95 }, { quantity: 1, unit_price: 71.85 }]),
    true,
    "exactly zero is still a factuur — nothing flows back",
  );
});

test("[MIN-REGEL] the boundary is decided in cents, not in floating point", () => {
  // 0.1 + 0.2 !== 0.3 in binary. A total one ten-thousandth below zero must not turn a factuur
  // into a creditnota, and a genuine one-cent credit must.
  assert.equal(staysAFactuur([{ quantity: 3, unit_price: 0.1 }, { quantity: -1, unit_price: 0.3 }]), true);
  assert.equal(staysAFactuur([{ quantity: 1, unit_price: 10 }, { quantity: -1, unit_price: 10.01 }]), false);
  assert.equal(staysAFactuur([{ quantity: 1, unit_price: 10 }, { quantity: -1, unit_price: 10 }]), true);
});

test("[MIN-REGEL] a fractional unit price survives the netting", () => {
  // The Magnetronbak line is 16 × 2,0208 = 32,33 after rounding. A netting that summed unrounded
  // products would drift away from the printed total.
  assert.equal(lineNetEx({ quantity: 16, unit_price: 2.0208 }), 32.33);
});

test("[MIN-REGEL] whether to explain is asked separately from whether it is allowed", () => {
  assert.equal(hasCreditLine(ATAPACK), true);
  assert.equal(hasCreditLine(ATAPACK.slice(1)), false);
  assert.equal(hasCreditLine([]), false);
});

test("[MIN-REGEL] an empty invoice is not a credit", () => {
  assert.equal(invoiceNetEx([]), 0);
  assert.equal(staysAFactuur([]), true, "nothing flows back from nothing");
});
