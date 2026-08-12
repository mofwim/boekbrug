// [UBL-CREDIT] Pure node test — run: npx tsx --test src/lib/ubl-export.test.ts
//
// WHY THIS TEST EXISTS
//
// The exporter performs a SIGN TRANSFORMATION and nothing asserted it. In this app a creditnota is
// stored NEGATIVE — that is the whole point of [CREDIT-SIGN], and three independent systems read
// that sign to know the money runs the other way. UBL says the opposite: a credit note carries
// POSITIVE amounts, and the direction is conveyed by InvoiceTypeCode 381 (UNCL 1001).
//
// So buildInvoiceUbl flips the sign of every amount for a creditnota, and only for one. That is
// exactly the kind of line a later refactor removes as redundant, and the result would be an
// outbound legal document with negative amounts under a credit-note code — booked wrong in the
// customer's accounting system, by us, with nothing on our side ever showing it.
//
// [MIN-REGEL] It NEGATES; it does not take the magnitude. Those are the same thing only while every
// line runs the same way, and a creditnota of an invoice that contained a return does not — see the
// FLIPPED-not-absolute test below, which is a defect this file did not catch for as long as it has
// existed. The unit PRICE is the one field that IS a magnitude, because BR-27 says so.
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

test("[UBL-CREDIT] a creditnota is FLIPPED, not made absolute", () => {
  // [MIN-REGEL] The two are the same thing only while every line has the same sign, and a
  // creditnota of an invoice that contained a return does not: crediting the whole invoice
  // un-returns that line, so it sits among the negative ones as a POSITIVE amount
  // (creditnota-lines.ts). Math.abs() turned it the wrong way and the file credited it twice.
  //
  //   stored   -100,00  -50,00  +20,00  = -130,00
  //   abs()     100,00   50,00   20,00  =  170,00   what was sent
  //   negation  100,00   50,00  -20,00  =  130,00   what the header says
  //
  // Pre-dates the credit-line feature: a statiegeld or emballage line does exactly this.
  const { xml, warnings } = buildInvoiceUbl(
    header({ invoice_type: "creditnota", invoice_number: "CR-20260005", total_ex_btw: -130, btw_amount: -27.3, total_inc_btw: -157.3 }),
    [
      line({ description: "Levering", quantity: -2, unit_price: 50, line_total: -100 }),
      line({ description: "Uren", quantity: -1, unit_price: 50, line_total: -50 }),
      line({ description: "Statiegeld retour, teruggedraaid", quantity: 1, unit_price: 20, line_total: 20 }),
    ],
    supplier,
  );
  const lineAmounts = [...xml.matchAll(/<cbc:LineExtensionAmount[^>]*>(-?[\d.]+)</g)].map((m) => Number(m[1]));
  assert.equal(
    Math.round(lineAmounts.filter((n) => n !== 130).reduce((a, b) => a + b, 0) * 100) / 100, 130,
    `the lines must add up to what the header says, not to 170: ${lineAmounts.join(", ")}`,
  );
  assert.match(xml, /<cbc:TaxInclusiveAmount[^>]*>157\.30</, "and the customer is credited 157,30");
  assert.deepEqual(
    warnings.filter((w) => /differs from line sum/.test(w)), [],
    `the flip must reconcile with the header: ${warnings.join(" | ")}`,
  );
  // The price of that line stays positive — BR-27 does not care which document it is on.
  const prices = [...xml.matchAll(/<cbc:PriceAmount[^>]*>(-?[\d.]+)</g)].map((m) => Number(m[1]));
  assert.ok(prices.every((p) => p >= 0), `BR-27: ${prices.join(", ")}`);
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

// ── [MIN-REGEL] A credit line inside an ordinary invoice ──────────────────────────────────────
//
// Read off a real supplier invoice: ATAPACK Cash & Carry 26304787, 17-07-2026. Line AP290004 is
// "Credit over faktuur 26302362" — a return of 3 boxes of knoopzakken at € 23,95, settled on the
// next invoice instead of on a separate creditnota. Nine ordinary lines total € 173,03, the credit
// takes off € 71,85, and the document asks for € 101,18 + € 21,25 btw = € 122,43.
//
// The document stays a factuur (type 380). Only the LINE is negative, and EN 16931 BR-27 decides
// where that minus is allowed to be: in the quantity, never in the price.

/** Every PriceAmount in the file, as a number. BR-27 applies to each one of them. */
function priceAmounts(xml: string): number[] {
  return [...xml.matchAll(/<cbc:PriceAmount[^>]*>(-?[\d.]+)<\/cbc:PriceAmount>/g)].map((m) => Number(m[1]));
}

test("[MIN-REGEL] the ATAPACK credit line keeps its minus in the quantity", () => {
  const { xml } = buildInvoiceUbl(
    header({ invoice_number: "26304787", total_ex_btw: 101.18, btw_amount: 21.25, total_inc_btw: 122.43 }),
    [
      line({ description: "Knoopzakken HDPE — credit over faktuur 26302362", quantity: -3, unit_price: 23.95, line_total: -71.85 }),
      line({ description: "Houtskool Elly 2kg", quantity: 2, unit_price: 15.95, line_total: 31.9 }),
      line({ description: "Keukenrol Evo", quantity: 1, unit_price: 10.9, line_total: 10.9 }),
    ],
    supplier,
  );
  assert.match(xml, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/, "one credit line does not make it a creditnota");
  assert.match(
    xml, /<cbc:InvoicedQuantity[^>]*>-3<\/cbc:InvoicedQuantity>/,
    "the return is three pieces going back — the quantity is where UBL puts that",
  );
  assert.match(
    xml, /<cbc:LineExtensionAmount[^>]*>-71\.85<\/cbc:LineExtensionAmount>/,
    "and the line amount stays negative, or the customer is charged for a credit",
  );
  const prices = priceAmounts(xml);
  assert.equal(prices.length, 3, "one PriceAmount per line — the extraction must not have missed any");
  assert.ok(
    prices.every((p) => p >= 0),
    `BR-27: the item net price shall not be negative, so the access point refuses this file: ${prices.join(", ")}`,
  );
  assert.ok(prices.includes(23.95), "the price per piece is still the price per piece");
});

test("[MIN-REGEL] a minus typed into the price is moved to the quantity", () => {
  // The shape already sitting in the database. Before the line editor refused a negative price,
  // "Statiegeld retour" was typed as 1 × € −3,86 — the same money, in the one form Peppol rejects.
  // Nothing warns the owner: the PDF is right and the file simply never arrives.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 96.14, btw_amount: 20.19, total_inc_btw: 116.33 }),
    [line(), line({ description: "Statiegeld retour", quantity: 1, unit_price: -3.86, line_total: -3.86 })],
    supplier,
  );
  assert.ok(
    priceAmounts(xml).every((p) => p >= 0),
    `a stored negative price must not reach the file: ${priceAmounts(xml).join(", ")}`,
  );
  assert.match(xml, /<cbc:PriceAmount[^>]*>3\.86<\/cbc:PriceAmount>/, "the magnitude is kept");
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>-1<\/cbc:InvoicedQuantity>/, "and the minus moved to the quantity");
  assert.match(
    xml, /<cbc:LineExtensionAmount[^>]*>-3\.86<\/cbc:LineExtensionAmount>/,
    "R120 checks quantity × price against this — −1 × 3,86 must still be −3,86",
  );
});

