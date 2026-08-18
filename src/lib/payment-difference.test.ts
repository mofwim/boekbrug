// [BETALINGSVERSCHIL] Pure node test — run: npx tsx --test src/lib/payment-difference.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PAYMENT_DIFFERENCE,
  detectPaymentDifference,
  detectPaymentDifferences,
  differenceCeiling,
  paymentDifferenceNote,
  type PaymentDifferenceInvoice,
} from "./payment-difference";

const TODAY = "2026-08-02";

const inv = (over: Partial<PaymentDifferenceInvoice> = {}): PaymentDifferenceInvoice => ({
  id: "i1",
  invoice_number: "26100",
  status: "sent",
  total_inc_btw: 1000,
  amount_paid: 995,
  last_payment_date: "2026-06-01", // 62 days ago — well past the quiet period
  ...over,
});

const detect = (over: Partial<PaymentDifferenceInvoice> = {}) =>
  detectPaymentDifference({ invoice: inv(over), today: TODAY });

test("[BETALINGSVERSCHIL] a bank charge left behind is named, not chased", () => {
  // The case the module exists for: €1.000 owed, €995 arrived because the bank took €5, and the
  // €5 has sat untouched for two months. Nobody is going to transfer it.
  const d = detect();
  assert.ok(d, "a €5 remainder on €1.000, two months quiet, is a payment difference");
  assert.equal(d.remainder, 5);
  assert.equal(d.total, 1000);
  assert.equal(d.invoiceNumber, "26100");
});

test("[BETALINGSVERSCHIL] an invoice nobody paid is a debt, however small", () => {
  // Dropping this test would write off real revenue: a €4 invoice is under every ceiling, and
  // "small" is not the same fact as "already mostly settled".
  assert.equal(detect({ total_inc_btw: 4, amount_paid: 0, last_payment_date: null }), null);
  assert.equal(detect({ total_inc_btw: 1000, amount_paid: 0, last_payment_date: null }), null);
});

test("[BETALINGSVERSCHIL] a short payment worth chasing is not a rounding", () => {
  // €900 on €1.000 is a hundred euro, not a bank charge. The ceiling is what separates the two,
  // and both halves of it must bite.
  assert.equal(detect({ amount_paid: 900 }), null, "€100 open is a debt");
  // The percentage bites on a small invoice: 2% of €50 is €1, so €2 open is too much.
  assert.equal(detect({ total_inc_btw: 50, amount_paid: 48 }), null, "2% of €50 is €1 — €2 is a debt");
  // The absolute cap bites on a large one: 2% of €50.000 would be €1.000, which is plainly a debt.
  assert.equal(
    detect({ total_inc_btw: 50_000, amount_paid: 49_500 }),
    null,
    "the €10 ceiling must override the percentage on a large invoice",
  );
  assert.equal(differenceCeiling({ total_inc_btw: 50_000 }), DEFAULT_PAYMENT_DIFFERENCE.maxAmount);
  assert.equal(differenceCeiling({ total_inc_btw: 50 }), 1);
});

test("[BETALINGSVERSCHIL] a live payment plan is never declared uncollectible", () => {
  // The condition Business Central does not need and this does: BC has a human applying one
  // payment in front of it, this is asked of a whole debtor list unattended. Without the quiet
  // period, the first instalment of a plan would be written off on the day it was received.
  assert.equal(detect({ last_payment_date: TODAY }), null, "paid today — still moving");
  assert.equal(detect({ last_payment_date: "2026-07-20" }), null, "13 days — inside the quiet period");
  assert.ok(detect({ last_payment_date: "2026-07-02" }), "31 days — it has stood still");
  // Unknown is not the same as old. An invoice whose last payment date we cannot read must not be
  // written off on the strength of a missing field.
  assert.equal(detect({ last_payment_date: null }), null, "no date → no claim");
  assert.equal(detect({ last_payment_date: "niet-een-datum" }), null, "unparseable → no claim");
});

test("[BETALINGSVERSCHIL] a settled invoice has nothing to report", () => {
  assert.equal(detect({ status: "paid" }), null, "status settles it, whatever the money column says");
  assert.equal(detect({ amount_paid: 1000 }), null, "nothing open");
  assert.equal(detect({ amount_paid: 1000.004 }), null, "within a cent is settled");
});

test("[BETALINGSVERSCHIL] a creditnota is measured on its magnitude, like everywhere else", () => {
  // A creditnota carries a negative total; every rule in the app compares magnitudes. A refund
  // that came back €5 short is the same fact seen from the other side.
  const d = detect({ total_inc_btw: -1000, amount_paid: 995 });
  assert.ok(d, "a creditnota's remainder is a difference too");
  assert.equal(d.remainder, 5);
  assert.equal(d.total, 1000, "reported as a magnitude");
});

test("[BETALINGSVERSCHIL] the report totals what openstaand overstates by", () => {
  const report = detectPaymentDifferences({
    invoices: [
      inv({ id: "a", amount_paid: 995 }),            // €5
      inv({ id: "b", amount_paid: 997.5 }),           // €2,50
      inv({ id: "c", amount_paid: 900 }),             // €100 — a debt, excluded
      inv({ id: "d", amount_paid: 0, last_payment_date: null }), // never paid — excluded
      inv({ id: "e", status: "paid" }),               // settled — excluded
    ],
    today: TODAY,
  });
  assert.equal(report.differences.length, 2);
  assert.equal(report.total, 7.5, "€5 + €2,50 — and nothing else");
  assert.deepEqual(report.differences.map((d) => d.invoiceId), ["a", "b"], "order preserved");
});

