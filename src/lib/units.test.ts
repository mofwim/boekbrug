// [UNIT] Pure node test — run: npx tsx --test src/lib/units.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { UNITS, DEFAULT_UNIT_CODE, toUnitCode, unitLabel, isKnownUnit } from "./units";

test("every code is unique and shaped like UN/ECE Rec 20", () => {
  const codes = UNITS.map((u) => u.code);
  assert.equal(new Set(codes).size, codes.length, "no duplicate codes");
  for (const c of codes) {
    assert.match(c, /^[A-Z0-9]{2,3}$/, `${c} does not look like a Rec 20 code`);
  }
  const names = UNITS.map((u) => u.name);
  assert.equal(new Set(names).size, names.length, "no duplicate names");
});

test("the codes that matter are present, and with the RIGHT value", () => {
  // This is the core. A wrong code here means an e-invoice describes something other than what
  // was delivered — the amount is right, the document is not.
  const byName = Object.fromEntries(UNITS.map((u) => [u.name, u.code]));
  assert.equal(byName["stuk"], "C62");
  assert.equal(byName["uur"], "HUR");
  assert.equal(byName["dag"], "DAY");
  assert.equal(byName["maand"], "MON");
  assert.equal(byName["m²"], "MTK");
  assert.equal(byName["m¹"], "MTR");
  assert.equal(byName["km"], "KMT");
  assert.equal(byName["kg"], "KGM");
  assert.equal(byName["liter"], "LTR");
});

test("THE BUG THIS FIXES: hours and metres were all 'pieces'", () => {
  // ubl-export wrote C62 on every line. 2 hours of labour went out as "2 pieces".
  assert.notEqual(toUnitCode("uur"), DEFAULT_UNIT_CODE);
  assert.notEqual(toUnitCode("m²"), DEFAULT_UNIT_CODE);
  assert.notEqual(toUnitCode("km"), DEFAULT_UNIT_CODE);
  assert.equal(toUnitCode("uur"), "HUR");
  assert.equal(toUnitCode("m²"), "MTK");
});

test("old free text still translates correctly", () => {
  // The field was free for years, so it holds all sorts of things. Re-exporting an old invoice
  // must not become worse than it was.
  for (const [text, code] of [
    ["Uur", "HUR"], ["UREN", "HUR"], ["u", "HUR"], ["  h  ", "HUR"],
    ["st", "C62"], ["st.", "C62"], ["stuks", "C62"], ["Stuk", "C62"],
    ["m2", "MTK"], ["vierkante meter", "MTK"],
    ["meter", "MTR"], ["m1", "MTR"], ["strekkende meter", "MTR"],
    ["kilometer", "KMT"], ["kilo", "KGM"], ["ltr", "LTR"],
    ["mnd", "MON"], ["dagen", "DAY"], ["paar", "E96"],
  ] as const) {
    assert.equal(toUnitCode(text), code, `"${text}" → ${code}`);
  }
});

test("whoever types the code itself gets it back", () => {
  assert.equal(toUnitCode("HUR"), "HUR");
  assert.equal(toUnitCode("hur"), "HUR");
  assert.equal(toUnitCode("MTK"), "MTK");
});

test("empty or unknown falls back to what already happens — no existing invoice changes", () => {
  // The failure direction. An invented code is worse than the code that was already there: the
  // e-invoice then describes something specific that is wrong, instead of something generic.
  for (const junk of ["", "   ", null, undefined, "zakken", "rol", "keer", "💡", "42"]) {
    assert.equal(toUnitCode(junk), DEFAULT_UNIT_CODE, `${JSON.stringify(junk)} → C62`);
  }
});

test("the label reads as Dutch, with the right singular/plural", () => {
  assert.equal(unitLabel("stuk", 1), "stuk");
  assert.equal(unitLabel("stuk", 3), "stuks");
  // 'uur' stays 'uur' in the plural — nobody writes "3 uren" on an invoice.
  assert.equal(unitLabel("uur", 1), "uur");
  assert.equal(unitLabel("uur", 3), "uur");
  assert.equal(unitLabel("dag", 2), "dagen");
  assert.equal(unitLabel("maand", 6), "maanden");
  // m² has no plural and must not be given one.
  assert.equal(unitLabel("m²", 14), "m²");
  assert.equal(unitLabel("", 3), "", "no unit = no word on the line");
});

test("unknown free text stays on screen exactly as the user wrote it", () => {
  // It gets C62 in the e-invoice (we cannot know better), but on their own screen their own word
  // must remain — silently replacing it with "stuk" would be a change to their invoice that they
  // did not make.
  assert.equal(unitLabel("rol", 2), "rol");
  assert.equal(unitLabel("zakken", 5), "zakken");
});

test("isKnownUnit looks at the LIST, not at the outcome of the translation", () => {
  // The trap: "code !== C62" looks like a good check, but 'stuk' is perfectly known AND C62.
  assert.equal(isKnownUnit("stuk"), true, "stuk is known, even though it is C62");
  assert.equal(isKnownUnit("stuks"), true);
  assert.equal(isKnownUnit("st"), true);
  assert.equal(isKnownUnit("uur"), true);
  assert.equal(isKnownUnit("HUR"), true);
  assert.equal(isKnownUnit("rol"), false);
  assert.equal(isKnownUnit(""), false);
  assert.equal(isKnownUnit(null), false);
});
