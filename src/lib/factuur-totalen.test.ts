// [NAMENS] Pure node test — run: npx tsx --test src/lib/factuur-totalen.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { berekenTotalen, controleerRegels, TOEGESTANE_BTW } from "./factuur-totalen";

const r = (quantity: number, unit_price: number, btw_rate: number, description = "werk") =>
  ({ quantity, unit_price, btw_rate, description });

test("de rekensom is LETTERLIJK dezelfde als die in de browser stond", () => {
  // Dit is de hele opdracht van dit bestand: het rekenen verhuist naar de server zonder dat er
  // voor een bestaande eigenaar één cent verandert. De verwachtingen hieronder zijn de uitkomst
  // van de oude computeTotals(), niet van een nettere variant.
  const regels = [r(2, 100, 21), r(1, 50, 9)];
  assert.deepEqual(berekenTotalen(regels), {
    total_ex_btw: 250,
    btw_amount: 2 * 100 * 0.21 + 1 * 50 * 0.09,
    total_inc_btw: 250 + (2 * 100 * 0.21 + 1 * 50 * 0.09),
  });
});

test("er wordt NIET afgerond — een afronding hier zou de boekhouding stil veranderen", () => {
  // 3 × 33,33 met 21% geeft een bedrag met meer dan twee decimalen. De oude code liet dat staan;
  // ging dat hier afronden, dan zou dezelfde factuur vandaag anders uitkomen dan gisteren.
  const t = berekenTotalen([r(3, 33.33, 21)]);
  assert.equal(t.total_ex_btw, 99.99);
  assert.equal(t.btw_amount, 3 * 33.33 * 0.21);
  assert.notEqual(t.btw_amount, Number(t.btw_amount.toFixed(2)), "de ruwe waarde blijft ruw");
});

test("een creditnota staat negatief in de boeken, en het teken wordt op één plek gezet", () => {
  const t = berekenTotalen([r(1, 100, 21)], -1);
  assert.equal(t.total_ex_btw, -100);
  assert.equal(t.btw_amount, -21);
  assert.equal(t.total_inc_btw, -121);
});

test("0% is een echt tarief en telt gewoon mee", () => {
  const t = berekenTotalen([r(1, 100, 0)]);
  assert.equal(t.btw_amount, 0);
  assert.equal(t.total_inc_btw, 100);
});

test("een leeg lijstje is nul, geen NaN", () => {
  assert.deepEqual(berekenTotalen([]), { total_ex_btw: 0, btw_amount: 0, total_inc_btw: 0 });
});

// ── de controle ───────────────────────────────────────────────────────────────────────────────

test("een BTW-tarief dat niet bestaat komt de server niet in", () => {
  // De pagina biedt alleen 0/9/21 aan. Maar de pagina is de kant die je niet in de hand hebt, en
  // een verzonnen tarief belandt hierna in een aangifte.
  assert.deepEqual(TOEGESTANE_BTW, [0, 9, 21]);
  for (const fout of [13, 6, 19, 21.5, -21, NaN]) {
    const uit = controleerRegels([r(1, 100, fout)]);
    assert.equal(uit.ok, false, `${fout}% hoort geweigerd te worden`);
  }
  assert.equal(controleerRegels([r(1, 100, 9)]).ok, true);
});

test("een regel zonder omschrijving mag niet op een factuur", () => {
  // Art. 35a Wet OB: de aard van de geleverde goederen of diensten hoort erop.
  const uit = controleerRegels([{ quantity: 1, unit_price: 100, btw_rate: 21, description: "   " }]);
  assert.equal(uit.ok, false);
  if (!uit.ok) assert.equal(uit.fouten[0].veld, "description");
});

test("een factuur zonder regels bestaat niet", () => {
  assert.equal(controleerRegels([]).ok, false);
  assert.equal(controleerRegels(null).ok, false);
  assert.equal(controleerRegels("regels").ok, false);
});

test("bedragen die geen getal zijn worden geweigerd, niet stilzwijgend 0", () => {
  // Zonder deze controle wordt "honderd euro" een NaN, en NaN in een totaal maakt de hele
  // factuur onbruikbaar zonder dat er ergens een fout verschijnt.
  const uit = controleerRegels([{ quantity: 1, unit_price: "honderd", btw_rate: 21, description: "x" }]);
  assert.equal(uit.ok, false);
  if (!uit.ok) assert.ok(uit.fouten.some((f) => f.veld === "unit_price"));
});

test("alle fouten komen tegelijk terug, niet één per keer", () => {
  const uit = controleerRegels([r(1, 100, 13, ""), r(1, 100, 21)]);
  assert.equal(uit.ok, false);
  if (!uit.ok) {
    assert.ok(uit.fouten.length >= 2, "tarief én omschrijving in één antwoord");
    assert.ok(uit.fouten.every((f) => f.index === 0), "en met de regel erbij waar het misging");
  }
});

test("een absurd lange factuur wordt geweigerd voordat hij de database raakt", () => {
  const veel = Array.from({ length: 201 }, () => r(1, 1, 21));
  assert.equal(controleerRegels(veel).ok, false);
  assert.equal(controleerRegels(veel.slice(0, 200)).ok, true);
});
