// [OFFERTE-BEWERKBAAR] Run: npx tsx --test src/lib/invoice-editable.test.ts
//
// The load-bearing test is the last group: a numbered document is never editable, whatever its
// type column says. Everything else here is convenience; that one is the legal boundary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvoiceEditable, isQuote, editRefusalText } from "./invoice-editable";

const doc = (over: Partial<Parameters<typeof isInvoiceEditable>[0]> = {}) => ({
  status: "draft", invoiceType: "factuur", invoiceNumber: null, ...over,
});

test("a draft is editable, as it always was", () => {
  assert.equal(isInvoiceEditable(doc()), true);
  assert.equal(isInvoiceEditable(doc({ invoiceType: "pro_forma" })), true);
  assert.equal(isInvoiceEditable(doc({ invoiceType: "creditnota" })), true);
});

test("a SENT quote is editable — this is the whole point", () => {
  // An offerte is a price quote: no number, no series, not a legal invoice. A customer asking
  // "can you do it for less?" is ordinary business, and until now the owner's only route was to
  // make a second offerte and hope the customer looked at the right one.
  assert.equal(isInvoiceEditable(doc({ status: "sent", invoiceType: "pro_forma" })), true);
  assert.equal(isInvoiceEditable(doc({ status: "sent", invoiceType: "offerte" })), true);
});

test("a sent FACTUUR is never editable", () => {
  // Art. 35 Wet OB: a legal number from a gapless, forward-only series. Editing it is not a
  // correction, it is rewriting a document the customer already holds — that is a creditnota.
  assert.equal(isInvoiceEditable(doc({ status: "sent", invoiceNumber: "2026-014" })), false);
  assert.equal(isInvoiceEditable(doc({ status: "paid", invoiceNumber: "2026-014" })), false);
  assert.equal(isInvoiceEditable(doc({ status: "sent", invoiceType: "creditnota", invoiceNumber: "C-3" })), false);
});

test("a quote that carries a NUMBER is not editable, whatever the type column says", () => {
  // The load-bearing one. Sending a quote CONVERTS it (invoice_type becomes 'factuur'), so the
  // type alone would normally refuse. But a row holding a number while still typed as a quote is
  // a legally issued document regardless — two conditions, so no single wrong field unlocks it.
  assert.equal(isInvoiceEditable({ status: "sent", invoiceType: "pro_forma", invoiceNumber: "2026-014" }), false);
  assert.equal(isInvoiceEditable({ status: "sent", invoiceType: "offerte", invoiceNumber: "  2026-014  " }), false);
});

test("an empty-string number is no number", () => {
  assert.equal(isInvoiceEditable({ status: "sent", invoiceType: "pro_forma", invoiceNumber: "" }), true);
  assert.equal(isInvoiceEditable({ status: "sent", invoiceType: "pro_forma", invoiceNumber: "   " }), true);
});

test("an archived quote is still not editable once it has a number, and is when it has none", () => {
  // Converting from the new-invoice screen archives the ORIGINAL offerte. It keeps no number, so
  // by this rule it stays editable — which is right: the factuur that replaced it is a different
  // row, and the archived quote is a record of what was offered, not of what was invoiced.
  assert.equal(isInvoiceEditable({ status: "archived", invoiceType: "pro_forma", invoiceNumber: null }), true);
  assert.equal(isInvoiceEditable({ status: "archived", invoiceType: "factuur", invoiceNumber: "2026-01" }), false);
});

test("isQuote knows both spellings the column holds", () => {
  // invoices.invoice_type accepts BOTH 'pro_forma' and 'offerte' (database.sql CHECK), and the
  // draft route stores a quote as 'pro_forma' while older rows carry 'offerte'.
  assert.equal(isQuote("pro_forma"), true);
  assert.equal(isQuote("offerte"), true);
  assert.equal(isQuote("factuur"), false);
  assert.equal(isQuote("creditnota"), false);
  assert.equal(isQuote(null), false);
  assert.equal(isQuote(undefined), false);
});

test("the refusal names which wall you hit, because the actions differ", () => {
  assert.equal(editRefusalText(doc()), "", "nothing to say when it IS editable");
  assert.match(
    editRefusalText({ status: "sent", invoiceType: "factuur", invoiceNumber: "2026-1" }),
    /verstuurde factuur/,
  );
  assert.match(
    editRefusalText({ status: "sent", invoiceType: "pro_forma", invoiceNumber: "2026-1" }),
    /offerte heeft al een factuurnummer/,
    "a quote that was converted needs a different sentence from an ordinary sent invoice",
  );
});
