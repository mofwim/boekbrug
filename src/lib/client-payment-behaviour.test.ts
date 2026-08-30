// [BETAALGEDRAG] Run: npx tsx --test src/lib/client-payment-behaviour.test.ts
//
// The tests that matter here are the ones about NOT saying something. This module replaces a box
// the owner typed a guess into, so the failure it must never have is a confident wrong number:
// a median built on one invoice, a "0 dagen" standing in for "we do not know", or a paid invoice
// with no payment date quietly dropped so a thin sample looks thick.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientPaymentBehaviour,
  MIN_MEASURED_INVOICES,
  type BehaviourInvoice,
} from "./client-payment-behaviour";
import { dayNumberFromIso } from "./invoice-reminders";

const TODAY = dayNumberFromIso("2026-08-29") as number;

/** A paid invoice, dates spelled out so each test reads as its own story. */
function paid(invoice_date: string, due_date: string, payment_date: string | null): BehaviourInvoice {
  return { invoice_date, due_date, payment_date, status: "paid", total_inc_btw: 121 };
}
function open(status: string, due_date: string, total_inc_btw = 121): BehaviourInvoice {
  return { invoice_date: "2026-01-01", due_date, payment_date: null, status, total_inc_btw };
}

test("no invoices at all is its own answer, not a zero", () => {
  const b = clientPaymentBehaviour([], TODAY);
  assert.equal(b.pace, null);
  assert.equal(b.absence, "no_invoices");
  assert.equal(b.overdue, null, "nothing billed is nothing overdue");
});

test("invoices that nobody has paid yet state that, and never a pace", () => {
  const b = clientPaymentBehaviour([open("sent", "2026-09-30"), open("sent", "2026-10-31")], TODAY);
  assert.equal(b.pace, null);
  assert.equal(b.absence, "none_paid");
});

test("paid invoices without a payment date are counted and reported, never dropped", () => {
  // Marked paid by hand, or booked before the bank match existed. Dropping them silently would
  // make a verdict resting on nothing look like one resting on four invoices.
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", null),
      paid("2026-02-01", "2026-03-03", null),
      paid("2026-03-01", "2026-03-31", null),
      paid("2026-04-01", "2026-05-01", null),
    ],
    TODAY,
  );
  assert.equal(b.pace, null);
  assert.equal(b.absence, "no_payment_dates");
  assert.equal(b.unmeasured.missingDate, 4, "all four are visible as unmeasurable");
});

test(`under ${MIN_MEASURED_INVOICES} measurable invoices there is no verdict at all`, () => {
  const b = clientPaymentBehaviour(
    [paid("2026-01-01", "2026-01-31", "2026-01-08"), paid("2026-02-01", "2026-03-03", "2026-02-08")],
    TODAY,
  );
  assert.equal(b.pace, null, "two facts are not a habit");
  assert.equal(b.absence, "too_few");
});

test("the pace is the MEDIAN — one disputed invoice does not brand a fast payer", () => {
  // Two invoices paid in a week, one that sat for 300 days. The average is 104 days and describes
  // no invoice that was ever sent. The median is 7, which is how this customer actually pays.
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-08"), // 7 days, 23 before the term
      paid("2026-02-01", "2026-03-03", "2026-02-08"), // 7 days, 23 before the term
      paid("2026-03-01", "2026-03-31", "2026-12-26"), // 300 days, 270 past it
    ],
    TODAY,
  );
  assert.ok(b.pace);
  assert.equal(b.pace.sample, 3);
  assert.equal(b.pace.medianDaysAfterInvoice, 7, "not 104");
  assert.equal(b.pace.medianDaysBeyondTerm, -23, "negative: normally pays before the term is up");
  assert.equal(b.pace.onTime, 2);
  assert.equal(b.pace.late, 1);
  assert.equal(b.pace.onTime + b.pace.late, b.pace.sample, "every measured invoice is one or the other");
  assert.equal(b.pace.slowestDaysBeyondTerm, 270, "the worst case is stated, not averaged away");
});

test("an even sample rounds toward SLOWER — never flatter a debtor", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-31"), // 30 days, exactly on term
      paid("2026-01-01", "2026-01-31", "2026-02-01"), // 31 days, 1 late
      paid("2026-01-01", "2026-01-31", "2026-02-02"), // 32 days, 2 late
      paid("2026-01-01", "2026-01-31", "2026-02-04"), // 34 days, 4 late
    ],
    TODAY,
  );
  assert.ok(b.pace);
  assert.equal(b.pace.medianDaysBeyondTerm, 2, "1.5 rounds to 2, not to 1");
  assert.equal(b.pace.medianDaysAfterInvoice, 32, "31.5 rounds to 32");
  assert.equal(b.pace.onTime, 1, "paying exactly on the due date is on time");
});

test("a payment dated before its own invoice is refused, not repaired", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-05-10", "2026-06-09", "2026-05-01"), // impossible
      paid("2026-01-01", "2026-01-31", "2026-01-08"),
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
    ],
    TODAY,
  );
  assert.ok(b.pace);
  assert.equal(b.unmeasured.impossible, 1, "counted, so the owner can see one invoice is wrong");
  assert.equal(b.pace.sample, 3, "and it is not clamped to zero days inside the median");
  assert.equal(b.pace.medianDaysAfterInvoice, 7);
});

