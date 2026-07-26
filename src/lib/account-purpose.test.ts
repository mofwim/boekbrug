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

test("het gewone pad belooft de uitkomst, niet een lijst functies", () => {
  // Deze test verving een oudere die eiste dat er "factuur" in stond. Dat was precies de
  // positionering die wij hebben losgelaten: een opsomming van functies nodigt uit tot
  // vergelijken met pakketten die op elke regel méér hebben. Nu moet er staan wat de
  // gebruiker eraan OVERHOUDT.
  const gewoon = purposeCopy("boekhouden");
  const tekst = `${gewoon.subtitle} ${gewoon.promise}`.toLowerCase();

  assert.ok(tekst.includes("kwartaal"), "de uitkomst — het afgesloten kwartaal — hoort erin");
  assert.ok(tekst.includes("boekhouder"), "en voor wie het klaarstaat");
  assert.notEqual(gewoon.subtitle, purposeCopy("archief").subtitle);
});

test("geen enkel pad belooft dat het kwartaal zichzelf doet", () => {
  // De grens uit voorwaarden §4.3: een AI-uitkomst is een SUGGESTIE, nooit een feit, en de
  // controle blijft bij de gebruiker. Marketingtekst die "automatisch gedaan" zegt maakt van
  // die clausule een loze zin — en van ons een partij die wordt aangesproken op iets wat wij
  // nergens hebben willen beloven. Vandaar overal "staat klaar" en nooit "is gedaan".
  const verboden = ["vanzelf gedaan", "automatisch gedaan", "doet zichzelf", "is gedaan", "wij doen je boekhouding"];
  for (const purpose of ["boekhouden", "archief"] as const) {
    const c = purposeCopy(purpose);
    const alles = `${c.subtitle} ${c.promise} ${c.reassurance} ${c.cta}`.toLowerCase();
    for (const zin of verboden) {
      assert.equal(alles.includes(zin), false, `"${zin}" belooft meer dan §4.3 toestaat (${purpose})`);
    }
  }
});

test("een archiefaccount is geen nieuwe rol", () => {
  // Rollen bepalen wie wat van wie mag zien; een archief verandert daar niets aan. Een derde
  // rol zou elke RLS-policy een extra geval geven voor een verschil in begroeting.
  assert.equal(ARCHIEF_ROLE, "zzper");
});
