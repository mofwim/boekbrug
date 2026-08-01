// [PRIJS-MODUS] Pure node test — run: npx tsx --test src/lib/price-mode.test.ts
//
// De eigenschap die telt is niet "de deling klopt" maar: HET BEDRAG DAT JE INTYPT IS HET BEDRAG
// DAT JE KLANT BETAALT. Een cent verschil daar is een cent die niemand kan verklaren en die pas
// zichtbaar wordt als de factuur al verstuurd is.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  exFromIncl, inclFromEx, priceFieldValue, priceFieldToStored, repriceForRateChange, toDisplayCents,
} from "./price-mode";

/** Wat de factuurkop uit een regel berekent — exact zoals het scherm het doet. */
function lineTotals(ex: number, qty: number, rate: number) {
  const totalEx = qty * ex;
  const btw = qty * ex * (rate / 100);
  return { totalEx, btw, incl: totalEx + btw };
}

test("21%: wat je intypt is wat je klant betaalt", () => {
  const stored = priceFieldToStored(10, 21, "incl");
  const { incl } = lineTotals(stored, 1, 21);
  assert.equal(toDisplayCents(incl), 10);
  // En met een aantal erbij blijft het kloppen — hier gaat een afgeronde ex-prijs juist mis.
  assert.equal(toDisplayCents(lineTotals(stored, 3, 21).incl), 30);
  assert.equal(toDisplayCents(lineTotals(stored, 7, 21).incl), 70);
});

test("een AFGERONDE ex-prijs zou de klant een cent schelen — daarom slaan we hem niet af", () => {
  // Dit is het scenario dat de keuze in het bestand rechtvaardigt: 10 / 1,21 = 8,264462…
  // Rond je dat op 8,26 af, dan betaalt de klant 9,99 terwijl er 10 is ingetypt.
  const afgerond = 8.26;
  assert.equal(toDisplayCents(lineTotals(afgerond, 1, 21).incl), 9.99);
  const exact = priceFieldToStored(10, 21, "incl");
  assert.equal(toDisplayCents(lineTotals(exact, 1, 21).incl), 10);
});

test("9% en 0% doen hetzelfde", () => {
  assert.equal(toDisplayCents(lineTotals(priceFieldToStored(109, 9, "incl"), 1, 9).incl), 109);
  // 0%: incl en excl zijn hetzelfde getal, de modus mag er niets aan veranderen.
  assert.equal(priceFieldToStored(50, 0, "incl"), 50);
  assert.equal(priceFieldValue(50, 0, "incl"), 50);
});

test("excl-modus verandert helemaal niets aan het oude gedrag", () => {
  assert.equal(priceFieldToStored(41.32, 21, "excl"), 41.32);
  assert.equal(priceFieldValue(41.32, 21, "excl"), 41.32);
});

test("het veld toont in incl-modus exact wat er is ingetypt (stabiel heen en weer)", () => {
  for (const typed of [10, 50, 99.99, 1234.5, 0.05, 7.77]) {
    const stored = priceFieldToStored(typed, 21, "incl");
    assert.equal(priceFieldValue(stored, 21, "incl"), typed, `${typed} incl`);
  }
});

test("omschakelen van modus verandert de opgeslagen prijs niet — alleen wat je ziet", () => {
  const stored = priceFieldToStored(10, 21, "incl"); // 8,264462…
  // Dezelfde regel, twee brillen. De onderliggende waarde blijft één waarde.
  assert.equal(priceFieldValue(stored, 21, "incl"), 10);
  assert.equal(priceFieldValue(stored, 21, "excl"), 8.26);
});

test("[TARIEF] in incl-modus blijft de prijs voor de klant staan als het tarief wijzigt", () => {
  // "€ 50 all-in" blijft € 50 all-in; de marge beweegt, niet de prijs.
  const stored21 = priceFieldToStored(50, 21, "incl");
  const stored9 = repriceForRateChange(stored21, 21, 9, "incl");
  assert.equal(toDisplayCents(lineTotals(stored9, 1, 9).incl), 50);
  // Naar 0% toe ook: dan IS de prijs de ex-prijs.
  const stored0 = repriceForRateChange(stored21, 21, 0, "incl");
  assert.equal(toDisplayCents(stored0), 50);
});

test("[TARIEF] in excl-modus blijft de ingetypte prijs staan en beweegt het totaal — zoals altijd", () => {
  assert.equal(repriceForRateChange(100, 21, 9, "excl"), 100);
  assert.equal(toDisplayCents(lineTotals(100, 1, 9).incl), 109);
});

test("onzin komt er niet doorheen", () => {
  assert.equal(priceFieldToStored(Number.NaN, 21, "incl"), 0);
  assert.equal(priceFieldToStored(Number.POSITIVE_INFINITY, 21, "incl"), 0);
  assert.equal(exFromIncl(10, Number.NaN), 10, "een kapot tarief mag geen stille verhoging worden");
  assert.equal(inclFromEx(10, null), 10);
  // Een negatief tarief bestaat niet; behandel het als 0% in plaats van er iets van te maken.
  assert.equal(exFromIncl(10, -21), 10);
});

test("een creditnota (negatief bedrag) rekent net zo om", () => {
  // Het scherm laat de gebruiker positief typen en zet zelf het minteken; mocht er toch een
  // negatief bedrag langskomen, dan mag de omrekening niet van teken wisselen.
  const stored = priceFieldToStored(-10, 21, "incl");
  assert.equal(toDisplayCents(lineTotals(stored, 1, 21).incl), -10);
});

test("meerdere regels tellen op tot wat er is ingetypt", () => {
  // Drie all-in prijzen bij verschillende tarieven: het factuurtotaal is de som van wat de
  // ondernemer heeft ingetypt, tot op de cent.
  const regels = [
    { typed: 10, qty: 2, rate: 21 },
    { typed: 4.5, qty: 3, rate: 9 },
    { typed: 25, qty: 1, rate: 0 },
  ];
  const stored = regels.map((r) => ({ ...r, ex: priceFieldToStored(r.typed, r.rate, "incl") }));
  const ex = stored.reduce((s, r) => s + r.qty * r.ex, 0);
  const btw = stored.reduce((s, r) => s + r.qty * r.ex * (r.rate / 100), 0);
  const ingetypt = regels.reduce((s, r) => s + r.qty * r.typed, 0); // 20 + 13,50 + 25
  assert.equal(toDisplayCents(ex + btw), toDisplayCents(ingetypt));
  assert.equal(toDisplayCents(ingetypt), 58.5);
});
