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

// ── [E-FACTUUR] Three different supplies, all stored as 0% ────────────────────────────────────
//
// UBL has a separate code for each, and this exporter sent every one of them as Z (zero rated):
//
//   Z   a supply that IS taxed, at 0% — an export, an intracommunautaire levering;
//   E   exempt, art. 11 Wet OB — care, education, insurance. Not a rate at all;
//   AE  reverse charge — the buyer owes the BTW.
//
// Z is the one that tells the receiving system "taxable, rate zero". For an exempt physio or a
// reverse-charged subcontractor that is a different legal fact about the same money, and it is the
// fact the receiver has to book differently. Peppol also REFUSES E and AE without a reason
// (BR-E-10 / BR-AE-10), so this is not only a mis-statement — after the 2027/2028 mandate it is a
// document that never arrives.

test("[E-FACTUUR] an exempt line is category E with a reason, not Z", () => {
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 900, btw_amount: 0, total_inc_btw: 900 }),
    [line({ description: "Fysiotherapie", quantity: 1, unit_price: 900, line_total: 900, btw_rate: 0, vat_treatment: "exempt" })],
    supplier,
  );
  assert.match(xml, /<cbc:ID>E<\/cbc:ID>/, "art. 11 is an exemption, not a zero rate");
  assert.doesNotMatch(xml, /<cbc:ID>Z<\/cbc:ID>/, "and it must NOT also appear as zero-rated");
  assert.match(
    xml, /<cbc:TaxExemptionReason>Vrijgesteld van btw op grond van artikel 11 Wet OB 1968<\/cbc:TaxExemptionReason>/,
    "BR-E-10 requires a reason — without it a Peppol validator rejects the whole document",
  );
  // The order inside cac:TaxCategory is part of the schema, not a preference.
  assert.match(
    xml, /<cbc:Percent>0<\/cbc:Percent>\s*<cbc:TaxExemptionReason>[\s\S]*?<\/cbc:TaxExemptionReason>\s*<cac:TaxScheme>/,
    "TaxExemptionReason sits between Percent and TaxScheme",
  );
});

test("[E-FACTUUR] a reverse-charged line is AE, read from the owner's own words", () => {
  // Art. 35a lid 1 sub k Wet OB requires the invoice to SAY "btw verlegd". So an invoice that is
  // reverse-charged says so, and one that does not is not one — reading that is evidence, while
  // inferring it from a 0% rate would be a guess. Same regex as the aangifte's regime flag.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 5000, btw_amount: 0, total_inc_btw: 5000 }),
    [line({ description: "Metselwerk — btw verlegd", quantity: 1, unit_price: 5000, line_total: 5000, btw_rate: 0 })],
    supplier,
  );
  assert.match(xml, /<cbc:ID>AE<\/cbc:ID>/);
  assert.match(xml, /<cbc:TaxExemptionReason>Btw verlegd — artikel 12 lid 5 Wet OB 1968<\/cbc:TaxExemptionReason>/);
});

test("[E-FACTUUR] a genuine 0% line is still Z, and carries no reason", () => {
  // The untouched path. An export or an intracommunautaire levering IS taxed, at 0%, and BR-Z-*
  // has no exemption reason — adding one there would fail validation just as hard.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 1000, btw_amount: 0, total_inc_btw: 1000 }),
    [line({ description: "Levering naar Duitsland", quantity: 1, unit_price: 1000, line_total: 1000, btw_rate: 0 })],
    supplier,
  );
  assert.match(xml, /<cbc:ID>Z<\/cbc:ID>/);
  assert.doesNotMatch(xml, /TaxExemptionReason/, "a zero-rated supply has nothing to explain");
});

test("[E-FACTUUR] an ordinary taxed line is S — nothing about this changed", () => {
  const { xml } = buildInvoiceUbl(header(), [line()], supplier);
  assert.match(xml, /<cbc:ID>S<\/cbc:ID>/);
  assert.doesNotMatch(xml, /TaxExemptionReason/);
});

test("[E-FACTUUR] exempt and zero-rated on ONE invoice are two subtotals, not one merged 0%", () => {
  // Grouping per RATE merged these into a single €1.000 subtotal in whichever category came last,
  // and half the money landed under a code it does not belong to. BR-Z-08 and BR-E-08 each require
  // their category's taxable amount to equal the sum of the lines carrying it, so the merged
  // version is rejected as well as wrong.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 1000, btw_amount: 0, total_inc_btw: 1000 }),
    [
      line({ description: "Fysiotherapie", quantity: 1, unit_price: 500, line_total: 500, btw_rate: 0, vat_treatment: "exempt" }),
      line({ description: "Levering naar Duitsland", quantity: 1, unit_price: 500, line_total: 500, btw_rate: 0 }),
    ],
    supplier,
  );
  const subtotals = [...xml.matchAll(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/g)].map((m) => m[0]);
  assert.equal(subtotals.length, 2, "one subtotal per (rate, category), not per rate");
  const byCat = new Map(subtotals.map((s) => [/<cbc:ID>(\w+)<\/cbc:ID>/.exec(s)?.[1] ?? "", s]));
  assert.ok(byCat.has("E") && byCat.has("Z"), "both categories are present");
  for (const cat of ["E", "Z"]) {
    assert.match(
      byCat.get(cat)!, /<cbc:TaxableAmount[^>]*>500\.00<\/cbc:TaxableAmount>/,
      `${cat} carries exactly the €500 of its own lines`,
    );
  }
  // And the totals are untouched by the split — the same money, described correctly.
  assert.match(xml, /<cbc:TaxExclusiveAmount[^>]*>1000\.00<\/cbc:TaxExclusiveAmount>/);
  assert.match(xml, /<cbc:PayableAmount[^>]*>1000\.00<\/cbc:PayableAmount>/);
});

test("[E-FACTUUR] a line that charged BTW is never re-read as exempt or reverse-charged", () => {
  // "btw verlegd" in a description next to a 21% rate is a note about something else, or a
  // mistake. A line that charged BTW cannot also have shifted it.
  const { xml } = buildInvoiceUbl(
    header(),
    [line({ description: "Advies (zie ook: btw verlegd op de vorige factuur)", btw_rate: 21, vat_treatment: "exempt" })],
    supplier,
  );
  assert.match(xml, /<cbc:ID>S<\/cbc:ID>/);
  assert.doesNotMatch(xml, /<cbc:ID>(E|AE)<\/cbc:ID>/);
});

test("[E-FACTUUR] a deployment without the vat_treatment column behaves exactly as before", () => {
  // The route falls back to a narrower SELECT when the column does not exist, so lines arrive with
  // the field absent. Absent is not exempt.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 500, btw_amount: 0, total_inc_btw: 500 }),
    [{ description: "Dienst", quantity: 1, unit_price: 500, line_total: 500, btw_rate: 0 }],
    supplier,
  );
  assert.match(xml, /<cbc:ID>Z<\/cbc:ID>/);
});
