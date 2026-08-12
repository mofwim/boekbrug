// [OFFERTE-BEWERKBAAR] Run: npx tsx --test src/lib/invoice-editable.test.ts
//
// The load-bearing test is the last group: a numbered document is never editable, whatever its
// type column says. Everything else here is convenience; that one is the legal boundary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvoiceEditable, isQuote, editRefusalText, sentEditBlockers } from "./invoice-editable";

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

// ─── [HERSTEL] Editing a sent invoice: every lock, and the honest null ──────────────────────────

const vrij = (): Parameters<typeof sentEditBlockers>[0] => ({
  status: 'sent', invoiceType: 'factuur', invoiceNumber: '20260006', direction: 'outgoing',
  amountPaid: 0, hasBankLink: false, hasCashLink: false, hasCreditnota: false,
  accountantStatus: null, quarterFiled: false,
})

test('[HERSTEL] a sent, untouched factuur may be edited — and an overdue one too', () => {
  assert.deepEqual(sentEditBlockers(vrij()), [])
  assert.deepEqual(sentEditBlockers({ ...vrij(), status: 'overdue' }), [])
})

test('[HERSTEL] every attachment locks it, each with its own reason', () => {
  const cases: Array<[Partial<ReturnType<typeof vrij>>, string]> = [
    [{ status: 'paid' }, 'paid'],
    [{ amountPaid: 12.5 }, 'paid'],
    [{ hasBankLink: true }, 'bank-linked'],
    [{ hasCashLink: true }, 'cash-linked'],
    [{ hasCreditnota: true }, 'credited'],
    [{ accountantStatus: 'verwerkt' }, 'accountant'],
    [{ quarterFiled: true }, 'quarter-filed'],
    [{ direction: 'incoming' }, 'incoming'],
    [{ invoiceType: 'creditnota' }, 'not-invoice'],
    [{ invoiceNumber: null }, 'not-invoice'],
    [{ status: 'draft' }, 'not-sent'],
  ]
  for (const [over, code] of cases) {
    const blockers = sentEditBlockers({ ...vrij(), ...over })
    assert.ok(blockers.some((b) => b.code === code),
      `${JSON.stringify(over)} should block with "${code}", got ${JSON.stringify(blockers.map((b) => b.code))}`)
  }
})

test('[HERSTEL] a fact that could not be established BLOCKS — a hiccup is not permission', () => {
  for (const gap of ['amountPaid', 'hasBankLink', 'hasCashLink', 'hasCreditnota', 'quarterFiled'] as const) {
    const blockers = sentEditBlockers({ ...vrij(), [gap]: null })
    assert.ok(blockers.some((b) => b.code === 'unknown'), `${gap}=null must block`)
  }
})

test('[HERSTEL] half a cent of payment is not a payment — display rounding may not lock the door', () => {
  assert.deepEqual(sentEditBlockers({ ...vrij(), amountPaid: 0.004 }), [])
})

test('[HERSTEL] the draft rule did not move: a sent factuur is still NOT isInvoiceEditable', () => {
  // Two different doors on purpose. isInvoiceEditable guards the ORDINARY edit (draft/quote,
  // member-accessible, no delivery); sentEditBlockers guards the herstel edit (owner-only,
  // customer notified). A refactor that merges them hands members the herstel door.
  assert.equal(isInvoiceEditable({ status: 'sent', invoiceType: 'factuur', invoiceNumber: '20260006' }), false)
})
