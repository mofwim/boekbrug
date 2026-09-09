// [BUITENLANDSE-INKOOP] Pure node test — run: npx tsx --test src/lib/foreign-purchase-vat.test.ts
//
// The load-bearing test is the first: a Dutch supplier, and a supplier nobody placed anywhere,
// produce nothing. Most purchases are domestic, and a rubriek 4a that appears on a return because a
// supplier's country was guessed is the wrong answer in the wrong box.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  foreignPurchaseVat, supplierCountryOf, foreignPurchaseIds, foreignPurchaseNote, buildForeignPurchaseCsv,
  type ForeignPurchaseInput,
} from "./foreign-purchase-vat";

const inv = (over: Partial<ForeignPurchaseInput> = {}): ForeignPurchaseInput => ({
  direction: "incoming", status: "received", invoiceNumber: "INV-1", supplierName: "Adobe",
  totalExBtw: 600, btwAmount: 0, supplierCountry: null, supplierVatNumber: null, ...over,
});

const strip = (t: { grondslag: number; btw: number; aantal: number; aftrekbaar?: number } | null) => t;

test("[BUITENLANDSE-INKOOP] a Dutch supplier, or one placed nowhere, reaches neither rubriek", () => {
  const r = foreignPurchaseVat([
    inv({ supplierVatNumber: "NL812345678B01" }),
    inv({ supplierCountry: "NL" }),
    inv(),
  ]);
  assert.equal(r.eu, null);
  assert.equal(r.nonEu, null);
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.chargedAbroad, []);
  assert.equal(foreignPurchaseNote(r), null, "nothing foreign, no note");
});

test("[BUITENLANDSE-INKOOP] the supplier's country: recorded first, the btw-nummer's prefix second", () => {
  assert.equal(supplierCountryOf({ supplierCountry: "us", supplierVatNumber: "DE123456789" }), "US", "the owner's word outranks the prefix");
  assert.equal(supplierCountryOf({ supplierVatNumber: "DE123456789" }), "DE");
  assert.equal(supplierCountryOf({ supplierVatNumber: "EL123456789" }), "GR", "Greece's VAT prefix is the country GR");
  assert.equal(supplierCountryOf({ supplierVatNumber: "NL812345678B01" }), "NL");
  assert.equal(supplierCountryOf({ supplierVatNumber: "GB123456789" }), null, "a UK number has no EU prefix and no recorded country");
  assert.equal(supplierCountryOf({}), null);
});

test("[BUITENLANDSE-INKOOP] EU suppliers land in 4b, the rest of the world in 4a, at the proposed 21%", () => {
  const r = foreignPurchaseVat([
    inv({ id: "a", supplierVatNumber: "IE6388047V", totalExBtw: 600 }),               // Adobe, IE → 4b
    inv({ id: "b", supplierVatNumber: "LU26888617", totalExBtw: 400, supplierName: "AWS" }), // LU → 4b
    inv({ id: "c", supplierCountry: "GB", totalExBtw: 4000, supplierName: "UK designer" }), // → 4a
    inv({ id: "d", supplierCountry: "US", totalExBtw: 300, supplierName: "OpenAI" }),       // → 4a
  ]);
  assert.deepEqual(strip(r.eu), { grondslag: 1000, btw: 210, aantal: 2, aftrekbaar: 210 });
  assert.deepEqual(strip(r.nonEu), { grondslag: 4300, btw: 903, aantal: 2, aftrekbaar: 903 });
  assert.equal(r.rate, 21);
  assert.deepEqual(r.items.map((x) => [x.id, x.rubriek, x.btw]), [["c", "4a", 840], ["a", "4b", 126], ["b", "4b", 84], ["d", "4a", 63]],
    "every invoice behind the totals, largest first");
  assert.deepEqual([...foreignPurchaseIds(r)].sort(), ["a", "b", "c", "d"], "…and their ids, for the caller's 2a set");
});

test("[BUITENLANDSE-INKOOP] a foreign supplier that charged btw is listed, never shifted", () => {
  const r = foreignPurchaseVat([inv({ id: "x", supplierVatNumber: "DE123456789", totalExBtw: 800, btwAmount: 152, supplierName: "Hansen GmbH" })]);
  assert.equal(r.eu, null);
  assert.deepEqual(r.chargedAbroad, [{ id: "x", invoiceNumber: "INV-1", supplierName: "Hansen GmbH", country: "DE", btwAmount: 152 }]);
  assert.ok(foreignPurchaseIds(r).has("x"), "it is still a foreign document — not 2a either");
  const note = foreignPurchaseNote(r)!;
  assert.match(note, /wél btw berekend/, "the note says the btw was charged");
  assert.match(note, /INV-1 \(DE\)/, "…and names the invoice");
  assert.match(note, /niet in 4a\/4b/);
  assert.match(note, /ook niet in 5b/, "foreign btw is not voorbelasting on a Dutch return");
});

test("[BUITENLANDSE-INKOOP] a foreign supplier that prints 'btw verlegd' is still 4a/4b — the country decides the box", () => {
  // A Belgian subcontractor writes "btw verlegd" like a Dutch one; the reader marks both alike.
  // The caller keeps this id out of its 2a set — this module places it in 4b regardless.
  const r = foreignPurchaseVat([inv({ id: "be", supplierCountry: "BE", totalExBtw: 5000 })]);
  assert.deepEqual(strip(r.eu), { grondslag: 5000, btw: 1050, aantal: 1, aftrekbaar: 1050 });
  assert.ok(foreignPurchaseIds(r).has("be"));
});

