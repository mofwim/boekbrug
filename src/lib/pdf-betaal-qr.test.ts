// [PDF-BETAAL-QR] Pure node test — run: npx tsx --test src/lib/pdf-betaal-qr.test.ts
//
// The decider for the scan-to-pay QR on the invoice PDF. The payload itself is buildEpcQrPayload's
// work (tested with epc-qr); these tests pin WHO gets a QR and what it asks for — the rules that
// keep a QR off an offerte (which must not demand payment), off a creditnota (money WE owe), and
// exactly equal to the printed total on a factuur.

import { test } from "node:test";
import assert from "node:assert/strict";

import { epcPayloadForInvoicePdf } from "./pdf-betaal-qr";

const IBAN = "NL91ABNA0417164300"; // the standard valid test IBAN

const invoice = (over: Record<string, unknown> = {}) => ({
  invoice_type: "factuur",
  invoice_number: "2026-0042",
  payment_reference: null,
  total_inc_btw: 630.15,
  ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  iban: IBAN,
  company_name: "Kiwi Food Market",
  full_name: "K. Iwi",
  ...over,
});

test("[PDF-BETAAL-QR] a factuur gets a QR asking exactly the invoice total, invoice number as kenmerk", () => {
  const qr = epcPayloadForInvoicePdf(invoice(), profile());
  assert.ok(qr, "expected a payload");
  assert.equal(qr!.amount, 630.15);
  const lines = qr!.payload.split("\n");
  assert.equal(lines[0], "BCD");
  assert.equal(lines[3], "SCT");
  assert.equal(lines[5], "Kiwi Food Market");
  assert.equal(lines[6], IBAN);
  assert.equal(lines[7], "EUR630.15");
  assert.ok(qr!.payload.includes("2026-0042"), "the kenmerk is the invoice number");
});

test("[PDF-BETAAL-QR] the invoice number outranks payment_reference — bank-matching reads the number back", () => {
  const qr = epcPayloadForInvoicePdf(invoice({ payment_reference: "KLANT-9" }), profile());
  assert.ok(qr!.payload.includes("2026-0042"));
  assert.ok(!qr!.payload.includes("KLANT-9"));
  // …and the fallback exists for a document without a number yet (the pre-send preview).
  const fallback = epcPayloadForInvoicePdf(invoice({ invoice_number: null, payment_reference: "KLANT-9" }), profile());
  assert.ok(fallback!.payload.includes("KLANT-9"));
});

test("[PDF-BETAAL-QR] a creditnota and an offerte never carry a payment QR", () => {
  // A creditnota's total is money the OWNER owes; an offerte must not demand payment at all.
  assert.equal(epcPayloadForInvoicePdf(invoice({ invoice_type: "creditnota", total_inc_btw: -630.15 }), profile()), null);
  assert.equal(epcPayloadForInvoicePdf(invoice({ invoice_type: "pro_forma" }), profile()), null);
  assert.equal(epcPayloadForInvoicePdf(invoice({ invoice_type: "offerte" }), profile()), null);
});

test("[PDF-BETAAL-QR] no amount, no IBAN or no name → no QR, never an error", () => {
  assert.equal(epcPayloadForInvoicePdf(invoice({ total_inc_btw: 0 }), profile()), null);
  assert.equal(epcPayloadForInvoicePdf(invoice({ total_inc_btw: -5 }), profile()), null);
  assert.equal(epcPayloadForInvoicePdf(invoice({ total_inc_btw: Number.NaN }), profile()), null);
  assert.equal(epcPayloadForInvoicePdf(invoice(), profile({ iban: null })), null);
  assert.equal(epcPayloadForInvoicePdf(invoice(), profile({ iban: "NL00FOUT0000000000" })), null);
  assert.equal(epcPayloadForInvoicePdf(invoice(), profile({ company_name: null, full_name: null })), null);
});

test("[PDF-BETAAL-QR] the company name falls back to the person's name — a zzp'er without a handelsnaam still gets paid", () => {
  const qr = epcPayloadForInvoicePdf(invoice(), profile({ company_name: null }));
  assert.ok(qr);
  assert.equal(qr!.payload.split("\n")[5], "K. Iwi");
});
