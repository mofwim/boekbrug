// [KLUIS] Pure node test — run: npx tsx --test src/lib/account-purpose.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ARCHIEF_ROLE,
  DEFAULT_PURPOSE,
  PURPOSE_PARAM,
  landingPath,
  needsOnboarding,
  parsePurpose,
  purposeCopy,
} from "./account-purpose";

test("alleen exact 'archief' kiest het archiefpad", () => {
  assert.equal(parsePurpose("archief"), "archief");
  // De faalrichting is bewust 'boekhouden': dat is het volledige pad met de volledige
  // onboarding, dus een verkeerd gelezen waarde levert hooguit een wizard te veel op.
  // Andersom zou een typefout iemand een onboarding laten overslaan die hij nodig had.
  for (const raw of [null, undefined, "", "Archief", "archiv", "boekhouden", "1", "true"]) {
    assert.equal(parsePurpose(raw), "boekhouden", `${String(raw)} mag het archiefpad niet kiezen`);
  }
  assert.equal(DEFAULT_PURPOSE, "boekhouden");
  assert.equal(PURPOSE_PARAM, "doel");
});

test("een archiefaccount slaat de wizard over en landt in de kluis", () => {
  assert.equal(needsOnboarding("archief"), false);
  assert.equal(landingPath("archief"), "/dashboard/kluis");

  assert.equal(needsOnboarding("boekhouden"), true);
  assert.equal(landingPath("boekhouden"), "/onboarding");
});

test("de archiefteksten beloven niets over facturen", () => {
  const archief = purposeCopy("archief");
  const alles = `${archief.subtitle} ${archief.promise} ${archief.reassurance} ${archief.cta}`.toLowerCase();

  // Deze bezoeker komt niet voor software. Het woord 'factuur' of 'bon' laten vallen geeft
  // hem meteen het gevoel dat hij toch iets moet gaan leren — precies waar /bewaarplicht
  // hem vandaan haalde.
  assert.ok(!alles.includes("factu"), "geen facturen op het archiefpad");
  assert.ok(!alles.includes("bonnen"), "geen bonnen scannen op het archiefpad");
  assert.ok(!alles.includes("btw"), "geen btw-aangifte op het archiefpad");

  // Wat er wél moet staan: dat het gratis begint en dat wij de bewaarplicht niet overnemen.
  assert.ok(alles.includes("gratis"));
  assert.ok(alles.includes("bewaarplicht blijft van jou"));
  assert.ok(alles.includes("tweede exemplaar"));
});

test("het gewone pad houdt zijn eigen tekst", () => {
  const gewoon = purposeCopy("boekhouden");
  assert.ok(gewoon.promise.toLowerCase().includes("factu"));
  assert.notEqual(gewoon.subtitle, purposeCopy("archief").subtitle);
});

test("een archiefaccount is geen nieuwe rol", () => {
  // Rollen bepalen wie wat van wie mag zien; een archief verandert daar niets aan. Een derde
  // rol zou elke RLS-policy een extra geval geven voor een verschil in begroeting.
  assert.equal(ARCHIEF_ROLE, "zzper");
});