test("[BUITENLANDSE-INKOOP] only what the ledger counts, only purchases", () => {
  const r = foreignPurchaseVat([
    inv({ supplierCountry: "DE", status: "processing" }),
    inv({ supplierCountry: "DE", status: "draft" }),
    inv({ supplierCountry: "DE", direction: "outgoing" }),
    inv({ supplierCountry: "DE", totalExBtw: 0 }),
  ]);
  assert.equal(r.eu, null);
  assert.deepEqual(r.items, []);
});

test("[BUITENLANDSE-INKOOP] the deductible share follows the owner's regime, per invoice", () => {
  const r = foreignPurchaseVat([
    inv({ supplierCountry: "US", totalExBtw: 1000, aftrekDeel: 0.2 }),   // mixed cost, pro rata 20%
    inv({ supplierCountry: "US", totalExBtw: 500, aftrekDeel: 0 }),      // exempt work, or KOR
    inv({ supplierCountry: "US", totalExBtw: 100 }),                     // full right
  ]);
  assert.deepEqual(strip(r.nonEu), { grondslag: 1600, btw: 336, aantal: 3, aftrekbaar: 63 }); // 42 + 0 + 21
  assert.deepEqual(r.items.map((x) => x.aftrekbaar), [42, 0, 21]);
});

test("[BUITENLANDSE-INKOOP] a creditnota from abroad reduces the rubriek, sign and all", () => {
  const r = foreignPurchaseVat([
    inv({ supplierCountry: "US", totalExBtw: 1000 }),
    inv({ supplierCountry: "US", totalExBtw: -250, invoiceNumber: "CR-1" }),
  ]);
  assert.deepEqual(strip(r.nonEu), { grondslag: 750, btw: 157.5, aantal: 2, aftrekbaar: 157.5 });
});

test("[BUITENLANDSE-INKOOP] cents: rounded per invoice, so two readers land on the same euro", () => {
  // 21% of 33,33 is 6,9993 → 7,00 per invoice; three of them 21,00 — not 20,9979 rounded once.
  const r = foreignPurchaseVat([1, 2, 3].map(() => inv({ supplierCountry: "US", totalExBtw: 33.33 })));
  assert.deepEqual(strip(r.nonEu), { grondslag: 99.99, btw: 21, aantal: 3, aftrekbaar: 21 });
});

test("[BUITENLANDSE-INKOOP] the note names the invoices and where the country came from", () => {
  const r = foreignPurchaseVat([
    inv({ invoiceNumber: "LEV-9", supplierVatNumber: "IE6388047V" }),
    inv({ invoiceNumber: "LEV-10", supplierCountry: "US", totalExBtw: 300 }),
  ]);
  const note = foreignPurchaseNote(r)!;
  assert.match(note, /^In rubriek 4a\/4b staan 2 inkoopfacturen/);
  assert.match(note, /LEV-9 \(IE → 4b\)/);
  assert.match(note, /LEV-10 \(US → 4a\)/);
  assert.match(note, /leverancierskaart/, "the owner learns where to fix a wrong country");
  assert.match(note, /zonder land wordt als Nederlands gelezen/, "…and what silence means");
  assert.doesNotMatch(note, /€/, "the amounts are the aangifte's own note, not repeated here");

  const many = foreignPurchaseVat(Array.from({ length: 7 }, (_, k) => inv({ invoiceNumber: `LEV-${k}`, supplierCountry: "US" })));
  assert.match(foreignPurchaseNote(many)!, /\(\+2 meer\)/, "five named, the rest counted");
});

test("[BUITENLANDSE-INKOOP] the CSV carries rubriek, both amounts and the deductible share, and adds up", () => {
  const r = foreignPurchaseVat([
    inv({ invoiceNumber: "LEV-9", supplierVatNumber: "IE6388047V", totalExBtw: 800, supplierName: "Adobe Systems" }),
    inv({ invoiceNumber: "LEV-10", supplierCountry: "US", totalExBtw: 300, supplierName: "OpenAI", aftrekDeel: 0.5 }),
    inv({ invoiceNumber: "LEV-11", supplierVatNumber: "DE123456789", totalExBtw: 100, btwAmount: 19, supplierName: "Hansen GmbH" }),
  ]);
  const csv = buildForeignPurchaseCsv(r, "Q3 2026");
  assert.match(csv, /^BoekBrug — Inkopen uit het buitenland Q3 2026 \(rubriek 4a\/4b\)/);
  assert.match(csv, /CONCEPT\. De verlegde btw is berekend tegen het voorgestelde tarief van 21%/);
  assert.match(csv, /Rubriek;Land;Leverancier;Factuur;Grondslag \(excl\. btw\);Verlegde btw;Aftrekbaar in 5b/);
  assert.match(csv, /4b;IE;Adobe Systems;LEV-9;800,00;168,00;168,00/);
  assert.match(csv, /4a;US;OpenAI;LEV-10;300,00;63,00;31,50/);
  assert.match(csv, /4a;;;Totaal buiten de EU;300,00;63,00;31,50/);
  assert.match(csv, /4b;;;Totaal binnen de EU;800,00;168,00;168,00/);
  assert.match(csv, /Niet verlegd — op deze facturen van een buitenlandse leverancier is btw berekend/);
  assert.match(csv, /DE;Hansen GmbH;LEV-11;19,00/);
  assert.doesNotMatch(csv, /LIJST, geen berekening/, "it is a calculation now, and says so");
});