test("[MIN-REGEL] a credit line with a fractional price takes the BaseQuantity form", () => {
  // The fallback branch: 16 × 2,0208 does not reproduce −32,33 from a rounded price, so the price
  // is expressed per line. That branch used to write the line total straight into PriceAmount,
  // which on a credit line is negative — BR-27 again, on exactly the lines that need this form.
  const { xml } = buildInvoiceUbl(
    header({ total_ex_btw: 67.67, btw_amount: 14.21, total_inc_btw: 81.88 }),
    [
      line({ description: "Levering", quantity: 1, unit_price: 100, line_total: 100 }),
      line({ description: "Magnetronbak — retour", quantity: -16, unit_price: 2.0208, line_total: -32.33 }),
    ],
    supplier,
  );
  const prices = priceAmounts(xml);
  assert.ok(prices.every((p) => p >= 0), `BR-27 in the fallback branch too: ${prices.join(", ")}`);
  assert.match(xml, /<cbc:PriceAmount[^>]*>32\.33<\/cbc:PriceAmount>/, "the price is the magnitude of the line");
  assert.match(
    xml, /<cbc:BaseQuantity[^>]*>16<\/cbc:BaseQuantity>/,
    "PEPPOL-EN16931-R121: the base quantity must be a positive number above zero",
  );
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>-16<\/cbc:InvoicedQuantity>/);
  // (−16 ÷ 16) × 32,33 = −32,33 — the same figure the line reports, with its sign.
  assert.match(xml, /<cbc:LineExtensionAmount[^>]*>-32\.33<\/cbc:LineExtensionAmount>/);
});

