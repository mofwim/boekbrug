// [BETAALPLAN] Pure node test — run: npx tsx --test src/lib/payment-plan.test.ts
//
// This module decides how much of a real bank payment lands on which invoice. Everything it gets
// wrong ends up in a BTW return, so the tests are organised by what the mistake would cost:
//
//   1. Booking money that does not exist (the sum guard) — the reason this module exists at all.
//   2. Booking it in the wrong DIRECTION — silent, and reports revenue that never arrived.
//   3. Getting the creditnota sign wrong — the detail that decides whether real batches work.
//   4. Swallowing the remainder — a wrong number with nothing to trace it back to.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolvePaymentPlan, settleableDirection, type PlanInvoice } from "./payment-plan";

const purchase = (id: string, total: number, paid = 0): PlanInvoice => ({
  id, direction: "incoming", invoiceType: "factuur", totalIncBtw: total, amountPaid: paid,
});
const sale = (id: string, total: number, paid = 0): PlanInvoice => ({
  id, direction: "outgoing", invoiceType: "factuur", totalIncBtw: total, amountPaid: paid,
});
const credit = (id: string, total: number): PlanInvoice => ({
  id, direction: "incoming", invoiceType: "creditnota", totalIncBtw: -Math.abs(total), amountPaid: 0,
});

// ── The everyday batch ───────────────────────────────────────────────

