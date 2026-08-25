// [E-FACTUUR] Run: npx tsx --test src/lib/ubl-inputs.test.ts
//
// The mapping between a database row and the e-factuur generator, tested where it actually bites:
// in the FILE. Asserting that the mapper copies a field is nearly worthless — it would pass with
// the field copied into a name the generator never reads. So every case here builds the XML and
// looks for what the field was supposed to put in it.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { buildInvoiceUbl, type UblSupplier } from "./ubl-export";
import {
  UBL_LINES_SELECT,
  UBL_LINES_SELECT_MINIMAL,
  UBL_LINES_SELECT_KEYED,
  UBL_LINES_SELECT_KEYED_MINIMAL,
  ublHeaderFrom,
  ublLinesFrom,
  type UblInvoiceRow,
  type UblLineRow,
} from "./ubl-inputs";

const supplier: UblSupplier = {
  company_name: "Kiwi Supermarkt B.V.", full_name: "M. Eigenaar", kvk_number: "76895009",
  btw_number: "NL860918002B01", iban: "NL65RABO0171136276",
  address: "Verdiplein 13", postal_code: "5049 NM", city: "Tilburg",
};

const row = (over: Partial<UblInvoiceRow> = {}): UblInvoiceRow => ({
  invoice_number: "20260046", invoice_date: "2026-08-03", due_date: "2026-09-02",
  invoice_type: "factuur", total_ex_btw: 90, btw_amount: 18.9, total_inc_btw: 108.9,
  client_name: "Klant B.V.", client_address: "Straat 1", client_postal_code: "1000 AA",
  client_city: "Amsterdam", client_btw_number: "NL001234567B01",
  discount_type: null, discount_value: null,
  ...over,
});

const xmlFor = (lines: UblLineRow[], over: Partial<UblInvoiceRow> = {}, extra?: Record<string, string | null>) =>
  buildInvoiceUbl(ublHeaderFrom(row(over), extra), ublLinesFrom(lines), supplier).xml;

// ─── The one that was broken ─────────────────────────────────────────────────────────

test("[REGEL-KORTING] a line discount reaches the file as BG-27, with the agreed price intact", () => {
  // THE ONE THAT MATTERS. These two columns were SELECTED by the export route and never passed to
  // the generator, so parseDiscount() saw undefined on every invoice ever exported. Nothing broke
  // visibly: the file stayed schema-valid and the totals stayed right, because line_total is
  // already net. What was lost is the explanation — the customer agreed to 100 minus 10%, and the
  // file said "90", so the export had to state a price that reproduces 90 and the agreed 50 per
  // unit appeared nowhere.
  const discounted: UblLineRow = {
    description: "Advies", quantity: 2, unit_price: 50, line_total: 90, btw_rate: 21,
    discount_type: "percent", discount_value: 10,
  };
  const xml = xmlFor([discounted]);

  assert.match(xml, /<cac:AllowanceCharge>/, "the discount is not in the file at all");
  assert.match(xml, /<cbc:ChargeIndicator>false<\/cbc:ChargeIndicator>/, "a discount, not a surcharge");
  assert.match(xml, /<cbc:MultiplierFactorNumeric>10<\/cbc:MultiplierFactorNumeric>/, "the percentage is the thing agreed");
  assert.match(xml, /<cbc:Amount currencyID="EUR">10\.00<\/cbc:Amount>/, "100 gross − 90 net = 10");
  assert.match(xml, /<cbc:BaseAmount currencyID="EUR">100\.00<\/cbc:BaseAmount>/, "and what it was taken off");
  // And the price is the one the customer agreed to, not a number reverse-engineered from 90.
  assert.match(xml, /<cbc:PriceAmount currencyID="EUR">50\.00<\/cbc:PriceAmount>/);
});

test("[REGEL-KORTING] a fixed-amount discount carries no percentage", () => {
  // A number in MultiplierFactorNumeric here would state a percentage nobody agreed to.
  const xml = xmlFor([
    { description: "Advies", quantity: 2, unit_price: 50, line_total: 90, btw_rate: 21, discount_type: "amount", discount_value: 10 },
  ]);
  assert.match(xml, /<cac:AllowanceCharge>/);
  assert.doesNotMatch(xml, /MultiplierFactorNumeric/);
  assert.match(xml, /<cbc:Amount currencyID="EUR">10\.00<\/cbc:Amount>/);
});

