// [DUBBEL-GEDEKT] Pure node test — run: npx tsx --test src/lib/bank-auto-categorize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { paidInvoiceExplainsLine, type PaidExplainerRow } from "./bank-auto-categorize";

const paid = (over: Partial<PaidExplainerRow> = {}): PaidExplainerRow => ({
  direction: "incoming", total_inc_btw: 250, amount_paid: 250,
  payment_date: "2026-07-10", marked_paid_at: null, invoice_date: "2026-07-01",
  ...over,
});

test("[DUBBEL-GEDEKT] a hand-paid bill explains its own bank debit", () => {
  // The Sligro case from the audit: invoice marked paid by hand (or incasso-settled with no bank
  // line), the debit arrives days later, the matcher excludes paid invoices, and a confident
  // memory hit used to code it 'kosten' — the same cost twice. The guard sees it.
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-07-12"), true);
  // Direction is load-bearing: a CREDIT of the same magnitude is different money.
  assert.equal(paidInvoiceExplainsLine([paid()], 250, "2026-07-12"), false);
  // An outgoing sale explains a credit, not a debit.
  assert.equal(paidInvoiceExplainsLine([paid({ direction: "outgoing" })], 250, "2026-07-12"), true);
});

test("[DUBBEL-GEDEKT] the two-week window bounds the claim", () => {
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-07-24"), true, "day 14 still inside");
  assert.equal(paidInvoiceExplainsLine([paid()], -250, "2026-08-20"), false, "six weeks later is a different €250");
  // Settled date falls back through marked_paid_at → invoice_date.
  assert.equal(paidInvoiceExplainsLine([paid({ payment_date: null, marked_paid_at: "2026-07-10" })], -250, "2026-07-12"), true);
});

test("[DUBBEL-GEDEKT] a cent of difference is a different amount", () => {
  assert.equal(paidInvoiceExplainsLine([paid()], -250.01, "2026-07-12"), true, "one cent inside tolerance");
  assert.equal(paidInvoiceExplainsLine([paid()], -250.5, "2026-07-12"), false);
});

test("[DUBBEL-GEDEKT] undatable errs toward holding the line, never toward double-booking", () => {
  assert.equal(paidInvoiceExplainsLine([paid({ payment_date: null, marked_paid_at: null, invoice_date: null })], -250, "2026-07-12"), true);
  assert.equal(paidInvoiceExplainsLine([paid()], -250, null), true);
  assert.equal(paidInvoiceExplainsLine([], -250, "2026-07-12"), false, "no paid invoices, nothing to explain");
});
