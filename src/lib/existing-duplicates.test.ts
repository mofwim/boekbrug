// src/lib/existing-duplicates.test.ts
// [DUBBEL-TERUGKIJKEN] Vindt de terugblik de dubbelen die er écht staan?
// Run: npx tsx --test src/lib/existing-duplicates.test.ts
//
// scripts/find-existing-duplicates.mts leest de administratie en stelt per factuur dezelfde vraag
// die de intake stelt, maar dan tegen alles wat er toen al lag. Dit bestand voert dezelfde lus uit
// op de zes gevallen zoals ze op 2 september in productie stonden, zodat "de terugblik werkt" een
// gemeten uitspraak is en geen verwachting.

import test from "node:test";
import assert from "node:assert/strict";
import { vindBestaandeDubbelen } from "./existing-duplicates";
import { type PossibleDupCandidate } from "./safecore";

/** De zes paren, met de bedragen en datums die er werkelijk staan. */
const ADMINISTRATIE: PossibleDupCandidate[] = [
  { id: "1", invoice_number: "26700385", client_name: "Doyum Food B.V.", invoice_date: "2026-01-29", total_inc_btw: 222.05 },
  { id: "2", invoice_number: "26700385", client_name: "Doyum Food B.V.", invoice_date: "2026-01-29", total_inc_btw: 239.47 },
  { id: "3", invoice_number: "26701681", client_name: "Enka Horeca B.V.", invoice_date: "2026-01-30", total_inc_btw: 1335.68 },
  { id: "4", invoice_number: "26701681", client_name: "Enka Horeca B.V.", invoice_date: "2026-01-30", total_inc_btw: 1348.14 },
  { id: "5", invoice_number: "202603719", client_name: "Ipekci Slachterij BV", invoice_date: "2026-05-13", total_inc_btw: 1201.07 },
  { id: "6", invoice_number: "202603719", client_name: "Ipekci Slachterij BV", invoice_date: "2026-05-13", total_inc_btw: 1201.07 },
  { id: "7", invoice_number: "202616271", client_name: "Vegimex BV", invoice_date: "2026-05-22", total_inc_btw: 732.04 },
  { id: "8", invoice_number: "202616271", client_name: "Vegimex BV", invoice_date: "2026-05-22", total_inc_btw: 732.04 },
  { id: "9", invoice_number: "26700603", client_name: "Aardappelgroothandel Altena B.V.", invoice_date: "2026-02-26", total_inc_btw: -136 },
  { id: "10", invoice_number: "26700603", client_name: "Aardappelgroothandel Altena B.V.", invoice_date: "2026-02-26", total_inc_btw: -136 },
  { id: "11", invoice_number: "VHF0001005310", client_name: "WonenBreburg", invoice_date: "2026-04-15", total_inc_btw: 73 },
  { id: "12", invoice_number: "VHF0001005310", client_name: "WonenBreburg", invoice_date: "2026-04-15", total_inc_btw: 73 },
];

/** Precies wat het script doet — één implementatie, gedeeld met de terugblik zelf. */
function terugblik(rijen: PossibleDupCandidate[]): string[] {
  return vindBestaandeDubbelen(rijen).map((d) => d.id);
}

test("[DUBBEL-TERUGKIJKEN] alle zes de tweede exemplaren worden gevonden", () => {
  const raak = terugblik(ADMINISTRATIE);
  // De tweede van elk paar (en de derde van Enka) hoort te vallen; de eerste nooit — die had bij
  // binnenkomst niets om op te lijken.
  for (const id of ["2", "4", "6", "8", "10", "12"]) {
    assert.ok(raak.includes(id), `rij ${id} is een tweede boeking van dezelfde factuur en wordt gemist`);
  }
  for (const id of ["1", "3", "5", "7", "9", "11"]) {
    assert.ok(!raak.includes(id), `rij ${id} is de EERSTE van zijn paar en mag niet gevlagd worden`);
  }
});

test("[DUBBEL-TERUGKIJKEN] ook wanneer de bedragen verschillen", () => {
  // Doyum (€ 222,05 / € 239,47) en Enka (€ 1.335,68 / € 1.348,14) zijn de lastige helft: hetzelfde
  // nummer, een ANDER bedrag. Dat is de lezer die zichzelf tegenspreekt, en juist daar mag de
  // terugblik niet stil blijven — er staan twee verschillende kosten in de boeken voor één inkoop.
  const doyum = terugblik(ADMINISTRATIE.filter((r) => r.client_name?.startsWith("Doyum")));
  assert.deepEqual(doyum, ["2"], "Doyum: het tweede, afwijkende bedrag hoort gevlagd");
  const enka = terugblik(ADMINISTRATIE.filter((r) => r.client_name?.startsWith("Enka")));
  assert.deepEqual(enka, ["4"], "Enka: idem");
});

test("[DUBBEL-TERUGKIJKEN] een schone administratie levert niets op", () => {
  // De tegenproef. Zonder deze zou "zes gevonden" ook kunnen betekenen dat hij alles vlagt.
  const schoon: PossibleDupCandidate[] = [
    { id: "a", invoice_number: "1001", client_name: "Leverancier A", invoice_date: "2026-03-01", total_inc_btw: 100 },
    { id: "b", invoice_number: "1002", client_name: "Leverancier A", invoice_date: "2026-03-08", total_inc_btw: 250 },
    { id: "c", invoice_number: "5501", client_name: "Leverancier B", invoice_date: "2026-03-02", total_inc_btw: 100 },
  ];
  assert.deepEqual(terugblik(schoon), [], "verschillende facturen mogen elkaar niet vlaggen");
});
