// [BEDRAG-DRIELUIK] Pure node test — run: npx tsx --test src/lib/amount-triplet.test.ts
//
// De eigenschap die telt: NA ELKE BEWERKING KLOPT excl + BTW = totaal. Dat was de reden dat het
// totaal ooit niet invulbaar was; nu het dat wél is, moet die garantie hier bewezen worden en niet
// in het scherm gehoopt.
//
// En daarnaast: de vier facturen die vastliepen moeten met de bedragen die LETTERLIJK op het
// papier staan in te vullen zijn, zonder dat de ondernemer iets uitrekent.
import { test } from "node:test";
import assert from "node:assert/strict";

import { setExcl, setBtw, setIncl, tripletHolds, type AmountTriplet } from "./amount-triplet";

const leeg: AmountTriplet = { ex: 0, btw: 0, incl: 0 };
const round2 = (n: number) => Math.round(n * 100) / 100;

test("de identiteit overleeft elke bewerking", () => {
  let t = leeg;
  for (const stap of [
    () => (t = setExcl(t, 100)),
    () => (t = setBtw(t, 21)),
    () => (t = setIncl(t, 1078.46)),
    () => (t = setBtw(t, 88.73)),
    () => (t = setExcl(t, -123)),
    () => (t = setIncl(t, -109.58)),
  ]) {
    stap();
    assert.ok(tripletHolds(t), JSON.stringify(t));
  }
});

test("[A · kratten] totaal en BTW van het papier → het excl-bedrag volgt", () => {
  // Op de factuur staat: totaal 1.078,46 en totaal BTW 88,73. Het bedrag waar de lezer over
  // struikelde (ex. BTW 989,73) hoeft de ondernemer niet meer zelf uit te rekenen.
  let t: AmountTriplet = { ex: 985.87, btw: 88.73, incl: 1074.6 }; // wat er fout stond
  t = setIncl(t, 1078.46);
  assert.equal(round2(t.ex), 989.73);
  assert.equal(t.btw, 88.73, "de BTW blijft staan — die is niet aangeraakt");
  assert.ok(tripletHolds(t));
});

test("[C · twee tarieven] hier is juist de BTW het veld dat je aanraakt", () => {
  // Papier: ex. BTW 3.413,92 klopte al; de BTW moest 233,20 + 172,70 = 405,90 worden.
  let t: AmountTriplet = { ex: 3413.92, btw: 995.9, incl: 4409.82 };
  t = setBtw(t, 405.9);
  assert.equal(round2(t.incl), 3819.82, "het totaal komt uit op wat er op het papier staat");
  assert.equal(t.ex, 3413.92);
});

test("[D · retour container] een netto-negatieve factuur is gewoon in te vullen", () => {
  // Papier: Totaal te voldoen −109,58, BTW laag tarief 13,42, Totaal excl. BTW −123,00.
  let t: AmountTriplet = { ex: 26, btw: 13.42, incl: 39.42 }; // wat er fout stond
  t = setBtw(t, 13.42);
  t = setIncl(t, -109.58);
  assert.equal(round2(t.ex), -123, "exact het bedrag onder 'Totaal excl. BTW'");
  assert.ok(tripletHolds(t));
});

test("de BTW blijft staan tenzij je hem zelf aanraakt", () => {
  // Dat is de hele afspraak: van de drie is de BTW het getal dat je het minst wilt zien
  // verspringen — hij gaat rechtstreeks de aangifte in als voorbelasting.
  let t: AmountTriplet = { ex: 100, btw: 21, incl: 121 };
  t = setExcl(t, 200);
  assert.equal(t.btw, 21);
  t = setIncl(t, 500);
  assert.equal(t.btw, 21);
  assert.equal(t.ex, 479);
});

test("een half getypt veld duwt geen NaN de rekensom in", () => {
  let t: AmountTriplet = { ex: 100, btw: 21, incl: 121 };
  t = setIncl(t, Number.NaN);
  assert.equal(t.incl, 0);
  assert.equal(t.ex, -21, "0 − 21: de identiteit blijft kloppen, ook bij onzin");
  assert.ok(tripletHolds(t));
  assert.ok(tripletHolds(setExcl(leeg, null)));
  assert.ok(tripletHolds(setBtw(leeg, undefined)));
});

test("nul blijft nul — een lege factuur wordt niet stiekem iets", () => {
  assert.deepEqual(setIncl(leeg, 0), { ex: 0, btw: 0, incl: 0 });
});
