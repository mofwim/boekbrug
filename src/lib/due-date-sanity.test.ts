// src/lib/due-date-sanity.test.ts
// [VERVALDATUM-ONMOGELIJK] Een vervaldatum kan niet vóór de factuurdatum liggen.
// Run: npx tsx --test src/lib/due-date-sanity.test.ts
//
// Eigen bestand en niet onderaan safecore.test.ts: dat bestand draait als een gewoon script met
// check() en een exitcode, geen node:test. Een test() eraan plakken levert een bestand op dat groen
// meldt zonder de asserties te draaien — precies één keer gebeurd, en daarom staat het hier.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveDueDate } from "./safecore";

test("[VERVALDATUM-ONMOGELIJK] een vervaldatum vóór de factuurdatum wordt geweigerd", () => {
  // De vorm zoals hij 36 keer in productie stond: wekelijkse facturen van één leverancier, de
  // vervaldatum stelselmatig 4 of 5 dagen vóór de factuurdatum. Vrijwel zeker de leverdatum,
  // gelezen van de plek waar op ander papier de vervaldatum staat.
  assert.equal(deriveDueDate("2026-08-29", "2026-08-24", null), null, "vijf dagen terug");
  assert.equal(deriveDueDate("2026-07-04", "2026-06-30", null), null, "vier dagen terug");

  // Weigeren is niet opgeven: de betaaltermijn krijgt alsnog zijn kans.
  assert.equal(deriveDueDate("2026-08-29", "2026-08-24", 14), "2026-09-12",
    "onmogelijke datum weg, termijn gerekend vanaf de factuurdatum");
});

test("[VERVALDATUM-ONMOGELIJK] alles wat wél kan blijft ongemoeid", () => {
  // Een controle die correcte gegevens weggooit is erger dan de fout die hij opruimt.
  assert.equal(deriveDueDate("2026-08-01", "2026-08-31", null), "2026-08-31");
  assert.equal(deriveDueDate("2026-08-01", "2026-08-01", null), "2026-08-01", "zelfde dag mag");
  assert.equal(deriveDueDate("2026-08-01", "2026-08-02", null), "2026-08-02", "één dag later mag");
  // Zonder bruikbare factuurdatum valt er niets te vergelijken; dan is de opgegeven datum het
  // enige dat er is, en die weggooien zou informatie vernietigen zonder iets te winnen.
  assert.equal(deriveDueDate(null, "2026-08-24", null), "2026-08-24");
  assert.equal(deriveDueDate("rommel", "2026-08-24", null), "2026-08-24");
});

test("[VERVALDATUM-ONMOGELIJK] de vergelijking loopt via dezelfde normalisatie", () => {
  // Zonder normaliseren vergelijkt de poort "24-08-2026" met "2026-08-29" als tekst, en dan weigert
  // hij het verkeerde: "2" < "2" ... de NL-notatie sorteert op dag. Dit is de val die een
  // datumcontrole stilletjes omdraait.
  assert.equal(deriveDueDate("29-08-2026", "24-08-2026", null), null, "NL-notatie, onmogelijk");
  assert.equal(deriveDueDate("01-08-2026", "31-08-2026", null), "2026-08-31", "NL-notatie, normaal");
});
