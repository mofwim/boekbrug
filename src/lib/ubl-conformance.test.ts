// [UBL-CONFORMANCE] Peppol BIS 3.0 / EN 16931 arithmetic, checked on the XML we actually produce.
// Run: npx tsx --test src/lib/ubl-conformance.test.ts
//
// WHY THIS EXISTS SEPARATELY FROM ubl-export.test.ts
//
// That file checks what the builder DOES — document type 380 vs 381, the sign flip on a credit
// note, which fields appear. This one checks whether the result is a document an access point will
// accept, which is a different question and the one that decides whether the invoice arrives.
//
// The rules below are not style. A receiving access point validates them and REFUSES the file when
// they do not hold; the sender gets a rejection, and in practice that means an invoice that was
// "sent" and never landed. BR-CO-10 in particular is the one this codebase has a scar from: header
// totals were summed from raw products while each line was stored rounded, so a four-line invoice
// at 9% produced a header of 362,39 over lines summing to 362,38. Nothing was red. The file would
// simply have bounced.
//
// A NOTE ON HOW THE VALUES ARE READ, because getting this wrong is how the gap survived.
// `LineExtensionAmount` appears on every InvoiceLine AND once inside LegalMonetaryTotal. A regex
// over the whole document returns whichever one it meets first or last — a line's amount, not the
// document's. The existing [UBL-CREDIT] test does exactly that and passes only because its invoice
// has ONE line. Every read here is scoped to the element it belongs to, and the first test proves
// the reader finds what is there before any of the others are believed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceUbl, UblValidationError } from "./ubl-export";

const SUPPLIER = {
  company_name: "Kiwi Food Market",
  address: "Verdiplein 13-14",
  postal_code: "5049NM",
  city: "Tilburg",
  kvk_number: "94386676",
  btw_number: "NL005079680B23",
  iban: "NL73INGB0107197480",
};

const HEADER = {
  invoice_number: "2026-001",
  invoice_date: "2026-08-08",
  due_date: "2026-09-07",
  invoice_type: "factuur",
  total_ex_btw: 362.38,
  btw_amount: 32.61,
  total_inc_btw: 394.99,
  client_name: "Stichting Contour de Twern",
  client_address: "Spoorlaan 444",
  client_postal_code: "5038CH",
  client_city: "Tilburg",
  client_btw_number: null,
};

/** The real quote from the report: four lines at 9%, prices typed INCLUSIVE, so every ex is a fraction. */
const KIWI = [
  { description: "Worstjes", quantity: 150, unit_price: 0.9 / 1.09, btw_rate: 9, line_total: 123.85 },
  { description: "Kip spies", quantity: 100, unit_price: 1.9 / 1.09, btw_rate: 9, line_total: 174.31 },
  { description: "Broodjes", quantity: 38, unit_price: 1.75 / 1.09, btw_rate: 9, line_total: 61.01 },
  { description: "Sauzen", quantity: 2, unit_price: 1.75 / 1.09, btw_rate: 9, line_total: 3.21 },
];

function build(lines: unknown[], header: Record<string, unknown> = {}): string {
  return buildInvoiceUbl({ ...HEADER, ...header } as never, lines as never, SUPPLIER as never).xml;
}

// ── reading the document, scoped ───────────────────────────────────────────────────────────────

