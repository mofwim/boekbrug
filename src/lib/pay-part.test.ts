// [DEEL-BETALEN] Pure node test — run: npx tsx --test src/lib/pay-part.test.ts
//
// The invoice is the reported one: Enka Horeca B.V., € 3.819,82, kenmerk 26710525. The owner
// wants to send part of it now and the rest later, which the pay sheet could not express at all.

import { test } from "node:test";
import assert from "node:assert/strict";

import { planPartPayment, defaultPartPayInput, payableOpenAmount } from "./pay-part";

const ENKA = { status: "received", total_inc_btw: 3819.82, amount_paid: 0 };

test("[DEEL-BETALEN] the field starts at the whole balance, written the Dutch way", () => {
  assert.equal(defaultPartPayInput(ENKA), "3819,82");
  // Nothing changes for someone who just pays in full: the default IS the full amount.
  const plan = planPartPayment(ENKA, defaultPartPayInput(ENKA));
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.plan.amount, 3819.82);
  assert.equal(plan.plan.remaining, 0);
  assert.equal(plan.plan.settlesAll, true, "paying everything must not promise a remainder");
});

test("[DEEL-BETALEN] € 1.500 now, and it says what is left", () => {
  const plan = planPartPayment(ENKA, "1.500,00");
  assert.ok(plan.ok, JSON.stringify(plan));
  if (!plan.ok) return;
  assert.equal(plan.plan.amount, 1500);
  assert.equal(plan.plan.remaining, 2319.82, "the remainder is what the owner still owes");
  assert.equal(plan.plan.settlesAll, false);
});

test("[DEEL-BETALEN] the second and third instalment measure against what is LEFT", () => {
  // After the bank confirms € 1.500, amount_paid carries it and the sheet reopens on the rest.
  const na1 = { ...ENKA, amount_paid: 1500 };
  assert.equal(payableOpenAmount(na1), 2319.82);
  assert.equal(defaultPartPayInput(na1), "2319,82");

  const tweede = planPartPayment(na1, "1500");
  assert.ok(tweede.ok);
  if (!tweede.ok) return;
  assert.equal(tweede.plan.remaining, 819.82);

  // The last one lands exactly on zero — three instalments, nothing left hanging.
  const na2 = { ...ENKA, amount_paid: 3000 };
  const derde = planPartPayment(na2, defaultPartPayInput(na2));
  assert.ok(derde.ok);
  if (!derde.ok) return;
  assert.equal(derde.plan.amount, 819.82);
  assert.equal(derde.plan.settlesAll, true);
});

test("[DEEL-BETALEN] more than is open is refused, and the refusal names the consequence", () => {
  // The one direction the owner cannot undo alone: money sent to a supplier comes back only if
  // the supplier chooses to send it back.
  const teveel = planPartPayment(ENKA, "4000");
  assert.equal(teveel.ok, false);
  if (teveel.ok) return;
  assert.match(teveel.error, /3\.819,82|3819,82/, "it must say what IS open");
  assert.match(teveel.error, /terugvragen/, "…and that the money has to be asked back");

  // Even one cent over. The ceiling is the balance, not a suggestion.
  const eenCent = planPartPayment(ENKA, "3819,83");
  assert.equal(eenCent.ok, false);
  // …and exactly the balance is fine.
  assert.equal(planPartPayment(ENKA, "3819,82").ok, true);
});

test("[DEEL-BETALEN] an unusable field is refused with a readable reason, never a silent 0", () => {
  for (const [typed, patroon] of [["", /Vul in/], ["  ", /Vul in/], ["abc", /geen bedrag/], ["1.2.3", /geen bedrag/], ["0", /boven € 0,00/], ["0,00", /boven € 0,00/]] as const) {
    const d = planPartPayment(ENKA, typed);
    assert.equal(d.ok, false, `"${typed}" was accepted as a payment`);
    if (!d.ok) assert.match(d.error, patroon, `"${typed}" got the wrong reason: ${d.error}`);
  }
});

test("[DEEL-BETALEN] a creditnota has no instalment to send", () => {
  // Money coming BACK. There is no part of it to transfer, and a QR could not carry a negative
  // amount anyway — EPC refuses one.
  const credit = { status: "received", total_inc_btw: -250, amount_paid: 0 };
  const d = planPartPayment(credit, "100");
  assert.equal(d.ok, false);
  if (!d.ok) assert.match(d.error, /creditnota/, "the reason must name what the document IS");

  // …and neither does a settled invoice, whatever amount_paid happens to say.
  const betaald = { status: "paid", total_inc_btw: 3819.82, amount_paid: 0 };
  assert.equal(planPartPayment(betaald, "100").ok, false, "a paid invoice may not be paid again");
});

test("[DEEL-BETALEN] Dutch and phone-keyboard spellings of the same amount agree", () => {
  // The same lesson as the comma fields elsewhere: a phone on an English layout produces 1500.50.
  for (const typed of ["1500,50", "1.500,50", "1500.50", " € 1.500,50 "]) {
    const d = planPartPayment(ENKA, typed);
    assert.ok(d.ok, `"${typed}" was not read as an amount`);
    if (d.ok) assert.equal(d.plan.amount, 1500.5, `"${typed}" read as ${JSON.stringify(d.plan)}`);
  }
});