test("overdue counts only what is actually owed today", () => {
  const b = clientPaymentBehaviour(
    [
      open("sent", "2026-08-01", 121), // 28 days late
      open("overdue", "2026-07-15", 242.5), // 45 days late — the oldest
      open("sent", "2026-09-30"), // not due yet
      open("draft", "2026-01-01"), // never sent: nobody owes this
      open("credit", "2026-01-01"), // a creditnota is money going the other way
    ],
    TODAY,
  );
  assert.ok(b.overdue);
  assert.equal(b.overdue.count, 2, "a draft and a creditnota are not debts");
  assert.equal(b.overdue.amount, 363.5);
  assert.equal(b.overdue.oldestDaysLate, 45);
});

test("an invoice due exactly today is not yet late", () => {
  const b = clientPaymentBehaviour([open("sent", "2026-08-29")], TODAY);
  assert.equal(b.overdue, null, "the day it is due, the customer still has the day");
});

test("a pace and an overdue invoice coexist — the habit and the exception are different facts", () => {
  const b = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-08"),
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
      open("sent", "2026-08-01", 500),
    ],
    TODAY,
  );
  assert.ok(b.pace, "a customer who normally pays fast");
  assert.equal(b.pace.medianDaysAfterInvoice, 7);
  assert.ok(b.overdue, "…is still sitting on one invoice right now");
  assert.equal(b.overdue.count, 1);
  assert.equal(b.overdue.amount, 500);
});

// ── [CREDITNOTA-NO-CHASE] + [PARTIAL-PAY] — the two ways this panel invented a debt ─────────────
//
// Both were confident WRONG numbers on the screen the owner opens before telephoning a customer,
// which is the one failure this module's header says it must never have.

test("a sent creditnota past its due date is not an overdue debt", () => {
  // The docstring on AWAITING already promised this ("a creditnota is money going the other way").
  // It was not true: AWAITING is a set of STATUSES, and a creditnota carries the same ones. There
  // is a live status='sent', invoice_type='creditnota' row in production today.
  const b = clientPaymentBehaviour(
    [{ ...open("sent", "2026-07-01", -250), invoice_type: "creditnota" }],
    TODAY,
  );
  assert.equal(b.overdue, null, "money the owner gave back is not money the customer owes");
});

test("…and it does not drag the overdue TOTAL down while pushing the COUNT up", () => {
  // The worst shape of the old bug: a creditnota's total is stored negative, so it subtracted from
  // the euros and added to the count. The screen read "2 facturen te laat · € 750" over two
  // invoices of which the only real one was € 1.000.
  const b = clientPaymentBehaviour(
    [
      open("sent", "2026-07-01", 1000),
      { ...open("sent", "2026-07-01", -250), invoice_type: "creditnota" },
    ],
    TODAY,
  );
  assert.ok(b.overdue);
  assert.equal(b.overdue.count, 1);
  assert.equal(b.overdue.amount, 1000);
});

test("a pro_forma is not owed either", () => {
  const b = clientPaymentBehaviour(
    [{ ...open("sent", "2026-07-01", 400), invoice_type: "pro_forma" }],
    TODAY,
  );
  assert.equal(b.overdue, null);
});

test("a customer holding only credit notes has nothing billed to measure", () => {
  const b = clientPaymentBehaviour(
    [{ ...open("sent", "2026-07-01", -250), invoice_type: "creditnota" }],
    TODAY,
  );
  assert.equal(b.absence, "no_invoices", "not 'none_paid' — nothing was ever billed to them");
});

test("a creditnota's payment date never enters the customer's pace", () => {
  // The quieter half: payment_date on a creditnota is the day the OWNER paid the customer back.
  // Three real invoices paid in 7 days, plus one credit 'paid' after 90 — the median must not move.
  const withCredit = clientPaymentBehaviour(
    [
      paid("2026-01-01", "2026-01-31", "2026-01-08"),
      paid("2026-02-01", "2026-03-03", "2026-02-08"),
      paid("2026-03-01", "2026-03-31", "2026-03-08"),
      { ...paid("2026-04-01", "2026-04-30", "2026-06-30"), invoice_type: "creditnota", total_inc_btw: -100 },
    ],
    TODAY,
  );
  assert.ok(withCredit.pace);
  assert.equal(withCredit.pace.sample, 3, "three invoices, not four");
  assert.equal(withCredit.pace.medianDaysAfterInvoice, 7);
});

test("overdue counts what is still OWED, not what was once billed", () => {
  // € 900 of € 1.000 has been matched from the bank. The reminder mail and the pay-QR have always
  // asked for € 100; this panel said € 1.000 — a tenfold overstatement of the same debt.
  const b = clientPaymentBehaviour(
    [{ ...open("sent", "2026-07-01", 1000), amount_paid: 900 }],
    TODAY,
  );
  assert.ok(b.overdue);
  assert.equal(b.overdue.count, 1, "it IS still overdue — the remainder is late");
  assert.equal(b.overdue.amount, 100);
});

test("an invoice paid to the cent but not yet marked paid is € 0 overdue, not its full total", () => {
  const b = clientPaymentBehaviour(
    [{ ...open("sent", "2026-07-01", 1000), amount_paid: 1000 }],
    TODAY,
  );
  assert.ok(b.overdue, "the status still says it is out with the customer, so it is still listed");
  assert.equal(b.overdue.amount, 0, "…but there is nothing left to ask for");
});

test("an invoice with no amount_paid at all keeps exactly the number it always had", () => {
  // The regression guard: this field is optional, and a caller that never selected it must not
  // see its totals change.
  const b = clientPaymentBehaviour([open("sent", "2026-07-01", 363.5)], TODAY);
  assert.ok(b.overdue);
  assert.equal(b.overdue.amount, 363.5);
});