test("[BETALINGSVERSCHIL] the sentence claims a suggestion, never a booking", () => {
  assert.equal(paymentDifferenceNote({ differences: [], total: 0 }), null, "silent when there is nothing");

  const one = paymentDifferenceNote(detectPaymentDifferences({ invoices: [inv()], today: TODAY }));
  assert.ok(one);
  assert.match(one, /Eén factuur/);
  assert.match(one, /€\s?5,00/, "the amount is in the sentence, in Dutch formatting");
  // It must offer, never assert: nothing in this module writes anything off, and a sentence that
  // said "afgeboekt" would describe a booking that did not happen.
  assert.doesNotMatch(one, /afgeboekt|afgeschreven/, "it suggests closing, it never claims to have");

  const many = paymentDifferenceNote(
    detectPaymentDifferences({ invoices: [inv({ id: "a" }), inv({ id: "b" })], today: TODAY }),
  );
  assert.ok(many);
  assert.match(many, /2 facturen/);
});

test("[BETALINGSVERSCHIL] tightening the policy can only ever find fewer", () => {
  // The defaults are policy, and a caller may tighten them. Whatever a stricter setting does, it
  // must never surface an invoice the looser one refused — that would be a write-off appearing
  // because someone tried to be careful.
  const invoices = [
    inv({ id: "a", amount_paid: 995 }),
    inv({ id: "b", amount_paid: 999 }),
    inv({ id: "c", amount_paid: 990 }),
  ];
  const loose = detectPaymentDifferences({ invoices, today: TODAY });
  const strict = detectPaymentDifferences({
    invoices,
    today: TODAY,
    opts: { percent: 0.5, maxAmount: 2, quietDays: 90 },
  });
  const looseIds = new Set(loose.differences.map((d) => d.invoiceId));
  for (const d of strict.differences) {
    assert.ok(looseIds.has(d.invoiceId), `${d.invoiceId} appeared only under the stricter policy`);
  }
  assert.ok(strict.total <= loose.total, "a stricter policy cannot write off more");
});

// ─── [DEEL-CREDIT] A creditnota is not an unpaid remainder ───────────────────────────
//
// The detector read `total − paid` and knew nothing about credits, so money the owner had given
// back in writing came out the other end as money that "is not going to arrive". Both of its
// answers were wrong at once, and in opposite directions — see the two cases below.

test("[DEEL-CREDIT] a credited invoice paid in full has nothing left to report", () => {
  // € 500 invoiced, € 8 credited, the customer pays the € 492 that is actually owed. The invoice
  // is settled. Before this, the detector saw € 8 open, under the € 10 ceiling, standing still —
  // and told the owner € 8 "is niet meer binnengekomen, waarschijnlijk bankkosten". It came back
  // because they sent it back.
  const zonderKennis = detect({ total_inc_btw: 500, amount_paid: 492 });
  assert.ok(zonderKennis, "without the credit it looks exactly like a bank charge");
  assert.equal(zonderKennis!.remainder, 8);

  const metKennis = detect({ total_inc_btw: 500, amount_paid: 492, credited_inc_btw: 8 });
  assert.equal(metKennis, null, "with the credit there is nothing open and nothing to say");
});

test("[DEEL-CREDIT] the ceiling follows what is OWED, so a credit cannot widen a write-off", () => {
  // The compounding case. € 500 invoiced, € 480 credited, € 10 paid: € 20 was owed and half of it
  // is genuinely unpaid. A ceiling taken over the GROSS total is € 10 — and the credit-reduced
  // remainder is also € 10, so the two errors meet and file a half-unpaid invoice under
  // "afronding". Against the € 20 actually owed the ceiling is € 0,40, and it stays a debt.
  assert.equal(differenceCeiling({ total_inc_btw: 500, amount_paid: 10 }), 10);
  assert.equal(differenceCeiling({ total_inc_btw: 500, amount_paid: 10 }, DEFAULT_PAYMENT_DIFFERENCE, 480), 0.4);

  const hit = detect({ total_inc_btw: 500, amount_paid: 10, credited_inc_btw: 480 });
  assert.equal(hit, null, "half of what was owed is a debt, whatever the gross invoice was");
});

test("[DEEL-CREDIT] a caller that knows of no credit gets exactly the old answer", () => {
  // The incoming side of this app uses the OTHER model — an invoice and its creditnota are two
  // open items a payment settles together by pairing — so it passes nothing, and nothing changes.
  const zonder = detect({ total_inc_btw: 1000, amount_paid: 995 });
  const metNul = detect({ total_inc_btw: 1000, amount_paid: 995, credited_inc_btw: 0 });
  assert.deepEqual(zonder, metNul);
  assert.equal(zonder?.remainder, 5);
});

test("[DEEL-CREDIT] a credit larger than the invoice never turns the remainder negative", () => {
  const hit = detect({ total_inc_btw: 100, amount_paid: 50, credited_inc_btw: 900 });
  assert.equal(hit, null);
});
