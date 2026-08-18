// [VAK-WISSEL] Run: npx tsx --test src/lib/vak-wissel.test.ts
//
// Gemeld met een schermafdruk van /factuur-maken: monteur kiezen, dan schoonmaker, dan transport
// gaf negentien regels van € 0,00 onder elkaar. De vraag erbij was de goede vraag — "moet het bij
// een ander beroep niet gewoon resetten?" — en het antwoord is geen van beide uitersten:
//
//   stapelen  → de lijst die op de foto staat;
//   resetten  → wie én monteur én koerier is, of wie al bedragen had ingevuld, is zijn werk kwijt.
//
// Wat weg mag is precies wat de APP heeft neergezet en niemand heeft aangeraakt.

import { test } from "node:test";
import assert from "node:assert/strict";

import { regelsNaVakwissel, isEigenWerk, vakRegelsVoorFormulier, vakOpties } from "./vak-sjablonen";

const SLUGS = vakOpties().map((v) => v.slug);
const A = SLUGS[0];
const B = SLUGS[1];

test("[VAK-WISSEL] there are at least two professions to switch between", () => {
  assert.ok(A && B && A !== B, "without two templates this file tests nothing");
});

test("[VAK-WISSEL] switching does not stack the untouched lines of the previous one", () => {
  // Het geval van de schermafdruk, in het klein.
  const na1 = regelsNaVakwissel([{ description: "", quantity: "1", unit_price: "", btw_rate: 21 }], "", A);
  assert.equal(na1.length, vakRegelsVoorFormulier(A).length,
    "the first pick replaces the blank starter line instead of keeping it");

  const na2 = regelsNaVakwissel(na1, A, B);
  assert.equal(na2.length, vakRegelsVoorFormulier(B).length,
    "switching leaves the second template only — the first was scaffolding nobody touched");
});

test("[VAK-WISSEL] a price the user typed is never thrown away", () => {
  const sjabloonA = vakRegelsVoorFormulier(A);
  const metPrijs = sjabloonA.map((r, i) => (i === 0 ? { ...r, unit_price: "75,00" } : r));

  const na = regelsNaVakwissel(metPrijs, A, B);
  const bewaard = na.filter((r) => r.unit_price === "75,00");
  assert.equal(bewaard.length, 1, "the one line with money in it survives the switch");
  assert.equal(na.length, 1 + vakRegelsVoorFormulier(B).length,
    "…and nothing else from the old template comes along");
});

test("[VAK-WISSEL] an edited description or quantity counts as the user's work too", () => {
  const sjabloonA = vakRegelsVoorFormulier(A);
  const aangepast = [
    { ...sjabloonA[0], description: "Eigen omschrijving" },
    { ...sjabloonA[1], quantity: "4" },
    ...sjabloonA.slice(2),
  ];
  const na = regelsNaVakwissel(aangepast, A, B);
  assert.ok(na.some((r) => r.description === "Eigen omschrijving"), "a renamed line is the user's");
  assert.ok(na.some((r) => r.quantity === "4"), "a changed quantity is the user's");
  assert.equal(na.length, 2 + vakRegelsVoorFormulier(B).length);
});

test("[VAK-WISSEL] picking the same profession twice does not double it", () => {
  const eenmaal = regelsNaVakwissel([], "", A);
  const tweemaal = regelsNaVakwissel(eenmaal, A, A);
  assert.deepEqual(tweemaal, eenmaal, "re-picking is a no-op, not a second copy");
});

test("[VAK-WISSEL] the judgement itself: scaffolding versus work", () => {
  const omschrijvingen = new Set(vakRegelsVoorFormulier(A).map((r) => r.description));
  const sjabloonregel = vakRegelsVoorFormulier(A)[0];

  assert.equal(isEigenWerk(sjabloonregel, omschrijvingen), false,
    "exactly as the template left it: description unchanged, quantity 1, no price");
  assert.equal(isEigenWerk({ ...sjabloonregel, unit_price: "0,01" }, omschrijvingen), true);
  assert.equal(isEigenWerk({ description: "", quantity: "1", unit_price: "", btw_rate: 21 }, omschrijvingen), false,
    "the blank starter line is not work either — it was there before anyone typed");
  assert.equal(isEigenWerk({ description: "Iets eigens", quantity: "1", unit_price: "", btw_rate: 21 }, omschrijvingen), true,
    "a description the template never wrote is the user's, price or no price");
});
