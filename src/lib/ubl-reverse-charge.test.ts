// [E-FACTUUR-VERLEGD] The paper invoice and the e-invoice must tell the SAME tax story.
// Run: npx tsx --test src/lib/ubl-reverse-charge.test.ts
//
// ── WHAT WAS WRONG ──
//
// A Dutch shop sells €1.000 of goods to a German customer with a valid EU BTW number and charges
// no BTW, because the tax is shifted to the buyer. Two documents leave the app for that one sale:
//
//   · the PDF, which printed "Btw verlegd — intracommunautaire prestatie. BTW-nummer afnemer: DE…"
//     — correct, and mandatory under art. 226 punt 11a of directive 2006/112/EG;
//   · the UBL e-invoice, which put the supply in category Z, "zero rated", with no exemption
//     reason at all.
//
// Z and AE are not two spellings of "no BTW". Z is a supply the SELLER taxes at 0%. AE is a supply
// the BUYER owes the tax on. The receiving system books them differently — under AE it raises the
// buyer's own BTW liability, under Z it does nothing — so the German customer's ERP silently
// skipped a payable, and the Dutch seller's XML contradicted the seller's own PDF.
//
// The cause was narrow and worth naming: lineVatKind() read reverse charge off the LINE
// DESCRIPTION only, while the PDF derived it from the DOCUMENT (EU VAT number + zero BTW + not
// KOR). The two answers agreed only when the owner happened to type "btw verlegd" into a line.
//
// From the 2027/2028 Dutch e-invoicing mandate the XML is the document that counts, so this test
// pins the two readers to one predicate: isReverseChargedInvoice() in icp.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceUbl } from "./ubl-export";
import { reverseChargeNotice, isReverseChargedInvoice } from "./icp";

const SUPPLIER = {
  company_name: "Kiwi Food Market",
  address: "Verdiplein 13-14",
  postal_code: "5049NM",
  city: "Tilburg",
  kvk_number: "94386676",
  btw_number: "NL005079680B23",
  iban: "NL73INGB0107197480",
};

/** An intracommunautaire levering: EU customer, zero BTW. */
const EU_HEADER = {
  invoice_number: "2026-0007",
  invoice_date: "2026-08-01",
  due_date: "2026-08-31",
  invoice_type: "factuur",
  total_ex_btw: 1000,
  btw_amount: 0,
  total_inc_btw: 1000,
  client_name: "Müller Handel GmbH",
  client_address: "Bahnhofstr. 4",
  client_postal_code: "10115",
  client_city: "Berlin",
  client_btw_number: "DE123456789",
};

const PLAIN_LINE = [
  { description: "Levering handelsgoederen", quantity: 1, unit_price: 1000, btw_rate: 0, line_total: 1000 },
];

function build(
  lines: unknown[],
  header: Record<string, unknown> = {},
  opts?: { korActive?: boolean },
): string {
  return buildInvoiceUbl({ ...EU_HEADER, ...header } as never, lines as never, SUPPLIER as never, opts).xml;
}

/** Every ClassifiedTaxCategory on a line, in document order. */
function lineCategories(xml: string): string[] {
  return [
    ...xml.matchAll(/<cac:ClassifiedTaxCategory>[\s\S]*?<cbc:ID>([A-Z]+)<\/cbc:ID>/g),
  ].map((m) => m[1]);
}

/** Each TaxSubtotal as (category, taxable, reason). */
function subtotals(xml: string): { category: string; taxable: number; reason: string | null }[] {
  return [...xml.matchAll(/<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/g)].map((m) => ({
    category: (m[1].match(/<cbc:ID>([A-Z]+)<\/cbc:ID>/) ?? [, ""])[1],
    taxable: Number((m[1].match(/<cbc:TaxableAmount[^>]*>(-?[\d.]+)</) ?? [, "NaN"])[1]),
    reason: (m[1].match(/<cbc:TaxExemptionReason>([^<]*)</) ?? [, null])[1],
  }));
}

// ── the reported case ──────────────────────────────────────────────────────────────────────────

test("[E-FACTUUR-VERLEGD] an intracommunautaire levering is AE in the XML, not Z", () => {
  const xml = build(PLAIN_LINE);

  assert.deepEqual(lineCategories(xml), ["AE"], "the line the customer owes the BTW on");

  const subs = subtotals(xml);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].category, "AE");
  assert.equal(subs[0].taxable, 1000, "BR-AE-08 — the AE base is the sum of the AE lines");
  assert.match(
    subs[0].reason ?? "",
    /verlegd/i,
    "BR-AE-10 — AE without a TaxExemptionReason is refused by the access point",
  );
});

test("[E-FACTUUR-VERLEGD] the PDF and the XML agree about the same invoice", () => {
  // This is the whole point. Two documents, one sale, one tax story.
  const printed = reverseChargeNotice({
    clientVatNumber: EU_HEADER.client_btw_number,
    btwAmount: EU_HEADER.btw_amount,
    invoiceType: EU_HEADER.invoice_type,
    korActive: false,
    lineTexts: PLAIN_LINE.map((l) => l.description),
  });
  assert.ok(printed && /Btw verlegd/.test(printed), "the PDF says it");
  assert.ok(lineCategories(build(PLAIN_LINE)).includes("AE"), "…and so does the XML");
});