test("[REGEL-KORTING] a line without a discount is byte-for-byte what it always was", () => {
  // The other half of the same promise: this change may not touch the file of anyone who gives no
  // discounts, which is nearly everyone.
  const xml = xmlFor([{ description: "Advies", quantity: 2, unit_price: 50, line_total: 100, btw_rate: 21 }]);
  assert.doesNotMatch(xml, /AllowanceCharge/);
  assert.match(xml, /<cbc:PriceAmount currencyID="EUR">50\.00<\/cbc:PriceAmount>/);
});

// ─── The rest of the optional group, each proven in the file ─────────────────────────

test("[E-FACTUUR] an exempt line is category E, and a plain 0% line is not", () => {
  // Selected-but-not-passed once already: an art. 11 exemption exported as Z — a 0%-TAXED supply,
  // which the receiving system books differently from an exempt one.
  const exempt = xmlFor([{ description: "Huur", quantity: 1, unit_price: 90, line_total: 90, btw_rate: 0, vat_treatment: "exempt" }],
    { total_ex_btw: 90, btw_amount: 0, total_inc_btw: 90 });
  assert.match(exempt, /<cbc:ID>E<\/cbc:ID>/, "an exempt line must not be category Z");

  const zero = xmlFor([{ description: "Export", quantity: 1, unit_price: 90, line_total: 90, btw_rate: 0 }],
    { total_ex_btw: 90, btw_amount: 0, total_inc_btw: 90 });
  assert.doesNotMatch(zero, /<cbc:ID>E<\/cbc:ID>/, "…and an ordinary 0% line must not become one");
});

test("[UNIT] the owner's own unit reaches the file, and its absence still means C62", () => {
  const hours = xmlFor([{ description: "Werk", quantity: 3, unit_price: 30, line_total: 90, btw_rate: 21, unit: "uur" }]);
  assert.match(hours, /unitCode="HUR"/, "an hour is HUR (UN/ECE Rec 20), not 'pieces'");

  const bare = xmlFor([{ description: "Werk", quantity: 3, unit_price: 30, line_total: 90, btw_rate: 21 }]);
  assert.match(bare, /unitCode="C62"/);
});

test("[KLANT-EXTRA] the customer's own reference lines travel with the invoice", () => {
  // A receiving desk books an invoice against exactly this reference; an e-factuur without it is
  // refused by the same desk that refuses the paper without it.
  const xml = xmlFor(
    [{ description: "Advies", quantity: 2, unit_price: 45, line_total: 90, btw_rate: 21 }],
    {},
    { client_extra_line1: "t.a.v. afdeling Inkoop", client_extra_line2: "PO 44821" },
  );
  assert.match(xml, /t\.a\.v\. afdeling Inkoop/);
  assert.match(xml, /PO 44821/);
});

// ─── The distinction the generator branches on ──────────────────────────────────────

test("[E-FACTUUR] an absent column stays absent, and a null value stays null", () => {
  // These are not the same fact. `undefined` means the migration has not been applied in this
  // deployment; `null` means the column is there and this line carries no value. The generator
  // branches on the difference, so collapsing them with `?? null` would tell it a column exists
  // that does not.
  const [absent] = ublLinesFrom([{ description: "x", quantity: 1, unit_price: 1, line_total: 1, btw_rate: 21 }]);
  assert.ok(!("vat_treatment" in absent), "an unselected column must not appear as a key");
  assert.ok(!("discount_type" in absent));

  const [present] = ublLinesFrom([
    { description: "x", quantity: 1, unit_price: 1, line_total: 1, btw_rate: 21, vat_treatment: null, discount_type: null, discount_value: null },
  ]);
  assert.ok("vat_treatment" in present && present.vat_treatment === null);
  assert.ok("discount_type" in present && present.discount_type === null);
});

test("[E-FACTUUR] the fallback SELECT is the same list minus exactly the optional group", () => {
  // The two literals must stay in step: a caller that catches 42703 retries with the minimal list,
  // and if that list ever gained a column the full one lacks, the retry would fail the same way
  // and an accountant would be left unable to export anything at all.
  const full = UBL_LINES_SELECT.split(",").map((s) => s.trim());
  const minimal = UBL_LINES_SELECT_MINIMAL.split(",").map((s) => s.trim());
  assert.deepEqual(minimal.filter((c) => !full.includes(c)), [], "the fallback names a column the full read does not");
  assert.deepEqual(
    full.filter((c) => !minimal.includes(c)),
    ["unit", "vat_treatment", "discount_type", "discount_value"],
    "the optional group is exactly the four columns that arrive with their own migration",
  );
});

