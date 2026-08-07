// [GELD-INVARIANT] Pure node test — run: npx tsx --test src/lib/money-invariants.test.ts
//
// An audit is only worth running if you believe it, and belief breaks in two directions. It must
// find the real thing (a euro booked twice, a creditnota adding where it should subtract), and it
// must stay quiet about the ordinary (an invoice paid by hand, a figure that is simply absent).
// A false alarm on a healthy administration is not a small cost: it is how the next real finding
// gets ignored.
//
// So these tests come in pairs — the violation, and the innocent case that looks just like it.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findMoneyViolations,
  moneyAuditHeadline,
  type InvoiceRow,
  type LinkRow,
} from "./money-invariants";

const inv = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: "i1",
  invoiceNumber: "2026-0042",
  direction: "incoming",
  status: "received",
  invoiceType: "factuur",
  totalExBtw: 100,
  btwAmount: 21,
  totalIncBtw: 121,
  amountPaid: 0,
  ...over,
});

const link = (over: Partial<LinkRow> = {}): LinkRow => ({
  transactionId: "t1",
  invoiceId: "i1",
  amountApplied: 121,
  ...over,
});

const kinds = (v: ReturnType<typeof findMoneyViolations>) => v.map((x) => x.kind);

// ── A clean administration must be silent ────────────────────────────

test("[GELD-INVARIANT] books that add up produce nothing at all", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link()],
    transactions: [{ id: "t1", amount: -121 }],
  });
  assert.deepEqual(v, []);
  assert.match(moneyAuditHeadline(v), /kloppen met zichzelf/);
});

test("[GELD-INVARIANT] an invoice paid BY HAND has no links, and that is not a finding", () => {
  // pay-toggle books a payment with no bank line at all. An audit that flagged those would fire on
  // every cash purchase in the country — and then nobody reads the one that matters.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [],
  });
  assert.deepEqual(v, []);
});

test("[GELD-INVARIANT] a pre-migration link (NULL amount) is not read as a missing payment", () => {
  // NULL means "settled its invoice in full" — reading it as €0 would report every old payment as
  // money that never arrived, on exactly the rows that are hardest to verify.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link({ amountApplied: null })],
  });
  assert.deepEqual(v, []);
});

test("[GELD-INVARIANT] a missing figure is absent, not wrong", () => {
  const v = findMoneyViolations({
    invoices: [inv({ totalExBtw: null, btwAmount: null, amountPaid: 0 })],
    links: [],
  });
  assert.deepEqual(kinds(v), [], "inventing a violation from a gap is how an audit stops being believed");
});

// ── amount_paid against the payments that exist ──────────────────────

test("[GELD-INVARIANT] money booked as paid that no payment covers", () => {
  // Deliberately status 'paid': otherwise this fixture is ALSO a fully-covered-but-open invoice,
  // and it would report two findings. That is correct behaviour — an invoice can be wrong in more
  // than one way at once — but it makes a poor test of one rule. Written out because the first
  // version of this test asserted a single finding and failed, which is how the direction-aware
  // wording below was found.
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link({ amountApplied: 50 })],
  });
  assert.deepEqual(kinds(v), ["paid_without_payments"]);
  assert.equal(v[0].euros, 71);
  assert.match(v[0].message, /71,00/);
});

test("[GELD-INVARIANT] one invoice can be wrong in two ways, and both are reported", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "received", amountPaid: 121 })],
    links: [link({ amountApplied: 50 })],
  });
  assert.deepEqual(kinds(v).sort(), ["paid_without_payments", "status_open_but_covered"]);
});

test("[GELD-INVARIANT] the consequence of paid-but-open differs by direction, so the sentence does", () => {
  // On a purchase invoice, "you are still reminding someone who paid" is nonsense — the real risk
  // is that the owner pays it a SECOND time. One sentence for both would be vague about exactly
  // the part that matters.
  const inkoop = findMoneyViolations({
    invoices: [inv({ direction: "incoming", status: "received", amountPaid: 121 })],
    links: [],
  });
  assert.match(inkoop[0].message, /twee keer/);
  const verkoop = findMoneyViolations({
    invoices: [inv({ direction: "outgoing", status: "sent", amountPaid: 121 })],
    links: [],
  });
  assert.match(verkoop[0].message, /al betaald heeft/);
});

test("[GELD-INVARIANT] payments booked that the invoice does not show", () => {
  const v = findMoneyViolations({
    invoices: [inv({ amountPaid: 50 })],
    links: [link({ amountApplied: 121 })],
  });
  assert.deepEqual(kinds(v), ["payments_without_paid"]);
  assert.equal(v[0].euros, 71);
});

test("[GELD-INVARIANT] two payments on one invoice add up correctly", () => {
  const v = findMoneyViolations({
    invoices: [inv({ status: "paid", amountPaid: 121 })],
    links: [link({ transactionId: "t1", amountApplied: 60 }), link({ transactionId: "t2", amountApplied: 61 })],
  });
  assert.deepEqual(v, [], "instalments are ordinary, not a defect");
});

test("[GELD-INVARIANT] more paid than the invoice is worth", () => {
  const v = findMoneyViolations({
    invoices: [inv({ amountPaid: 200, status: "paid" })],
    links: [link({ amountApplied: 200 })],
  });
  assert.ok(kinds(v).includes("overpaid"));
  assert.equal(v.find((x) => x.kind === "overpaid")!.euros, 79);
});

test("[GELD-INVARIANT] a negative paid amount cannot exist", () => {
  const v = findMoneyViolations({ invoices: [inv({ amountPaid: -20 })], links: [] });
  assert.ok(kinds(v).includes("negative_paid"));
});