test("[E-FACTUUR-VERLEGD] the owner's own words still work, without an EU number on the header", () => {
  // The route that already existed: a line that SAYS it is verlegd. Kept, because a domestic
  // verleggingsregeling (art. 12 lid 5 — the construction sector) has a Dutch customer and no EU
  // number to derive anything from, so the line text is the only signal there is.
  const xml = build(
    [{ description: "Onderaanneming — btw verlegd", quantity: 1, unit_price: 1000, btw_rate: 0, line_total: 1000 }],
    { client_btw_number: "NL812345678B01" },
  );
  assert.deepEqual(lineCategories(xml), ["AE"]);
});

// ── where it must NOT fire ─────────────────────────────────────────────────────────────────────

test("[E-FACTUUR-VERLEGD] a domestic 0% supply stays Z", () => {
  // An ordinary Dutch 0% sale is taxed, at zero. Turning it into AE would tell the buyer they owe
  // tax they do not owe.
  const xml = build(PLAIN_LINE, { client_btw_number: "NL812345678B01" });
  assert.deepEqual(lineCategories(xml), ["Z"]);
});

test("[E-FACTUUR-VERLEGD] no customer BTW number at all stays Z", () => {
  const xml = build(PLAIN_LINE, { client_btw_number: null });
  assert.deepEqual(lineCategories(xml), ["Z"]);
});

test("[E-FACTUUR-VERLEGD] under KOR nothing is verlegd", () => {
  // KOR charges no BTW for a reason that has nothing to do with the buyer. Claiming verlegging
  // here would be a statement about a regime the owner is not in — and the PDF already refuses to
  // print it, so the XML has to refuse too.
  //
  // [KOR-E] The category is E, not the Z this test used to pin: a KOR supply is VRIJGESTELD
  // (art. 25 Wet OB), and Z would claim a zero RATE applies — a different legal fact. What this
  // test guards is unchanged: whatever the category is, it is never AE.
  assert.deepEqual(lineCategories(build(PLAIN_LINE, {}, { korActive: true })), ["E"]);
  assert.deepEqual(lineCategories(build(PLAIN_LINE, {}, { korActive: false })), ["AE"]);
});

test("[E-FACTUUR-VERLEGD] an invoice that DOES charge BTW is never verlegd", () => {
  // Whatever the VAT number says: BTW on the invoice means the seller kept the liability.
  const xml = build(
    [{ description: "Advies", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000 }],
    { btw_amount: 210, total_inc_btw: 1210 },
  );
  assert.deepEqual(lineCategories(xml), ["S"]);
});

test("[E-FACTUUR-VERLEGD] an exempt line stays E, even to an EU customer", () => {
  // Art. 11 Wet OB is a different legal fact and does not become verlegging because the customer
  // sits in Germany. E and AE are both "no BTW" and are booked differently.
  const xml = build([
    { description: "Cursus", quantity: 1, unit_price: 1000, btw_rate: 0, line_total: 1000, vat_treatment: "exempt" },
  ]);
  assert.deepEqual(lineCategories(xml), ["E"]);
  assert.match(subtotals(xml)[0].reason ?? "", /artikel 11/i);
});

test("[E-FACTUUR-VERLEGD] an offerte carries no BTW statement at all", () => {
  assert.equal(
    isReverseChargedInvoice({
      clientVatNumber: "DE123456789", btwAmount: 0, invoiceType: "offerte",
    }),
    false,
    "an offer is not a legal invoice",
  );
});

// ── the discount, which is where a mismatched category gets the file refused ────────────────────

test("[E-FACTUUR-VERLEGD] a document discount carries the AE category too", () => {
  // The AllowanceCharge has its own TaxCategory. Left at Z it would be the only Z on the document,
  // and BR-Z-08 then demands a Z subtotal whose taxable amount equals it — which does not exist.
  // The access point refuses the whole invoice over the discount line.
  const xml = build(PLAIN_LINE, { discount_type: "percent", discount_value: 10 });

  const allowance = xml.match(/<cac:AllowanceCharge>([\s\S]*?)<\/cac:AllowanceCharge>/);
  assert.ok(allowance, "the discount is an AllowanceCharge, as BIS 3.0 requires");
  assert.match(allowance![1], /<cbc:ID>AE<\/cbc:ID>/, "and it belongs to the same category");

  const cats = new Set(subtotals(xml).map((s) => s.category));
  assert.deepEqual([...cats], ["AE"], "one category on the document, so nothing is left dangling");
});

// ── a creditnota corrects one, so it inherits its category ─────────────────────────────────────

test("[E-FACTUUR-VERLEGD] a creditnota on an intracommunautaire levering is AE as well", () => {
  // Stored negative, exported positive (UBL type 381). The correction of a reverse-charged supply
  // is itself reverse-charged; as Z it would leave the buyer's booked liability standing.
  const xml = build(
    [{ description: "Creditering levering", quantity: 1, unit_price: -1000, btw_rate: 0, line_total: -1000 }],
    { invoice_type: "creditnota", total_ex_btw: -1000, btw_amount: 0, total_inc_btw: -1000 },
  );
  assert.deepEqual(lineCategories(xml), ["AE"]);
  assert.equal(subtotals(xml)[0].taxable, 1000, "positive amounts on a 381, as before");
});