test("[E-FACTUUR] the keyed reads are the plain reads plus the owning invoice's id", () => {
  // Four literals for one column list, because PostgREST's types refuse a composed select. The
  // only thing keeping them honest is this: a column added to one and forgotten in another would
  // show up as a field silently missing from the package's e-facturen but present in the button's,
  // which is the "two e-facturen of one invoice that differ" this module exists to prevent.
  const cols = (s: string) => s.split(",").map((c) => c.trim());
  assert.deepEqual(cols(UBL_LINES_SELECT_KEYED), ["invoice_id", ...cols(UBL_LINES_SELECT)]);
  assert.deepEqual(cols(UBL_LINES_SELECT_KEYED_MINIMAL), ["invoice_id", ...cols(UBL_LINES_SELECT_MINIMAL)]);
});

test("[E-FACTUUR] both callers go through this module, neither maps rows itself", () => {
  // The point of the module. Two callers build the same e-factuur — the download button and the
  // quarter package — and the day one of them starts mapping rows again is the day the two files
  // begin to differ without anything failing.
  for (const file of ["src/app/api/export/ubl/route.ts", "src/lib/closing-package.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /ublHeaderFrom\(/, `${file} no longer builds its header through the shared mapper`);
    assert.match(src, /ublLinesFrom\(/, `${file} no longer builds its lines through the shared mapper`);
    assert.doesNotMatch(
      src,
      /invoice_number:\s*\w+\.invoice_number,[\s\S]{0,400}client_btw_number:/,
      `${file} maps an invoice row to a UBL header by hand again`,
    );
  }
  // The route must not carry its own copies of the SELECT literals either: a column added to one
  // list and not the other is how the package's e-factuur loses a field the button's still has.
  const route = readFileSync("src/app/api/export/ubl/route.ts", "utf8");
  assert.doesNotMatch(route, /const (INVOICE|LINES|PROFILE)_SELECT\s*=/, "the route defines its own SELECT again");
});

test("[KORTING-KOP] the document discount reaches the e-factuur — the customer is billed what was agreed", () => {
  // The auditor's own numbers: € 1.000 @21% + € 1.000 @9%, document discount 10%. Stored, editor
  // and PDF all said € 2.070,00 — and the XML said € 2.300,00, because the discount columns were
  // read by the generator and selected by nobody. € 230 too much, on the one document a machine
  // books without a human reading it.
  const xml = xmlFor(
    [
      { description: "A", quantity: 1, unit_price: 1000, btw_rate: 21, line_total: 1000 },
      { description: "B", quantity: 1, unit_price: 1000, btw_rate: 9, line_total: 1000 },
    ],
    { discount_type: "percent", discount_value: 10, total_ex_btw: 1800, btw_amount: 270, total_inc_btw: 2070 },
  );
  assert.match(xml, /<cac:AllowanceCharge>/, "the discount exists in the file");
  assert.match(xml, /<cbc:AllowanceTotalAmount currencyID="EUR">200.00<\/cbc:AllowanceTotalAmount>/);
  assert.match(xml, /<cbc:PayableAmount currencyID="EUR">2070.00<\/cbc:PayableAmount>/, "billed = agreed");
  assert.doesNotMatch(xml, /<cbc:PayableAmount currencyID="EUR">2300.00<\/cbc:PayableAmount>/);
});

test("[KORTING-PER-GROEP] two tax groups at one rate never each subtract the whole rate allowance", () => {
  // Rate 0 can carry TWO groups — a plain 0% line (category Z) and a vrijgestelde line
  // (category E). The allowance is computed per RATE; handing every group the full rate-0
  // allowance subtracts it twice while TaxExclusiveAmount subtracts it once — BR-CO-13, and the
  // access point refuses the file. Latent until the discount columns arrived; live the moment
  // they did.
  const xml = xmlFor(
    [
      { description: "Nul", quantity: 1, unit_price: 600, btw_rate: 0, line_total: 600 },
      { description: "Vrijgesteld", quantity: 1, unit_price: 400, btw_rate: 0, line_total: 400, vat_treatment: "exempt" },
    ],
    { discount_type: "percent", discount_value: 10, total_ex_btw: 900, btw_amount: 0, total_inc_btw: 900 },
  );
  const taxables = [...xml.matchAll(/<cbc:TaxableAmount currencyID="EUR">(-?[\d.]+)<\/cbc:TaxableAmount>/g)].map((m) => Number(m[1]));
  const sum = Math.round(taxables.reduce((a, b) => a + b, 0) * 100) / 100;
  const exclusive = Number(/<cbc:TaxExclusiveAmount currencyID="EUR">(-?[\d.]+)</.exec(xml)?.[1]);
  assert.equal(sum, exclusive, `BR-CO-13: som van TaxableAmounts (${sum}) moet gelijk zijn aan TaxExclusiveAmount (${exclusive})`);
  assert.equal(exclusive, 900, "€ 1.000 min 10% korting");
});