test("[MIN-REGEL] an ordinary line is emitted exactly as it was before", () => {
  // The narrow half. The sign normalization must be invisible to every invoice that has no credit
  // line — which is almost all of them.
  const { xml } = buildInvoiceUbl(header(), [line()], supplier);
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>2<\/cbc:InvoicedQuantity>/);
  assert.match(xml, /<cbc:PriceAmount[^>]*>50\.00<\/cbc:PriceAmount>/);
  assert.doesNotMatch(xml, /<cbc:BaseQuantity/, "a round price needs no base quantity");
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

// ─── [KLANT-EXTRA] The three free lines under the customer's name, in the XML too ──────────────
//
// The PDF prints them directly under the name; a customer that requires "t.a.v." or a
// purchase-order reference on the paper requires it on the e-factuur just the same — their
// system books the invoice against exactly that reference. EN 16931 gives a buyer address two
// slots beyond the street: BT-51 (AdditionalStreetName) and BT-163 (one cac:AddressLine). Line 1
// takes BT-51; lines 2 and 3 share BT-163. And UBL 2.1 fixes the ORDER inside PostalAddress —
// AddressLine before Country — so that is asserted, not assumed: on the wrong spot the file is
// not schema-valid and bounces at the access point.

test("[KLANT-EXTRA] the extra lines land in the buyer address, in schema order", () => {
  const { xml } = buildInvoiceUbl(
    header({
      client_extra_line1: "t.a.v. Floor van Berkel",
      client_extra_line2: "Projectnummer 10400 jongerenwerk",
      client_extra_line3: "Summervibes Festival Tilburg noord",
      client_extra_line4: "Kostenplaats 88",
    }),
    [line()],
    supplier,
  );
  const buyer = /<cac:AccountingCustomerParty>([\s\S]*?)<\/cac:AccountingCustomerParty>/.exec(xml)?.[1] ?? "";
  assert.ok(buyer, "no buyer block found — the extraction broke, not the export");
  assert.match(buyer, /<cbc:AdditionalStreetName>t\.a\.v\. Floor van Berkel<\/cbc:AdditionalStreetName>/);
  // Lines 2..4 share BT-163 (EN 16931 allows ONE cac:AddressLine) — joined, nothing dropped.
  assert.match(
    buyer,
    /<cac:AddressLine>\s*<cbc:Line>Projectnummer 10400 jongerenwerk, Summervibes Festival Tilburg noord, Kostenplaats 88<\/cbc:Line>\s*<\/cac:AddressLine>/,
  );
  // Order inside PostalAddress: StreetName → AdditionalStreetName → CityName → PostalZone →
  // AddressLine → Country. Wrong order = schema-invalid = refused file.
  const order = ["<cbc:StreetName>", "<cbc:AdditionalStreetName>", "<cbc:CityName>", "<cbc:PostalZone>", "<cac:AddressLine>", "<cac:Country>"]
    .map((tag) => buyer.indexOf(tag));
  assert.ok(order.every((i) => i >= 0), `an element is missing from the buyer address: ${order.join(", ")}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "PostalAddress elements are out of schema order");
  // The SUPPLIER's address gains nothing — these are the customer's lines.
  const sup = /<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/.exec(xml)?.[1] ?? "";
  assert.doesNotMatch(sup, /AdditionalStreetName|AddressLine/);
});

test("[KLANT-EXTRA] only line 2 filled still exports, and empty lines add no elements", () => {
  // Same collapse rule as the PDF: what is empty leaves no gap and no empty XML element.
  const { xml } = buildInvoiceUbl(
    header({ client_extra_line2: "Kostenplaats 88" }),
    [line()],
    supplier,
  );
  const buyer = /<cac:AccountingCustomerParty>([\s\S]*?)<\/cac:AccountingCustomerParty>/.exec(xml)?.[1] ?? "";
  // The first NON-EMPTY line takes BT-51 — the pair collapses exactly as it does on the page.
  assert.match(buyer, /<cbc:AdditionalStreetName>Kostenplaats 88<\/cbc:AdditionalStreetName>/);
  assert.doesNotMatch(buyer, /<cac:AddressLine>/);

  // And a header without the fields at all (a database where the migration is still open)
  // produces the document it always produced.
  const before = buildInvoiceUbl(header(), [line()], supplier).xml;
  assert.doesNotMatch(before, /AdditionalStreetName|<cac:AddressLine>/);
});

test("[UBL-CREDIT] a creditnota line with no quantity still multiplies out", () => {
  // The `?? 1` in the flip is not decoration. A line without a quantity means "one of this thing";
  // negating that default would emit -1 against a positive line amount, and PEPPOL-EN16931-R120
  // recomputes quantity x price and refuses the file. Old rows have a null quantity — the column
  // has always been nullable — so this is a live shape, not a hypothetical one.
  const { xml } = buildInvoiceUbl(
    header({ invoice_type: "creditnota", invoice_number: "CR-20260006", total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }),
    [line({ description: "Factuurbedrag", quantity: null as unknown as number, unit_price: 100, line_total: -100 })],
    supplier,
  );
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>1</, "one of it, not minus one of it");
  assert.match(xml, /<cbc:LineExtensionAmount[^>]*>100\.00</, "and the amount is the credited one");
  assert.match(xml, /<cbc:PriceAmount[^>]*>100\.00</, "1 x 100 = 100 — the arithmetic R120 checks");
  assert.doesNotMatch(xml, /<cbc:BaseQuantity/, "…so no per-line price form is needed");
});

test("[UBL-CREDIT] a creditnota with no lines is exportable, like the factuur it corrects", () => {
  // [CREDIT-SIGN] effectiveLines synthesized a summary line only when `ex > 0`, and a creditnota's
  // ex total is negative. So crediting an invoice that has no lines — the case that function exists
  // for — produced NO_LINES and buildInvoiceUbl threw: the e-factuur could not be made at all,
  // while the identical document as a factuur exported fine.
  const { xml, warnings } = buildInvoiceUbl(
    header({ invoice_type: "creditnota", invoice_number: "CR-20260007", total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 }),
    [],
    supplier,
  );
  assert.equal((xml.match(/<cac:InvoiceLine>/g) ?? []).length, 1, "BR-16: a document needs at least one line");
  assert.match(xml, /<cbc:InvoiceTypeCode>381<\/cbc:InvoiceTypeCode>/);
  // The synthesized line follows the STORED convention (-1 x 100), so the flip produces the form
  // UBL wants. A synthesized `quantity: 1` would come out of the flip as -1 against +100, and
  // PEPPOL-EN16931-R120 recomputes exactly that product.
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>1</, "one of it, positive, after the flip");
  assert.match(xml, /<cbc:PriceAmount[^>]*>100\.00</);
  assert.match(xml, /<cbc:LineExtensionAmount[^>]*>100\.00</);
  assert.match(xml, /<cbc:TaxInclusiveAmount[^>]*>121\.00</, "and the customer is credited 121,00");
  assert.doesNotMatch(xml, /<cbc:BaseQuantity/, "1 x 100 = 100 needs no per-line price form");
  assert.ok(
    warnings.some((w) => /No invoice_lines/.test(w)),
    "the owner's file is honest about being built from the header",
  );
});

test("[UBL-CREDIT] a factuur without lines is synthesized exactly as it always was", () => {
  // The narrow half: the change to that guard must be invisible to the case it already served.
  const { xml } = buildInvoiceUbl(header({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 }), [], supplier);
  assert.match(xml, /<cbc:InvoicedQuantity[^>]*>1</);
  assert.match(xml, /<cbc:PriceAmount[^>]*>100\.00</);
  assert.match(xml, /<cbc:LineExtensionAmount[^>]*>100\.00</);
  assert.match(xml, /Factuurbedrag/);
});
