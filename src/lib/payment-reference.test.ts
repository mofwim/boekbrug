// [KENMERK-BEIDE] Pure node test — run: npx tsx --test src/lib/payment-reference.test.ts
//
// What one payment to a supplier quotes. Measured on a pension invoice that asks for BOTH numbers
// in its own words and charges interest when a payment cannot be allocated.

import { test } from "node:test";
import assert from "node:assert/strict";

import { paymentReferenceFor } from "./payment-reference";

test("[KENMERK-BEIDE] a creditor asking for two numbers gets two numbers", () => {
  // THE MEASURED CASE. Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf,
  // € 362,70. The paper says "onder vermelding van E100732098 / PN000037785" and, in its
  // Betalingscondities, "Bij betalingen dient u altijd uw werkgevernummer EN factuurnummer te
  // vermelden waarop uw betaling betrekking heeft."
  //
  // The old rule was `payment_reference ?? invoice_number` — so the moment a betalingskenmerk
  // existed, the document's own number was dropped and the transfer went out quoting half of
  // what was asked for.
  const ref = paymentReferenceFor({
    payment_reference: "E100732098",
    invoice_number: "PN000037785",
  });
  assert.match(ref, /E100732098/, "the werkgevernummer is there");
  assert.match(ref, /PN000037785/, "…and so is the factuurnummer, which used to be dropped");

  // Both tokens must survive the round-trip through our OWN bank importer, or the debit can never
  // be matched back to the invoice it paid. extractInvoiceReference matches [A-Z]{0,3}\d{3,}[A-Z0-9]*
  // — a shape both of these satisfy, whatever separator sits between them.
  const tokens = ref.match(/\b[A-Z]{0,3}\d{3,}[A-Z0-9]*\b/g) ?? [];
  assert.equal(tokens.length, 2, "our own importer reads both numbers back off the statement");

  // The EPC unstructured remittance is capped at 140. This is nowhere near it, and the check
  // exists so a future longer pair cannot silently overflow into a truncated payment.
  assert.ok(ref.length <= 140, "fits the bank's remittance field");
});

test("[KENMERK-BEIDE] one number when there is only one", () => {
  assert.equal(paymentReferenceFor({ invoice_number: "2026-014", payment_reference: null }), "2026-014");
  assert.equal(paymentReferenceFor({ invoice_number: null, payment_reference: "ACC-99" }), "ACC-99");
  assert.equal(paymentReferenceFor({ invoice_number: "  2026-014  ", payment_reference: "   " }), "2026-014",
    "whitespace is not a second identifier");
  assert.equal(paymentReferenceFor({}), "", "nothing to quote is an empty reference, never 'null'");
  assert.equal(paymentReferenceFor({ invoice_number: null, payment_reference: null }), "");
});

test("[KENMERK-BEIDE] never the same number twice", () => {
  // A supplier whose betalingskenmerk IS the invoice number. Printing it twice on the transfer
  // makes the remittance look like two documents were paid.
  assert.equal(paymentReferenceFor({ invoice_number: "2026-014", payment_reference: "2026-014" }), "2026-014");
  // Same number, written differently. Separators and case are not a second identifier.
  assert.equal(paymentReferenceFor({ invoice_number: "PN-000037785", payment_reference: "pn000037785" }), "pn000037785");

  // The kenmerk already spells out both — which is what a supplier who prints
  // "E100732098 / PN000037785" as ONE betalingskenmerk gives us. Appending the invoice number
  // again would put it on the transfer twice.
  const both = paymentReferenceFor({
    payment_reference: "E100732098 / PN000037785",
    invoice_number: "PN000037785",
  });
  assert.equal(both, "E100732098 / PN000037785");
  assert.equal((both.match(/PN000037785/g) ?? []).length, 1, "the invoice number appears once");

  // …and the other way round: the invoice number contains the kenmerk.
  assert.equal(paymentReferenceFor({ invoice_number: "E100732098-2026", payment_reference: "E100732098" }),
    "E100732098-2026");
});

test("[KENMERK-BEIDE] the composition is stable and bank-safe", () => {
  const ref = paymentReferenceFor({ payment_reference: "E100732098", invoice_number: "PN000037785" });
  // Deterministic: the same invoice must produce the same remittance every time, or a re-issued
  // QR would not match the one the owner already scanned.
  assert.equal(ref, paymentReferenceFor({ payment_reference: "E100732098", invoice_number: "PN000037785" }));
  // Kenmerk first — the order the invoices themselves print, and the order a creditor keying on
  // its own reference finds it. Nothing depends on it; both readers scan the whole string.
  assert.ok(ref.indexOf("E100732098") < ref.indexOf("PN000037785"));
  // No newline or control character may reach an EPC payload: line 11 is delimited by newlines,
  // so one in the reference would forge extra fields.
  assert.doesNotMatch(ref, /[\r\n\t]/);
});