// ── The status against the amount ────────────────────────────────────

test("[GELD-INVARIANT] 'betaald' while money is still open", () => {
  const v = findMoneyViolations({ invoices: [inv({ status: "paid", amountPaid: 100 })], links: [] });
  assert.deepEqual(kinds(v), ["status_paid_but_open"]);
  assert.equal(v[0].euros, 21);
});

test("[GELD-INVARIANT] fully covered but still open — the invoice that chases someone who paid", () => {
  const v = findMoneyViolations({
    invoices: [inv({ direction: "outgoing", status: "sent", amountPaid: 121 })],
    links: [link()],
  });
  assert.deepEqual(kinds(v), ["status_open_but_covered"]);
  assert.match(v[0].message, /al betaald heeft/);
});

test("[GELD-INVARIANT] a draft or an archived invoice is not chasing anyone", () => {
  for (const status of ["draft", "archived"]) {
    const v = findMoneyViolations({ invoices: [inv({ status, amountPaid: 121 })], links: [link()] });
    assert.equal(
      kinds(v).includes("status_open_but_covered"),
      false,
      `${status} is deliberately out of the flow`,
    );
  }
});

// ── The invoice's own arithmetic — the figure the aangifte reads ─────

test("[GELD-INVARIANT] ex + btw must be inc, on what is actually STORED", () => {
  // The import gate checks this on the way in. This checks what ended up in the row, which is what
  // the BTW return reads — and those are not the same thing after a manual correction.
  const v = findMoneyViolations({
    invoices: [inv({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 130 })],
    links: [],
  });
  assert.ok(kinds(v).includes("btw_arithmetic"));
  assert.equal(v.find((x) => x.kind === "btw_arithmetic")!.euros, 9);
  assert.match(v[0].message, /staat in je aangifte/);
});

test("[GELD-INVARIANT] one cent of rounding is not a defect", () => {
  const v = findMoneyViolations({
    invoices: [inv({ totalExBtw: 100, btwAmount: 21, totalIncBtw: 121.01 })],
    links: [],
  });
  assert.equal(kinds(v).includes("btw_arithmetic"), false);
});

// ── The creditnota's sign — wrong twice, in the same direction ───────

test("[GELD-INVARIANT] a creditnota stored POSITIVE adds where it should subtract", () => {
  const v = findMoneyViolations({
    invoices: [inv({ invoiceType: "creditnota", totalExBtw: 100, btwAmount: 21, totalIncBtw: 121 })],
    links: [],
  });
  assert.ok(kinds(v).includes("creditnota_sign"));
  // Twice the amount, because it is on the wrong side: €121 added where €121 should come off.
  assert.equal(v.find((x) => x.kind === "creditnota_sign")!.euros, 242);
});

test("[GELD-INVARIANT] a correctly negative creditnota is silent", () => {
  const v = findMoneyViolations({
    invoices: [inv({ invoiceType: "creditnota", totalExBtw: -100, btwAmount: -21, totalIncBtw: -121, status: "paid", amountPaid: 121 })],
    links: [],
  });
  assert.equal(kinds(v).includes("creditnota_sign"), false);
});

// ── A payment cannot give more than it moved ─────────────────────────

test("[GELD-INVARIANT] a bank line spread over more than it carried", () => {
  const v = findMoneyViolations({
    invoices: [],
    links: [
      { transactionId: "t1", invoiceId: "a", amountApplied: 3000 },
      { transactionId: "t1", invoiceId: "b", amountApplied: 3200 },
    ],
    transactions: [{ id: "t1", amount: -5000 }],
  });
  assert.deepEqual(kinds(v), ["transaction_overallocated"]);
  assert.equal(v[0].euros, 1200);
});

test("[GELD-INVARIANT] a batch that exactly spends its line is fine", () => {
  const v = findMoneyViolations({
    invoices: [],
    links: [
      { transactionId: "t1", invoiceId: "a", amountApplied: 3000 },
      { transactionId: "t1", invoiceId: "b", amountApplied: 2000 },
    ],
    transactions: [{ id: "t1", amount: -5000 }],
  });
  assert.deepEqual(v, []);
});

test("[GELD-INVARIANT] transactions are only checked when they were passed in", () => {
  // A check that did not run must never read as one that passed.
  const v = findMoneyViolations({
    invoices: [],
    links: [{ transactionId: "t1", invoiceId: "a", amountApplied: 99_999 }],
  });
  assert.deepEqual(v, []);
});

// ── The headline, and the order ──────────────────────────────────────

test("[GELD-INVARIANT] the biggest euros come first, and the headline names the total", () => {
  const v = findMoneyViolations({
    invoices: [
      inv({ id: "small", invoiceNumber: "A", status: "paid", amountPaid: 120 }),          // €1 open
      inv({ id: "big", invoiceNumber: "B", totalIncBtw: 5000, amountPaid: 5000, status: "paid", totalExBtw: 4132.23, btwAmount: 867.77 }),
      inv({ id: "huge", invoiceNumber: "C", totalIncBtw: 900, amountPaid: 4000, status: "paid", totalExBtw: 743.80, btwAmount: 156.20 }),
    ],
    links: [],
  });
  assert.ok(v.length >= 2);
  assert.equal(v[0].entityId, "huge", "€3.100 too much outranks €1 still open");
  for (let i = 1; i < v.length; i++) assert.ok(v[i - 1].euros >= v[i].euros);
  assert.match(moneyAuditHeadline(v), /verschillen gevonden, samen/);
});
