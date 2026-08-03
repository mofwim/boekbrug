// [UBL-CREDIT] Pure node test — run: npx tsx --test src/lib/ubl-export.test.ts
//
// WHY THIS TEST EXISTS
//
// The exporter performs a SIGN TRANSFORMATION and nothing asserted it. In this app a creditnota is
// stored NEGATIVE — that is the whole point of [CREDIT-SIGN], and three independent systems read
// that sign to know the money runs the other way. UBL says the opposite: a credit note carries
// POSITIVE amounts, and the direction is conveyed by InvoiceTypeCode 381 (UNCL 1001).
//
// So buildInvoiceUbl flips every amount to its magnitude for a creditnota, and only for one. That
// is exactly the kind of line a later refactor removes as "redundant abs()", and the result would
// be an outbound legal document with negative amounts under a credit-note code — booked wrong in
// the customer's accounting system, by us, with nothing on our side ever showing it.
//
// ubl-unit.test.ts covers unit codes. The type code and the sign were covered by nothing.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceUbl, type UblInvoiceHeader, type UblInvoiceLine, type UblSupplier } from "./ubl-export";

const supplier: UblSupplier = {
  company_name: "Kiwi Supermarkt B.V.", full_name: "M. Eigenaar", kvk_number: "76895009",
  btw_number: "NL860918002B01", iban: "NL65RABO0171136276",
  address: "Verdiplein 13", postal_code: "5049 NM", city: "Tilburg",
};

const header = (over: Partial<UblInvoiceHeader> = {}): UblInvoiceHeader => ({
  invoice_number: "20260046", invoice_date: "2026-08-03", due_date: "2026-09-02",
  invoice_type: "factuur",
  total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121,
  client_name: "Klant B.V.", client_address: "Straat 1", client_postal_code: "1000 AA",
  client_city: "Amsterdam", client_btw_number: "NL001234567B01",
  ...over,
});

const line = (over: Partial<UblInvoiceLine> = {}): UblInvoiceLine => ({
  description: "Advies", quantity: 2, unit_price: 50, line_total: 100, btw_rate: 21,
  ...over,
} as UblInvoiceLine);

/** Every number that appears inside an <cbc:…Amount> element. */
function amounts(xml: string): number[] {
  return [...xml.matchAll(/<cbc:[A-Za-z]*Amount[^>]*>(-?[\d.]+)<\/cbc:[A-Za-z]*Amount>/g)].map((m) => Number(m[1]));
}

test("[UBL-CREDIT] an ordinary invoice is type 380 and untouched", () => {
  const { xml } = buildInvoiceUbl(header(), [line()], supplier);
  assert.match(xml, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/, "a factuur is a commercial invoice");
  const nums = amounts(xml);
  assert.ok(nums.length > 0, "no amounts found — the extraction broke, not the export");
  assert.ok(nums.every((n) => n >= 0), `an ordinary invoice must not gain a minus: ${nums.join(", ")}`);
  assert.ok(nums.includes(121), "the gross must still be there in full");
});

test("[UBL-CREDIT] a creditnota is type 381 and carries POSITIVE amounts", () => {
  // Stored the way this app stores one: everything negative. UBL wants the mirror image.
  const { xml } = buildInvoiceUbl(
    header({ invoice_type: "creditnota", invoice_number: "CR-20260003", total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }),
    [line({ quantity: -2, unit_price: -50, line_total: -100 })],
    supplier,
  );
  assert.match(xml, /<cbc:InvoiceTypeCode>381<\/cbc:InvoiceTypeCode>/, "a creditnota must be UNCL 1001 code 381");
  const nums = amounts(xml);
  assert.ok(nums.length > 0, "no amounts found — the extraction broke, not the export");
  assert.ok(
    nums.every((n) => n >= 0),
    `a UBL credit note must be positive; the direction is the type code, not the sign: ${nums.join(", ")}`,
  );
  assert.ok(nums.includes(121), "the magnitude must survive the flip — not just the sign");
});

test("[UBL-CREDIT] the flipped document still adds up", () => {
  // The flip is per-field. If it ever became something cleverer, the totals could stop reconciling
  // while every individual number still looked right.
  const { xml, warnings } = buildInvoiceUbl(
    header({ invoice_type: "creditnota", invoice_number: "CR-20260004", total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }),
    [line({ quantity: -2, unit_price: -50, line_total: -100 })],
    supplier,
  );
  const ex = /<cbc:LineExtensionAmount[^>]*>([\d.]+)</.exec(xml);
  const tax = /<cbc:TaxAmount[^>]*>([\d.]+)</.exec(xml);
  const inc = /<cbc:TaxInclusiveAmount[^>]*>([\d.]+)</.exec(xml);
  assert.ok(ex && tax && inc, "the three totals must all be present");
  assert.ok(
    Math.abs(Number(ex![1]) + Number(tax![1]) - Number(inc![1])) < 0.005,
    `excl + btw must equal incl after the flip: ${ex![1]} + ${tax![1]} ≠ ${inc![1]}`,
  );
  // And the stored negative header must not trip the cross-check: it compares magnitudes on purpose.
  assert.deepEqual(
    warnings.filter((w) => /differs from line sum/.test(w)), [],
    `a correctly stored creditnota produced a false mismatch warning: ${warnings.join(" | ")}`,
  );
});

test("[UBL-CREDIT] the sign rule applies to the creditnota and to nothing else", () => {
  // The narrow half. If the abs() ever escaped its branch, a NEGATIVE line on an ordinary invoice —
  // statiegeld, emballage, a returned crate — would silently become a positive charge to the
  // customer. That is money invented on an outbound document.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 96.14, btw_amount: 20.19, total_inc_btw: 116.33 }),
    [line(), line({ description: "Statiegeld retour", quantity: 1, unit_price: -3.86, line_total: -3.86, btw_rate: 21 })],
    supplier,
  );
  assert.match(xml, /Statiegeld retour/, "the return line must still be in the document");
  assert.match(
    xml, /<cbc:LineExtensionAmount[^>]*>-3\.86<\/cbc:LineExtensionAmount>/,
    "a negative line on an ordinary invoice must keep its minus — flipping it charges the customer for a credit",
  );
});
