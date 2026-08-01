// [UNIT] The unit all the way into the REAL e-invoice — run: npx tsx --test src/lib/ubl-unit.test.ts
//
// units.test.ts checks the translator in isolation. This test does it where it counts: through
// the real buildInvoiceUbl, reading the code back out of the XML the customer would receive.
//
// THE BUG THIS PINS DOWN
// ubl-export.ts had `unitCode: "C62"` HARDCODED on every line. C62 = "one / piece". So two hours
// of labour went out as "2 pieces", fourteen m² of painting as "14 pieces". The AMOUNT was
// always right — which is why it never stood out — but the e-invoice described something other
// than what was delivered, and that is the document that counts during an audit or a dispute.
//
// A test on toUnitCode() alone would NOT have caught that: the function was fine, the call was
// missing. Hence this one, which walks the whole path.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceUbl, type UblInvoiceHeader, type UblInvoiceLine, type UblSupplier } from "./ubl-export";

const HEADER = {
  id: "1",
  invoice_number: "20260001",
  invoice_date: "2026-08-01",
  due_date: "2026-08-15",
  invoice_type: "factuur",
  direction: "outgoing",
  total_ex_btw: 100,
  btw_amount: 21,
  total_inc_btw: 121,
  client_name: "Klant BV",
  client_address: "Straat 1",
  client_postal_code: "1000AA",
  client_city: "Amsterdam",
  client_btw_number: null,
} as unknown as UblInvoiceHeader;

const SUPPLIER = {
  company_name: "Mijn BV",
  full_name: "M",
  kvk_number: "12345678",
  btw_number: "NL123456789B01",
  address: "Weg 2",
  postal_code: "2000BB",
  city: "Rotterdam",
  iban: "NL91ABNA0417164300",
} as unknown as UblSupplier;

const line = (unit: string | null): UblInvoiceLine =>
  ({ description: "Werk", quantity: 2, unit_price: 50, btw_rate: 21, line_total: 100, unit }) as UblInvoiceLine;

/** The code as it appears in the sent XML. */
function unitCodeFor(unit: string | null): string {
  const { xml } = buildInvoiceUbl(HEADER, [line(unit)], SUPPLIER);
  const m = /InvoicedQuantity unitCode="([A-Z0-9]+)"/.exec(xml);
  assert.ok(m, "the XML contains no InvoicedQuantity with a unitCode");
  return m![1];
}

test("hours are HUR in the e-invoice, not 'pieces'", () => {
  assert.equal(unitCodeFor("uur"), "HUR");
});

test("area, length and distance get their own code", () => {
  assert.equal(unitCodeFor("m²"), "MTK");
  assert.equal(unitCodeFor("m¹"), "MTR");
  assert.equal(unitCodeFor("km"), "KMT");
});

test("NO unit yields exactly what was there before — no existing invoice changes", () => {
  // The most important rule of this whole change. Everything already stored has unit = NULL.
  assert.equal(unitCodeFor(null), "C62");
});

test("unknown free text ALSO falls back to C62 — never an invented code", () => {
  // A specific code that is wrong is worse than a generic one that already was, for years.
  assert.equal(unitCodeFor("rol"), "C62");
  assert.equal(unitCodeFor("zakken"), "C62");
});

test("old free text from the catalogue is still translated correctly", () => {
  assert.equal(unitCodeFor("Uur"), "HUR");
  assert.equal(unitCodeFor("m2"), "MTK");
  assert.equal(unitCodeFor("st"), "C62");
});

test("the hardcoded C62 does not come back", () => {
  // Safety net against the exact regression: were anyone to pin the attribute again, EVERY unit
  // yields the same code and this test fails.
  const codes = new Set(["uur", "m²", "km", "kg", null].map((u) => unitCodeFor(u as string | null)));
  assert.ok(codes.size > 1, "all units yield the same code — is unitCode pinned again?");
});

test("the AMOUNT does not change because of the unit — that was never the problem", () => {
  const without = buildInvoiceUbl(HEADER, [line(null)], SUPPLIER).xml;
  const with_ = buildInvoiceUbl(HEADER, [line("uur")], SUPPLIER).xml;
  const amounts = (x: string) => x.match(/<cbc:LineExtensionAmount[^>]*>([\d.]+)</g) ?? [];
  assert.deepEqual(amounts(with_), amounts(without), "the unit must not shift a single cent");
});