test("[BETAALPLAN] one debit settles three purchase invoices in full", () => {
  const invoices = [purchase("a", 1200), purchase("b", 800), purchase("c", 3000)];
  const r = resolvePaymentPlan({
    txAmount: -5000,
    invoices,
    lines: [
      { invoiceId: "a", amount: 1200 },
      { invoiceId: "b", amount: 800 },
      { invoiceId: "c", amount: 3000 },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.allocated, 5000);
  assert.equal(r.remainder, 0);
  assert.equal(r.remainderNote, null, "a fully explained payment says nothing extra");
  assert.ok(r.lines.every((l) => l.settlesInFull));
});

test("[BETAALPLAN] the last invoice of a batch is short-paid, and stays open for the rest", () => {
  // The case a one-invoice endpoint could not express at all.
  const r = resolvePaymentPlan({
    txAmount: -5000,
    invoices: [purchase("a", 1200), purchase("b", 800), purchase("c", 3200)],
    lines: [
      { invoiceId: "a", amount: 1200 },
      { invoiceId: "b", amount: 800 },
      { invoiceId: "c", amount: 3000 },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.remainder, 0, "the payment is fully spent");
  const c = r.lines.find((l) => l.invoiceId === "c")!;
  assert.equal(c.settlesInFull, false);
  assert.equal(c.remainingOnInvoice, 200, "€200 of invoice c is still owed");
});

test("[BETAALPLAN] an invoice already half paid can only take its remainder", () => {
  const r = resolvePaymentPlan({
    txAmount: -1000,
    invoices: [purchase("a", 1200, 700)], // €500 open
    lines: [{ invoiceId: "a", amount: 900 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "exceeds_invoice");
    assert.match(r.message, /500,00/, "the refusal names the real open balance");
  }
});

// ── 1. The sum guard ─────────────────────────────────────────────────

test("[BETAALPLAN] a plan may never book more than the payment moved", () => {
  // Each line is individually reasonable. Only the WHOLE is wrong — which is the entire reason
  // this module exists rather than N calls to a one-invoice endpoint.
  const r = resolvePaymentPlan({
    txAmount: -5000,
    invoices: [purchase("a", 3000), purchase("b", 3200)],
    lines: [
      { invoiceId: "a", amount: 3000 },
      { invoiceId: "b", amount: 3200 },
    ],
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "exceeds_payment");
    assert.match(r.message, /6\.200,00/);
    assert.match(r.message, /5\.000,00/, "and says how much there actually was");
  }
});

test("[BETAALPLAN] what earlier links already took is gone", () => {
  const r = resolvePaymentPlan({
    txAmount: -5000,
    alreadyAllocated: 4500,
    invoices: [purchase("a", 3000)],
    lines: [{ invoiceId: "a", amount: 800 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /500,00/, "only €500 of this line is left to give");
});

// ── 2. Direction ─────────────────────────────────────────────────────

test("[BETAALPLAN] money out settles purchases, money in settles sales", () => {
  assert.equal(settleableDirection(-1), "incoming");
  assert.equal(settleableDirection(1), "outgoing");
});

test("[BETAALPLAN] a debit against a SALES invoice is refused, never guessed", () => {
  // The dangerous one: it would report revenue that never arrived, and nothing downstream could
  // tell that it had not.
  const r = resolvePaymentPlan({
    txAmount: -1000,
    invoices: [sale("s", 1000)],
    lines: [{ invoiceId: "s", amount: 1000 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "wrong_direction");
    assert.match(r.message, /WEGGING/);
  }
});

test("[BETAALPLAN] a credit against a PURCHASE invoice is refused too", () => {
  const r = resolvePaymentPlan({
    txAmount: 1000,
    invoices: [purchase("p", 1000)],
    lines: [{ invoiceId: "p", amount: 1000 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /BINNENKWAM/);
});

test("[BETAALPLAN] a customer settles four sales invoices with one transfer", () => {
  const r = resolvePaymentPlan({
    txAmount: 2420,
    invoices: [sale("1", 605), sale("2", 605), sale("3", 605), sale("4", 605)],
    lines: ["1", "2", "3", "4"].map((id) => ({ invoiceId: id, amount: 605 })),
  });
  assert.ok(r.ok);
  assert.equal(r.allocated, 2420);
  assert.equal(r.remainder, 0);
});

// ── 3. The creditnota ────────────────────────────────────────────────

test("[BETAALPLAN] a creditnota is NEGATIVE, so €1.000 − €150 matches an €850 debit", () => {
  // The detail that decides whether batch booking is usable at all. Without it the owner has to
  // misstate one of the three numbers to make the screen accept reality.
  const r = resolvePaymentPlan({
    txAmount: -850,
    invoices: [purchase("inv", 1000), credit("cn", 150)],
    lines: [
      { invoiceId: "inv", amount: 1000 },
      { invoiceId: "cn", amount: 150 },
    ],
  });
  assert.ok(r.ok);
  assert.equal(r.allocated, 850, "1000 − 150 — exactly what the bank moved");
  assert.equal(r.remainder, 0);
  assert.equal(r.lines.find((l) => l.invoiceId === "cn")!.amount, -150, "the sign is the app's job, not the owner's");
  assert.equal(r.lines.find((l) => l.invoiceId === "inv")!.amount, 1000);
});

test("[BETAALPLAN] a creditnota is recognised by its negative total even without the type", () => {
  const untyped: PlanInvoice = { id: "cn", direction: "incoming", invoiceType: null, totalIncBtw: -75, amountPaid: 0 };
  const r = resolvePaymentPlan({
    txAmount: -925,
    invoices: [purchase("inv", 1000), untyped],
    lines: [{ invoiceId: "inv", amount: 1000 }, { invoiceId: "cn", amount: 75 }],
  });
  assert.ok(r.ok);
  assert.equal(r.allocated, 925);
});

// ── 4. The remainder is named, never swallowed ───────────────────────

test("[BETAALPLAN] money left over is reported, with its possible causes", () => {
  const r = resolvePaymentPlan({
    txAmount: -1000,
    invoices: [purchase("a", 988)],
    lines: [{ invoiceId: "a", amount: 988 }],
  });
  assert.ok(r.ok);
  assert.equal(r.remainder, 12);
  assert.match(r.remainderNote!, /12,00/);
  assert.match(r.remainderNote!, /bankkost|betaalkorting/, "it asks, it does not decide");
});

test("[BETAALPLAN] a fully explained payment adds no sentence at all", () => {
  const r = resolvePaymentPlan({
    txAmount: -988,
    invoices: [purchase("a", 988)],
    lines: [{ invoiceId: "a", amount: 988 }],
  });
  assert.ok(r.ok);
  assert.equal(r.remainderNote, null, "a note that is always there is a note nobody reads");
});

// ── Refusals that keep a plan honest ─────────────────────────────────

test("[BETAALPLAN] an empty plan books nothing", () => {
  const r = resolvePaymentPlan({ txAmount: -100, invoices: [purchase("a", 100)], lines: [] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "empty");
});

test("[BETAALPLAN] the same invoice twice is a mistake, not two payments", () => {
  const r = resolvePaymentPlan({
    txAmount: -1000,
    invoices: [purchase("a", 1000)],
    lines: [{ invoiceId: "a", amount: 400 }, { invoiceId: "a", amount: 600 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "duplicate_invoice");
});

test("[BETAALPLAN] zero, negative and nonsense amounts are refused", () => {
  for (const bad of [0, -50, Number.NaN, Infinity]) {
    const r = resolvePaymentPlan({
      txAmount: -1000,
      invoices: [purchase("a", 1000)],
      lines: [{ invoiceId: "a", amount: bad }],
    });
    assert.equal(r.ok, false, `${String(bad)} is not an amount`);
    if (!r.ok) assert.equal(r.reason, "not_positive");
  }
});

test("[BETAALPLAN] an invoice that vanished under the owner is refused, not skipped", () => {
  const r = resolvePaymentPlan({
    txAmount: -1000,
    invoices: [purchase("a", 1000)],
    lines: [{ invoiceId: "a", amount: 500 }, { invoiceId: "ghost", amount: 500 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unknown_invoice");
});

test("[BETAALPLAN] cents survive a long batch", () => {
  const invoices = Array.from({ length: 10 }, (_, i) => purchase(`i${i}`, 0.1));
  const r = resolvePaymentPlan({
    txAmount: -1,
    invoices,
    lines: invoices.map((i) => ({ invoiceId: i.id, amount: 0.1 })),
  });
  assert.ok(r.ok);
  assert.equal(r.allocated, 1, "ten times 0.1 is 1.00, not 0.9999999999999999");
  assert.equal(r.remainder, 0);
});

// ── The net must be positive — the hole the creditnota's minus sign opened ────
//
// The sign that makes a real batch expressible also lets a plan describe something that cannot
// have happened. Both shapes below passed every per-line check and every sum check, because their
// arithmetic is internally fine — it is simply about a world that does not exist.

test("[BETAALPLAN] a creditnota ALONE cannot be settled by a payment", () => {
  // What this used to return: ok, allocated −1.000, and "€1.850 left to divide" out of a payment
  // that moved €850. It also marked the creditnota settled by a payment unrelated to it.
  const r = resolvePaymentPlan({
    txAmount: -850,
    invoices: [credit("cn", 1000)],
    lines: [{ invoiceId: "cn", amount: 1000 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "not_positive");
    assert.match(r.message, /factuur bij staan die groter is/);
  }
});

test("[BETAALPLAN] an invoice cancelled out by an equal creditnota books nothing", () => {
  // Used to book BOTH as settled out of a payment that gave neither of them a cent.
  const r = resolvePaymentPlan({
    txAmount: -850,
    invoices: [purchase("f", 1000), credit("cn", 1000)],
    lines: [{ invoiceId: "f", amount: 1000 }, { invoiceId: "cn", amount: 1000 }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_positive");
});

test("[BETAALPLAN] offsetting a creditnota WITHOUT a bank line is a real act — just not this screen", () => {
  // Stated as a test so the refusal is not mistaken for a gap. An entrepreneur really does settle a
  // creditnota against an invoice with no money moving; it belongs on the invoice, not on a bank
  // payment, because here there is no line to hang it on.
  const r = resolvePaymentPlan({
    txAmount: 0,
    invoices: [purchase("f", 1000), credit("cn", 1000)],
    lines: [{ invoiceId: "f", amount: 1000 }, { invoiceId: "cn", amount: 1000 }],
  });
  assert.equal(r.ok, false);
});

test("[BETAALPLAN] and the ordinary batch with a credit still works exactly as before", () => {
  // The guard must not cost the case it was built around.
  const r = resolvePaymentPlan({
    txAmount: -850,
    invoices: [purchase("f", 1000), credit("cn", 150)],
    lines: [{ invoiceId: "f", amount: 1000 }, { invoiceId: "cn", amount: 150 }],
  });
  assert.ok(r.ok);
  assert.equal(r.allocated, 850);
});

test("[CREDITNOTA] a credit ALREADY on the line raises its budget, it does not lower it", () => {
  // alreadyAllocated is what earlier links took from this payment, and it is SIGNED for the same
  // reason `lines` are: a credit gave money TO the line. It was documented as a magnitude and read
  // through Math.abs, which is right for every ordinary link and backwards for a credit.
  //
  // The owner books the €150 credit of an €850 debit, closes the screen, and comes back to book
  // the €1.000 invoice. The line has €1.000 to give — 850 face plus the 150 the credit returned.
  const withCredit = resolvePaymentPlan({
    txAmount: -850,
    alreadyAllocated: -150,       // the credit, booked in an earlier visit
    invoices: [purchase("f", 1000)],
    lines: [{ invoiceId: "f", amount: 1000 }],
  });
  assert.ok(withCredit.ok, "the invoice must fit — read as +150 this refused a plan that is exactly right");
  assert.equal(withCredit.allocated, 1000);
  assert.equal(withCredit.remainder, 0, "and the line is then fully explained");

  // Read as a magnitude the budget came out at 700, so the same plan was refused by €300 — the
  // credit counted against the line twice.
  const asMagnitude = resolvePaymentPlan({
    txAmount: -850,
    alreadyAllocated: 150,
    invoices: [purchase("f", 1000)],
    lines: [{ invoiceId: "f", amount: 1000 }],
  });
  assert.equal(asMagnitude.ok, false, "a POSITIVE 150 still means 150 was taken — that budget really is 700");

  // An ordinary earlier link is unchanged: positive, and it lowers the budget.
  const ordinary = resolvePaymentPlan({
    txAmount: -5000,
    alreadyAllocated: 4500,
    invoices: [purchase("f", 600)],
    lines: [{ invoiceId: "f", amount: 600 }],
  });
  assert.equal(ordinary.ok, false, "600 does not fit in the 500 this line has left");
});
