// [PARTIAL-PAY] The row the payment↔invoice join table gets written with, under test.
// Run: npx tsx --test src/lib/bank-tx-links.test.ts
//
// bank-tx-links.ts had no behavioural test — only a source-level gate. Everything in it does I/O
// except one decision, and that decision is the one the money invariant rests on:
//
//     invoices.amount_paid = SUM(coalesce(amount_applied, 0)) over the surviving links
//
// recompute_invoice_amount_paid re-derives that on EVERY unlink and EVERY undo. So whether this
// function writes a number or a NULL is not bookkeeping decoration. The file says what a NULL
// costs, in its own words: an invoice "settled €600 by this payment silently drops to amount_paid
// 0 and re-opens at its full total, back into the reminder flow, while the bank line still says
// 'matched' and the €600 really did arrive."
//
// buildPaymentLinkRows was extracted from recordPaymentLinks for this test and nothing else — the
// logic is character-for-character what the function already did.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPaymentLinkRows } from "./bank-tx-links";

const U = "user-1";
const T = "tx-1";

test("[PARTIAL-PAY] a real applied amount is written as a figure, rounded once", () => {
  // The happy path is the important one: this number IS the invoice's amount_paid after the next
  // recompute. round2 is the repo's only rounding, so a half-cent resolves the same way here as
  // everywhere else money is added up.
  const [row] = buildPaymentLinkRows(U, T, ["inv-1"], { "inv-1": 600 });
  assert.equal(row.amount_applied, 600);

  const [rounded] = buildPaymentLinkRows(U, T, ["inv-1"], { "inv-1": 600.005 });
  assert.equal(rounded.amount_applied, 600.01, "the applied amount was not rounded through round2");
});

test("[PARTIAL-PAY] an unknown amount is NULL, and that is deliberate", () => {
  // NULL means "we do not know what was applied" and is the pre-partial-pay behaviour. It is the
  // honest answer for a link whose amount genuinely is not known — and it is also the value that
  // re-opens an invoice, so it must never be reached by accident.
  const [row] = buildPaymentLinkRows(U, T, ["inv-1"]);
  assert.equal(row.amount_applied, null);
  assert.equal(buildPaymentLinkRows(U, T, ["inv-1"], {})[0].amount_applied, null);
  assert.equal(buildPaymentLinkRows(U, T, ["inv-1"], { "inv-1": null })[0].amount_applied, null);
  assert.equal(buildPaymentLinkRows(U, T, ["inv-1"], { "inv-1": undefined })[0].amount_applied, null);
});

test("[PARTIAL-PAY] zero and negative are not amounts, they are absences", () => {
  // A €0 application is not "nothing was applied to a settled invoice" — it is a value nobody can
  // act on. Writing 0 would assert that this payment settled nothing, which is a claim; NULL says
  // we do not know, which is true. A negative applied amount is not a thing a payment does.
  for (const v of [0, -0, -1, -600]) {
    const [row] = buildPaymentLinkRows(U, T, ["inv-1"], { "inv-1": v });
    assert.equal(row.amount_applied, null, `${v} was written as an applied amount`);
  }
});

test("[PARTIAL-PAY] an unreadable amount never reaches the join table", () => {
  // NaN and Infinity are what arithmetic on a half-read figure produces. Either one stored here
  // would poison SUM(amount_applied) for the whole invoice.
  for (const v of [NaN, Infinity, -Infinity]) {
    const [row] = buildPaymentLinkRows(U, T, ["inv-1"], { "inv-1": v as number });
    assert.equal(row.amount_applied, null, `${v} was written as an applied amount`);
  }
});

test("[PARTIAL-PAY] one invoice gets one row, however often it is named", () => {
  // The upsert is keyed on (transaction_id, invoice_id), so a duplicate would collide rather than
  // double-count — but sending it twice hides a caller bug, and the dedup is what keeps the row
  // count equal to the invoice count a caller thinks it passed.
  const rows = buildPaymentLinkRows(U, T, ["inv-1", "inv-2", "inv-1"], { "inv-1": 100, "inv-2": 50 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.invoice_id).sort(), ["inv-1", "inv-2"]);
});

test("[PARTIAL-PAY] an empty id is dropped rather than written", () => {
  // A row with an empty invoice_id links a payment to nothing and would still be counted by any
  // reader that trusts the row count.
  const rows = buildPaymentLinkRows(U, T, ["", "inv-1"], { "inv-1": 100 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoice_id, "inv-1");
});

test("[PARTIAL-PAY] nothing to link produces no rows at all", () => {
  // recordPaymentLinks returns true early on this, so an empty list must never become a write.
  assert.deepEqual(buildPaymentLinkRows(U, T, []), []);
  assert.deepEqual(buildPaymentLinkRows(U, T, ["", ""]), []);
});

test("[PARTIAL-PAY] each row carries the owner and the transaction it belongs to", () => {
  // user_id is how the row is scoped; a row written without it is either invisible to the owner
  // or visible to someone else. transaction_id is what a reversal reverses by.
  const rows = buildPaymentLinkRows(U, T, ["inv-1", "inv-2"], { "inv-1": 10, "inv-2": 20 });
  for (const r of rows) {
    assert.equal(r.user_id, U);
    assert.equal(r.transaction_id, T);
  }
});

test("[PARTIAL-PAY] a split payment keeps each invoice's own share", () => {
  // The case the amount exists for: one bank line settling three invoices. Each link must carry
  // its own share, because the sum of these is what the invoice's amount_paid becomes.
  const rows = buildPaymentLinkRows(U, T, ["a", "b", "c"], { a: 100, b: 250.5, c: 49.5 });
  assert.deepEqual(
    rows.map((r) => [r.invoice_id, r.amount_applied]),
    [["a", 100], ["b", 250.5], ["c", 49.5]],
  );
  assert.equal(rows.reduce((s, r) => s + (r.amount_applied ?? 0), 0), 400);
});
