// [CREDITNOTA-SIGNAAL] Pure node test — run: npx tsx --test src/lib/creditnota-signal.test.ts
//
// Twee kanten, en de tweede is de belangrijkste:
//   1. het echte geval wordt herkend (CR naast RE van dezelfde leverancier);
//   2. het signaal blijft STIL bij alles wat er alleen maar op lijkt. Een vals signaal stuurt de
//      eigenaar naar een factuur die hij wél moet betalen, en een omklap daarvan levert een
//      aanmaning op. Zwijgen is hier de veilige kant, en daar gaan de meeste tests over.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  numberPrefix, looksLikeCreditnota, creditnotaSignalText, creditnotaSignConflict,
} from "./creditnota-signal";

test("[TEGENSPRAAK] een creditnota met een POSITIEF bedrag is geen vermoeden maar een fout", () => {
  // De lezer heeft de soort al vastgesteld; er valt niets te raden. Het geld staat de verkeerde
  // kant op: het telt mee in "nog te betalen" en de voorbelasting wordt opgeteld in plaats van
  // afgetrokken.
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: 51.8 }), true);
  // De goede toestand geeft niets.
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: -51.8 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: 0 }), false);
  // En een gewone factuur valt hier per definitie buiten — die hoort positief te zijn.
  assert.equal(creditnotaSignConflict({ invoiceType: "factuur", totalIncBtw: 871.4 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: null, totalIncBtw: 871.4 }), false);
  assert.equal(creditnotaSignConflict({ invoiceType: "creditnota", totalIncBtw: Number.NaN }), false);
});

/** Het geval uit de praktijk: Dutch Sweets stuurt CR-creditnota's naast RE-facturen. */
const DUTCH_SWEETS = ["CR0300343", "CR0300510", "RE0801378"];

const check = (over: Partial<Parameters<typeof looksLikeCreditnota>[0]> = {}) =>
  looksLikeCreditnota({
    invoiceNumber: "CR0300343",
    totalIncBtw: 51.8,
    invoiceType: "factuur",
    vendorNumbers: DUTCH_SWEETS,
    ...over,
  });

test("het voorvoegsel is de letters vooraan, en niets anders", () => {
  assert.equal(numberPrefix("CR0300343"), "CR");
  assert.equal(numberPrefix("RE0801378"), "RE");
  assert.equal(numberPrefix("2033161"), "", "een puur numeriek nummer heeft geen voorvoegsel");
  assert.equal(numberPrefix("cr-123"), "CR", "hoofdletterloos telt net zo goed");
  assert.equal(numberPrefix("  CN 99 "), "CN");
  assert.equal(numberPrefix(null), "");
  assert.equal(numberPrefix(""), "");
  assert.equal(numberPrefix("F2033161"), "F");
});

test("het echte geval wordt herkend", () => {
  const s = check();
  assert.equal(s.suspected, true);
  assert.equal(s.prefix, "CR");
  assert.equal(s.contrastPrefix, "RE");
  // En de uitleg noemt beide voorvoegsels, zodat de eigenaar zelf kan nakijken wat wij zagen.
  const text = creditnotaSignalText(s);
  assert.ok(text && text.includes("CR") && text.includes("RE"), text ?? "");
});

test("een al goed geboekte creditnota geeft GEEN signaal", () => {
  // Dit is de gewenste eindtoestand — daar hoort geen waarschuwing bij.
  assert.equal(check({ invoiceType: "creditnota" }).suspected, false);
});

test("een al negatief opgeslagen bedrag geeft GEEN signaal", () => {
  // Het geld staat dan al de goede kant op: hij gaat van het saldo af. Dit signaal gaat over geld
  // dat verkeerd om staat, niet over de etikettering.
  assert.equal(check({ totalIncBtw: -51.8 }).suspected, false);
  assert.equal(check({ totalIncBtw: 0 }).suspected, false);
});

test("[STIL] een onbekend voorvoegsel zwijgt", () => {
  // "F", "INV", "KR" — wij weten niet wat die betekenen, dus zeggen we niets.
  for (const nr of ["F0300343", "INV0300343", "KR0300343", "2033161"]) {
    assert.equal(check({ invoiceNumber: nr }).suspected, false, nr);
  }
});

test("[STIL] zonder tegenhanger van dezelfde leverancier zwijgt het signaal", () => {
  // Dit is de tweede eis, en de belangrijkste: het bewijs komt van de leverancier zelf, niet van
  // onze aanname over twee letters. Gebruikt hij ALLES met CR, dan zegt CR niets bijzonders.
  assert.equal(check({ vendorNumbers: ["CR0300343", "CR0300510", "CR0300777"] }).suspected, false);
  assert.equal(check({ vendorNumbers: ["CR0300343"] }).suspected, false, "alleen zichzelf is geen bewijs");
  assert.equal(check({ vendorNumbers: [] }).suspected, false);
  // Nummerloze documenten van dezelfde leverancier tellen niet als tegenhanger.
  assert.equal(check({ vendorNumbers: ["CR0300343", null, "", "   "] }).suspected, false);
  // Maar een puur numeriek nummer heeft geen voorvoegsel en is dus ook geen tegenhanger — anders
  // zou elke leverancier die één keer een nummer zonder letters stuurt een tegenhanger "hebben".
  assert.equal(check({ vendorNumbers: ["CR0300343", "2033161"] }).suspected, false);
});

test("de andere bekende creditmarkeringen werken ook", () => {
  for (const nr of ["CN0001", "CRN0001", "CRED0001", "CREDIT0001", "CRE0001"]) {
    assert.equal(
      check({ invoiceNumber: nr, vendorNumbers: [nr, "RE0801378"] }).suspected,
      true,
      nr,
    );
  }
});

test("onzin komt er niet doorheen", () => {
  assert.equal(check({ invoiceNumber: null }).suspected, false);
  assert.equal(check({ totalIncBtw: null }).suspected, false);
  assert.equal(check({ totalIncBtw: Number.NaN }).suspected, false);
  assert.equal(check({ totalIncBtw: Number.POSITIVE_INFINITY }).suspected, false);
  assert.equal(creditnotaSignalText({ suspected: false, prefix: "", contrastPrefix: null }), null);
});

test("de hele lijst uit de schermafdruk levert precies twee signalen", () => {
  // Drie documenten van één leverancier, alle drie positief geboekt als 'factuur'. De twee
  // CR-nummers horen op te vallen, de RE-factuur hoort met rust gelaten te worden.
  const rows = [
    { invoiceNumber: "CR0300343", totalIncBtw: 51.8 },
    { invoiceNumber: "CR0300510", totalIncBtw: 24.25 },
    { invoiceNumber: "RE0801378", totalIncBtw: 871.4 },
  ];
  const flagged = rows.filter(
    (r) => looksLikeCreditnota({ ...r, invoiceType: "factuur", vendorNumbers: DUTCH_SWEETS }).suspected,
  );
  assert.deepEqual(flagged.map((r) => r.invoiceNumber), ["CR0300343", "CR0300510"]);
  // En wat er ten onrechte in "nog te betalen" zit is de som van die twee.
  assert.equal(Math.round(flagged.reduce((s, r) => s + r.totalIncBtw, 0) * 100) / 100, 76.05);
});