/** The text inside one element, so a cbc read cannot wander into a sibling. */
function element(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<cac:${tag}>([\\s\\S]*?)</cac:${tag}>`));
  return m ? m[1] : "";
}

/** A number from one cbc field INSIDE a given fragment. NaN when absent, which reads as "not stated". */
function amount(fragment: string, tag: string): number {
  const m = fragment.match(new RegExp(`<cbc:${tag}[^>]*>(-?[\\d.]+)</cbc:${tag}>`));
  return m ? Number(m[1]) : NaN;
}

/** Every InvoiceLine's own net amount, in document order. */
function lineAmounts(xml: string): number[] {
  return [
// [CREDITNOTA-DOCUMENT] Reads BOTH document shapes. A creditnota is a CreditNote with
// CreditNoteLine/CreditedQuantity, and a helper that knew only the invoice spelling would find
// ZERO lines on one — and then assert nothing at all, vacuously, forever.
    ...xml.matchAll(
      /<cac:(?:Invoice|CreditNote)Line>[\s\S]*?<cbc:LineExtensionAmount[^>]*>(-?[\d.]+)<\/cbc:LineExtensionAmount>/g,
    ),
  ].map((m) => Number(m[1]));
}

function taxSubtotals(xml: string): { taxable: number; tax: number; percent: number }[] {
  return [...xml.matchAll(/<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/g)].map((m) => ({
    taxable: amount(m[1], "TaxableAmount"),
    tax: amount(m[1], "TaxAmount"),
    percent: Number((m[1].match(/<cbc:Percent>([\d.]+)</) ?? [, "0"])[1]),
  }));
}

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;

/**
 * Every arithmetic rule an access point checks, on one document.
 *
 * Written as one helper because the rules are a SET: a document that satisfies four of them and
 * not the fifth is refused exactly as hard as one that satisfies none.
 */
function assertConformant(xml: string, what: string) {
  const lmt = element(xml, "LegalMonetaryTotal");
  assert.notEqual(lmt, "", `${what}: no LegalMonetaryTotal — nothing below this can be believed`);

  const lines = lineAmounts(xml);
  assert.ok(lines.length > 0, `${what}: no InvoiceLine amounts found`);
  const lineSum = round2(lines.reduce((a, b) => a + b, 0));

  const header = amount(lmt, "LineExtensionAmount");
  const allowance = amount(lmt, "AllowanceTotalAmount");
  const allow = Number.isNaN(allowance) ? 0 : allowance;
  const taxEx = amount(lmt, "TaxExclusiveAmount");
  const taxIn = amount(lmt, "TaxInclusiveAmount");
  const payable = amount(lmt, "PayableAmount");

  // BR-CO-10 — the one this codebase broke. Sum of the line net amounts IS the document's.
  assert.equal(header, lineSum, `${what}: BR-CO-10 — header ${header} vs lines summing to ${lineSum}`);

  // BR-CO-13 — the taxable base is the lines minus the document-level discount.
  assert.equal(
    taxEx, round2(header - allow),
    `${what}: BR-CO-13 — TaxExclusive ${taxEx} vs ${round2(header - allow)}`,
  );

  // BR-S-09 / BR-CO-17 — per rate, the tax is the base times the rate. An accountant recomputing
  // the btw from the stated base must land on the stated tax.
  const subs = taxSubtotals(xml);
  assert.ok(subs.length > 0, `${what}: no TaxSubtotal — the btw is not broken down per rate`);
  for (const s of subs) {
    assert.ok(
      Math.abs(s.tax - round2((s.taxable * s.percent) / 100)) < 0.005,
      `${what}: BR-S-09 at ${s.percent}% — ${s.tax} vs ${round2((s.taxable * s.percent) / 100)}`,
    );
  }
  // …and the per-rate bases must themselves add up to the taxable total.
  assert.equal(
    round2(subs.reduce((a, s) => a + s.taxable, 0)), taxEx,
    `${what}: the per-rate bases must sum to TaxExclusiveAmount`,
  );

  // BR-CO-15 and BR-CO-16 — the bottom of the document.
  const totalTax = round2(subs.reduce((a, s) => a + s.tax, 0));
  assert.equal(taxIn, round2(taxEx + totalTax), `${what}: BR-CO-15`);
  assert.equal(payable, taxIn, `${what}: BR-CO-16 — payable ${payable} vs inclusive ${taxIn}`);

  // PEPPOL-EN16931-R120 — the line amount must be what the price and the quantity produce.
  //
  // A price is rounded to cents like everything else, so a fractional unit price cannot state
  // itself. The file said 150 x 0,83 next to a line amount of 123,85 — sixty-five cents apart, in
  // the document a validator multiplies out. cbc:BaseQuantity is UBL's answer: the number of units
  // the price applies to.
  const linesXml = [...xml.matchAll(/<cac:(?:Invoice|CreditNote)Line>([\s\S]*?)<\/cac:(?:Invoice|CreditNote)Line>/g)].map((m) => m[1]);
  linesXml.forEach((ln, i) => {
    const qty = Number((ln.match(/<cbc:(?:Invoiced|Credited)Quantity[^>]*>(-?[\d.]+)</) ?? [, "NaN"])[1]);
    const price = amount(ln, "PriceAmount");
    const base = amount(ln, "BaseQuantity");
    const net = amount(ln, "LineExtensionAmount");
    const per = Number.isNaN(base) ? 1 : base;
    assert.ok(per !== 0, `${what}: line ${i + 1} has a BaseQuantity of zero`);
    assert.ok(
      Math.abs(round2((qty * price) / per) - net) < 0.005,
      `${what}: R120 on line ${i + 1} — ${qty} x ${price}${Number.isNaN(base) ? "" : ` / ${base}`}` +
        ` = ${round2((qty * price) / per)}, but the line says ${net}`,
    );
  });

  // BR-DEC-* — every monetary value carries at most two decimals. A raw 49.995 in the file is
  // rejected on its own, before any of the sums are even looked at.
  const overprecise = [...xml.matchAll(/>(-?\d+\.\d{3,})</g)].map((m) => m[1]);
  assert.deepEqual(overprecise, [], `${what}: amounts with more than 2 decimals: ${overprecise.join(", ")}`);
}

// ── the control ────────────────────────────────────────────────────────────────────────────────

test("[UBL-CONFORMANCE] the reader finds the document total, not a line's", () => {
  // Without this the whole file is theatre. LineExtensionAmount occurs on every line AND in
  // LegalMonetaryTotal; an unscoped regex returns a line's amount, and on a single-line invoice
  // that coincides with the right answer — which is why the existing [UBL-CREDIT] check has been
  // passing while measuring the wrong element.
  const xml = build(KIWI);
  assert.deepEqual(lineAmounts(xml), [123.85, 174.31, 61.01, 3.21], "the four line amounts, in order");
  assert.equal(
    amount(element(xml, "LegalMonetaryTotal"), "LineExtensionAmount"), 362.38,
    "the DOCUMENT total, which is a different number from any single line",
  );
  assert.notEqual(
    amount(element(xml, "LegalMonetaryTotal"), "LineExtensionAmount"), 3.21,
    "reading the last match in the document would give the last line — 3,21",
  );
});

// ── the documents ──────────────────────────────────────────────────────────────────────────────

test("[UBL-CONFORMANCE] the measured case: four lines at 9%, prices typed inclusive", () => {
  // 123,85 + 174,31 + 61,01 + 3,21 = 362,38. The header used to say 362,39 and the file would have
  // been refused at the receiving access point under BR-CO-10 — an invoice "sent" and never landed.
  assertConformant(build(KIWI), "kiwi");
});

test("[UBL-CONFORMANCE] the plain rounding case, no inclusive pricing involved", () => {
  // 1,5 uur x EUR 33,33 = 49,995 → the line stores 50,00. Two of them print 100,00 and the header
  // used to total 99,99.
  assertConformant(
    build(
      [
        { description: "Werk", quantity: 1.5, unit_price: 33.33, btw_rate: 21, line_total: 50 },
        { description: "Werk", quantity: 1.5, unit_price: 33.33, btw_rate: 21, line_total: 50 },
      ],
      { total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121 },
    ),
    "33,33",
  );
});

test("[UBL-CONFORMANCE] a document-level korting, apportioned per rate", () => {
  // An AllowanceCharge carries exactly ONE TaxCategory, so a mixed-rate invoice needs one per rate
  // — and BR-CO-13 then has to still hold across all of them.
  assertConformant(
    build(
      [
        { description: "A", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000 },
        { description: "B", quantity: 1, unit_price: 1000, btw_rate: 9, line_total: 1000 },
      ],
      { discount_type: "amount", discount_value: 200, total_ex_btw: 1800, btw_amount: 270, total_inc_btw: 2070 },
    ),
    "mixed + korting",
  );
});

test("[UBL-CONFORMANCE] a percentage korting on the inclusive-priced quote", () => {
  assertConformant(
    build(KIWI, {
      discount_type: "percent", discount_value: 10,
      total_ex_btw: 326.14, btw_amount: 29.35, total_inc_btw: 355.49,
    }),
    "kiwi -10%",
  );
});

test("[UBL-CONFORMANCE] a creditnota exports positive and still reconciles", () => {
  // Type 381 carries magnitudes. The flip is per field, so it is exactly the place where a document
  // can end up with every individual number looking right and the totals no longer adding up.
  assertConformant(
    build(
      KIWI.map((l) => ({ ...l, quantity: -l.quantity, line_total: -l.line_total })),
      { invoice_type: "creditnota", total_ex_btw: -362.38, btw_amount: -32.61, total_inc_btw: -394.99 },
    ),
    "creditnota",
  );
});

test("[UBL-CONFORMANCE] a 0% line does not break the per-rate breakdown", () => {
  // Verlegd / vrijgesteld revenue still needs its own TaxSubtotal, and the bases must still sum.
  assertConformant(
    build(
      [
        { description: "Belast", quantity: 1, unit_price: 500, btw_rate: 21, line_total: 500 },
        { description: "Verlegd", quantity: 1, unit_price: 500, btw_rate: 0, line_total: 500 },
      ],
      { total_ex_btw: 1000, btw_amount: 105, total_inc_btw: 1105 },
    ),
    "0% + 21%",
  );
});

test("[UBL-CONFORMANCE] many small lines, where per-line rounding drifts furthest", () => {
  // Twelve lines each ending in half a cent is the worst case for a header summed independently of
  // its lines: the drift accumulates instead of cancelling.
  const many = Array.from({ length: 12 }, (_, i) => ({
    description: `Regel ${i + 1}`, quantity: 3, unit_price: 1.665, btw_rate: 21, line_total: 5,
  }));
  assertConformant(build(many, { total_ex_btw: 60, btw_amount: 12.6, total_inc_btw: 72.6 }), "12 x 4,995");
});

// ── [SI-UBL] Peppol BIS 3.0 mode ────────────────────────────────────────────────────────────────
// The BIS identity and routing fields an access point validates BEFORE any amount is read. The
// amounts themselves are the same builder, covered by every test above.

function buildPeppol(lines: unknown[], header: Record<string, unknown> = {}): string {
  return buildInvoiceUbl(
    { ...HEADER, client_btw_number: "NL004495445B01", ...header } as never,
    lines as never,
    SUPPLIER as never,
    { peppol: true } as never,
  ).xml;
}

test("[SI-UBL] the BIS identity pair replaces the version tag, in schema order", () => {
  const xml = buildPeppol(KIWI);
  assert.match(xml, /urn:cen\.eu:en16931:2017#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
  assert.match(xml, /urn:fdc:peppol\.eu:2017:poacc:billing:01:1\.0/);
  assert.doesNotMatch(xml, /UBLVersionID/, "BIS files carry no UBLVersionID");
  assert.ok(
    xml.indexOf("CustomizationID") < xml.indexOf("ProfileID") && xml.indexOf("ProfileID") < xml.indexOf("<cbc:ID>"),
    "CustomizationID, then ProfileID, then ID — order is not free in UBL",
  );
});

test("[SI-UBL] both parties carry their electronic address, and the buyer name sits where BIS reads it", () => {
  const xml = buildPeppol(KIWI);
  assert.match(xml, /<cbc:EndpointID schemeID="0106">94386676<\/cbc:EndpointID>/, "supplier: KVK under EAS 0106");
  assert.match(xml, /<cbc:EndpointID schemeID="9944">NL004495445B01<\/cbc:EndpointID>/, "buyer: BTW-nummer under EAS 9944");
  // EndpointID must be the FIRST child of its Party — after PartyName the file is not schema-valid.
  const cusParty = xml.slice(xml.indexOf("AccountingCustomerParty"));
  assert.ok(cusParty.indexOf("EndpointID") < cusParty.indexOf("PartyName"), "EndpointID before PartyName");
  assert.match(cusParty, /<cac:PartyLegalEntity>\s*<cbc:RegistrationName>Stichting Contour de Twern<\/cbc:RegistrationName>/,
    "BT-44 lives in the buyer's PartyLegalEntity");
  assert.match(xml, /<cbc:BuyerReference>2026-001<\/cbc:BuyerReference>/, "PEPPOL-EN16931-R003 satisfied");
});

test("[SI-UBL] a buyer without an electronic address is REFUSED, not shipped unroutable", () => {
  assert.throws(
    () => buildPeppol(KIWI, { client_btw_number: null }),
    (e: Error) => e instanceof UblValidationError && e.code === "CLIENT_MISSING_PEPPOL_ADDRESS",
  );
});

test("[SI-UBL] the default document is byte-identical to what it always was", () => {
  // The lenient importer file is the one existing customers' accountants already rely on; the
  // BIS mode must be an ADDITION, never a drift.
  const plain = build(KIWI);
  assert.match(plain, /<cbc:UBLVersionID>2\.1<\/cbc:UBLVersionID>/);
  assert.doesNotMatch(plain, /CustomizationID|ProfileID|EndpointID|BuyerReference/);
});
