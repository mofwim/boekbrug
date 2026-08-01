// [EENHEID] De eenheid tot in de ECHTE e-factuur — run: npx tsx --test src/lib/ubl-eenheid.test.ts
//
// eenheden.test.ts toetst de vertaler los. Deze test doet het waar het telt: door de echte
// buildInvoiceUbl heen, en leest de code terug uit de XML die de klant zou ontvangen.
//
// DE FOUT DIE HIER WORDT VASTGEZET
// ubl-export.ts had `unitCode: "C62"` HARDGECODEERD op elke regel. C62 = "one / stuk". Twee uur
// arbeid ging dus de deur uit als "2 stuks", veertien m² schilderwerk als "14 stuks". Het BEDRAG
// klopte altijd — daarom viel het nooit op — maar de e-factuur beschreef iets anders dan er
// geleverd was, en dat is het document dat telt bij een controle of een geschil.
//
// Een test op eenheidCode() alleen zou dat NIET hebben gevangen: die functie was goed, de
// aanroep ontbrak. Vandaar deze, die de hele weg aflegt.

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

const regel = (unit: string | null): UblInvoiceLine =>
  ({ description: "Werk", quantity: 2, unit_price: 50, btw_rate: 21, line_total: 100, unit }) as UblInvoiceLine;

/** De code zoals hij in de verstuurde XML staat. */
function unitCodeUit(unit: string | null): string {
  const { xml } = buildInvoiceUbl(HEADER, [regel(unit)], SUPPLIER);
  const m = /InvoicedQuantity unitCode="([A-Z0-9]+)"/.exec(xml);
  assert.ok(m, "de XML bevat geen InvoicedQuantity met een unitCode");
  return m![1];
}

test("uren zijn HUR in de e-factuur, niet 'stuks'", () => {
  assert.equal(unitCodeUit("uur"), "HUR");
});

test("oppervlakte, lengte en afstand krijgen hun eigen code", () => {
  assert.equal(unitCodeUit("m²"), "MTK");
  assert.equal(unitCodeUit("m¹"), "MTR");
  assert.equal(unitCodeUit("km"), "KMT");
});

test("GEEN eenheid geeft precies wat er vroeger stond — geen enkele bestaande factuur verandert", () => {
  // De belangrijkste regel van deze hele wijziging. Alles wat er al ligt heeft unit = NULL.
  assert.equal(unitCodeUit(null), "C62");
});

test("onbekende vrije tekst valt óók terug op C62 — nooit een verzonnen code", () => {
  // Een specifieke code die niet klopt is erger dan een algemene die dat al jaren niet deed.
  assert.equal(unitCodeUit("rol"), "C62");
  assert.equal(unitCodeUit("zakken"), "C62");
});

test("oude vrije tekst uit de catalogus wordt alsnog goed vertaald", () => {
  assert.equal(unitCodeUit("Uur"), "HUR");
  assert.equal(unitCodeUit("m2"), "MTK");
  assert.equal(unitCodeUit("st"), "C62");
});

test("de hardgecodeerde C62 komt niet terug", () => {
  // Vangnet tegen de exacte regressie: zou iemand het attribuut ooit weer vastzetten, dan geeft
  // élke eenheid dezelfde code en valt deze test.
  const codes = new Set(["uur", "m²", "km", "kg", null].map((u) => unitCodeUit(u as string | null)));
  assert.ok(codes.size > 1, "alle eenheden leveren dezelfde code op — staat unitCode weer vast?");
});

test("het BEDRAG verandert niet door de eenheid — dat was nooit het probleem", () => {
  const zonder = buildInvoiceUbl(HEADER, [regel(null)], SUPPLIER).xml;
  const met = buildInvoiceUbl(HEADER, [regel("uur")], SUPPLIER).xml;
  const bedragen = (x: string) => x.match(/<cbc:LineExtensionAmount[^>]*>([\d.]+)</g) ?? [];
  assert.deepEqual(bedragen(met), bedragen(zonder), "de eenheid mag geen cent verschuiven");
});
