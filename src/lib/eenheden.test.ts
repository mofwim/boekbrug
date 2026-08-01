// [EENHEID] Pure node test — run: npx tsx --test src/lib/eenheden.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { EENHEDEN, STANDAARD_CODE, eenheidCode, eenheidLabel, isBekendeEenheid } from "./eenheden";

test("elke code is uniek en heeft de vorm van UN/ECE Rec 20", () => {
  const codes = EENHEDEN.map((e) => e.code);
  assert.equal(new Set(codes).size, codes.length, "geen dubbele codes");
  for (const c of codes) {
    assert.match(c, /^[A-Z0-9]{2,3}$/, `${c} ziet er niet uit als een Rec 20-code`);
  }
  const namen = EENHEDEN.map((e) => e.naam);
  assert.equal(new Set(namen).size, namen.length, "geen dubbele namen");
});

test("de codes die ertoe doen staan er, en met de JUISTE waarde", () => {
  // Dit is de kern. Een verkeerde code hier betekent dat een e-factuur iets anders beschrijft
  // dan er geleverd is — het bedrag klopt, het document niet.
  const byNaam = Object.fromEntries(EENHEDEN.map((e) => [e.naam, e.code]));
  assert.equal(byNaam["stuk"], "C62");
  assert.equal(byNaam["uur"], "HUR");
  assert.equal(byNaam["dag"], "DAY");
  assert.equal(byNaam["maand"], "MON");
  assert.equal(byNaam["m²"], "MTK");
  assert.equal(byNaam["m¹"], "MTR");
  assert.equal(byNaam["km"], "KMT");
  assert.equal(byNaam["kg"], "KGM");
  assert.equal(byNaam["liter"], "LTR");
});

test("DE FOUT DIE DIT REPAREERT: uren en meters waren allemaal 'stuks'", () => {
  // ubl-export schreef C62 op elke regel. 2 uur arbeid ging de deur uit als "2 stuks".
  assert.notEqual(eenheidCode("uur"), STANDAARD_CODE);
  assert.notEqual(eenheidCode("m²"), STANDAARD_CODE);
  assert.notEqual(eenheidCode("km"), STANDAARD_CODE);
  assert.equal(eenheidCode("uur"), "HUR");
  assert.equal(eenheidCode("m²"), "MTK");
});

test("oude vrije tekst wordt alsnog goed vertaald", () => {
  // Het veld was jarenlang vrij, dus er staat van alles in. Een oude factuur opnieuw exporteren
  // mag niet slechter worden dan hij was.
  for (const [tekst, code] of [
    ["Uur", "HUR"], ["UREN", "HUR"], ["u", "HUR"], ["  h  ", "HUR"],
    ["st", "C62"], ["st.", "C62"], ["stuks", "C62"], ["Stuk", "C62"],
    ["m2", "MTK"], ["vierkante meter", "MTK"],
    ["meter", "MTR"], ["m1", "MTR"], ["strekkende meter", "MTR"],
    ["kilometer", "KMT"], ["kilo", "KGM"], ["ltr", "LTR"],
    ["mnd", "MON"], ["dagen", "DAY"], ["paar", "E96"],
  ] as const) {
    assert.equal(eenheidCode(tekst), code, `"${tekst}" → ${code}`);
  }
});

test("wie de code zelf intypt krijgt hem terug", () => {
  assert.equal(eenheidCode("HUR"), "HUR");
  assert.equal(eenheidCode("hur"), "HUR");
  assert.equal(eenheidCode("MTK"), "MTK");
});

test("leeg of onbekend valt terug op wat er NU al gebeurt — geen enkele bestaande factuur verandert", () => {
  // De faalrichting. Een verzonnen code is erger dan de code die er al stond: dan beschrijft de
  // e-factuur iets specifieks dat niet klopt, in plaats van iets algemeens.
  for (const rommel of ["", "   ", null, undefined, "zakken", "rol", "keer", "💡", "42"]) {
    assert.equal(eenheidCode(rommel), STANDAARD_CODE, `${JSON.stringify(rommel)} → C62`);
  }
});

test("het label leest als Nederlands, met het juiste enkel-/meervoud", () => {
  assert.equal(eenheidLabel("stuk", 1), "stuk");
  assert.equal(eenheidLabel("stuk", 3), "stuks");
  // 'uur' blijft 'uur' in het meervoud — "3 uren" schrijft niemand op een factuur.
  assert.equal(eenheidLabel("uur", 1), "uur");
  assert.equal(eenheidLabel("uur", 3), "uur");
  assert.equal(eenheidLabel("dag", 2), "dagen");
  assert.equal(eenheidLabel("maand", 6), "maanden");
  // m² heeft geen meervoud en hoort er ook geen te krijgen.
  assert.equal(eenheidLabel("m²", 14), "m²");
  assert.equal(eenheidLabel("", 3), "", "geen eenheid = geen woord op de regel");
});

test("onbekende vrije tekst blijft op het scherm staan zoals de gebruiker hem schreef", () => {
  // Hij krijgt C62 in de e-factuur (dat kunnen we niet beter weten), maar op zijn eigen scherm
  // hoort zijn eigen woord te blijven staan — het stilletjes vervangen door "stuk" zou een
  // wijziging in zijn factuur zijn die hij niet heeft gemaakt.
  assert.equal(eenheidLabel("rol", 2), "rol");
  assert.equal(eenheidLabel("zakken", 5), "zakken");
});

test("isBekendeEenheid kijkt naar de LIJST, niet naar de uitkomst van de vertaling", () => {
  // De valkuil: "code !== C62" lijkt een goede toets, maar 'stuk' is volkomen bekend én C62.
  assert.equal(isBekendeEenheid("stuk"), true, "stuk is bekend, ook al is het C62");
  assert.equal(isBekendeEenheid("stuks"), true);
  assert.equal(isBekendeEenheid("st"), true);
  assert.equal(isBekendeEenheid("uur"), true);
  assert.equal(isBekendeEenheid("HUR"), true);
  assert.equal(isBekendeEenheid("rol"), false);
  assert.equal(isBekendeEenheid(""), false);
  assert.equal(isBekendeEenheid(null), false);
});
