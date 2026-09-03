// src/lib/readiness-dubbel.test.ts
// [DUBBEL-TERUGKIJKEN] Dubbele boekingen horen op de klaar-kaart, met naam en toenaam.
// Run: npx tsx --test src/lib/readiness-dubbel.test.ts
//
// Eigen bestand: readiness.test.ts draait als script met check() en een exitcode, geen node:test.
// Er testen aan toevoegen levert een bestand op dat groen meldt zonder de asserties te draaien —
// dat is één keer gebeurd in deze sessie en staat daarom hier opgeschreven.

import test from "node:test";
import assert from "node:assert/strict";
import { buildReadiness, type ReadinessSignals } from "./readiness";

const schoon = (over: Partial<ReadinessSignals> = {}): ReadinessSignals => ({
  quarterLabel: "Q3 2026",
  verifiedInvoiceCount: 40, invoicesWithEvidence: 40, missingEvidence: [],
  bankTxCount: 120, undocumentedCount: 0, unmatchedIncomeCount: 0,
  usesTurnover: true, turnoverDays: 90, reconExceptions: [],
  hasSales: true, cashOmzetZonderBtw: 0, quarterDays: 90,
  hasUndecidableRate: false, hasEuPurchase: false,
  ...over,
});

test("[DUBBEL-TERUGKIJKEN] zonder dubbelen zegt de kaart er niets over", () => {
  // De tegenproef eerst: een melding die er altijd staat is geen melding.
  const r = buildReadiness(schoon());
  assert.equal(r.risks.some((x) => /twee keer/.test(x.title)), false);
  const nul = buildReadiness(schoon({ doubleBookedCount: 0, doubleBookedNumbers: [] }));
  assert.equal(nul.risks.some((x) => /twee keer/.test(x.title)), false);
});

test("[DUBBEL-TERUGKIJKEN] met dubbelen staat het er, en het noemt de facturen", () => {
  const r = buildReadiness(schoon({
    doubleBookedCount: 6,
    doubleBookedNumbers: ["26700385", "26701681", "202603719", "202616271", "26700603", "VHF0001005310"],
  }));
  const item = r.risks.find((x) => /twee keer/.test(x.title));
  assert.ok(item, "de dubbele boekingen staan niet op de kaart");
  assert.match(item.title, /6 facturen/);

  // DE reden dat de nummers meegaan: zonder namen stuurt de kaart de ondernemer naar een lijst van
  // zeshonderd facturen met de mededeling dat er zes fout zijn. Dan is de melding het werk.
  assert.match(item.detail ?? "", /26700385/);
  assert.match(item.detail ?? "", /26701681/);
  // …maar niet alle zes: vier bij naam, de rest geteld.
  assert.match(item.detail ?? "", /en 2 andere/);

  // En de app mag niet beweren dat ze het oplost.
  assert.match(item.detail ?? "", /op het papier/);
  assert.match(item.detail ?? "", /verandert er niets aan/);
});

test("[DUBBEL-TERUGKIJKEN] het is een risico en geen gat, maar 100% is het niet meer", () => {
  // Welke van de twee de echte is, staat op het papier. De app die dat zelf beslist zou een
  // geldige factuur kunnen archiveren, en dat is een duurdere fout dan een kwartaal dat 'bijna'
  // zegt. Dus: géén gat, de dimensiescores blijven heel, en de knop blijft werken.
  const r = buildReadiness(schoon({ doubleBookedCount: 2, doubleBookedNumbers: ["A1", "A2"] }));
  assert.equal(r.missing.some((x) => /twee keer/.test(x.title)), false, "het hoort geen gat te zijn");
  // `subscore`, niet `score`: dat laatste veld bestaat niet op ReadinessDimension. De eerste versie
  // van deze lus vergeleek undefined met undefined en slaagde dus altijd — tsx --test typecheckt
  // niet, dus alleen `tsc --noEmit` in de poorten zag het. Een assertie die niet kan falen is geen
  // assertie; dit is dezelfde les als de kiezer die "datum dichtbij" toonde.
  for (const d of r.dimensions) {
    const zelfde = buildReadiness(schoon()).dimensions.find((x) => x.key === d.key);
    assert.equal(typeof d.subscore, "number", `dimensie ${d.key} heeft geen subscore`);
    assert.equal(d.subscore, zelfde?.subscore, `dimensie ${d.key} mag niet zakken door een dubbele boeking`);
  }

  // …maar 100% wél. Deze test beweerde eerst dat de score onaangeroerd moest blijven; readiness.ts
  // kapt een volle score af op 99 zodra er ook maar één risico openstaat, en die regel is beter dan
  // mijn aanname: "100% klaar" naast zes dubbel geboekte facturen is precies het soort geruststelling
  // dat dit scherm niet mag geven.
  assert.equal(buildReadiness(schoon()).score, 100, "de schone tegenproef is nog steeds 100");
  assert.equal(r.score, 99, "met een openstaand risico is het geen 100 meer");

  // …en 'klaar' blijft het wél, want een RISICO is geen gat. readiness.ts zegt het met zoveel
  // woorden: gedocumenteerde risico's reizen gemarkeerd mee naar de boekhouder, een gat verstopt
  // zich nooit. Ook deze assertie stond er eerst andersom in. Drie keer in deze taak bleek de
  // regel in de code beter doordacht dan mijn aanname erover — het is de moeite om dat op te
  // schrijven in plaats van de code naar de test toe te buigen.
  assert.equal(r.ready, true, "een risico blokkeert 'klaar' niet; alleen een gat doet dat");
  assert.equal(r.status, "ready");
});

test("[DUBBEL-TERUGKIJKEN] één dubbele leest als één", () => {
  const r = buildReadiness(schoon({ doubleBookedCount: 1, doubleBookedNumbers: ["26700385"] }));
  const item = r.risks.find((x) => /twee keer/.test(x.title));
  assert.ok(item);
  assert.match(item.title, /^1 factuur staat twee keer/);
  assert.doesNotMatch(item.detail ?? "", /en \d+ andere/);
});

test("[DUBBEL-TERUGKIJKEN] de knop wijst naar een pagina die bestaat", () => {
  // ?filter=dubbel bestond niet: de filters zijn all/received/paid/auto, en een onbekende waarde
  // valt terug op "Alle". De eerste versie van deze kaart linkte er wél naartoe.
  const r = buildReadiness(schoon({ doubleBookedCount: 1, doubleBookedNumbers: ["X"] }));
  const item = r.risks.find((x) => /twee keer/.test(x.title));
  assert.equal(item?.fix?.href, "/dashboard/incoming/manage");
  assert.doesNotMatch(item?.fix?.href ?? "", /filter=/);
});
