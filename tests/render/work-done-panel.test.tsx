// tests/render/work-done-panel.test.tsx
// [WERK-GEDAAN] Het paneel dat over de WAARDE van het product gaat — het enige scherm waar een
// verzonnen getal het meeste kost.
//
// De ledger-tests dekken de rekenkunde. Wat zij niet kunnen zien is of de twee toestanden die
// NOOIT als "nul handelingen" mogen lezen ook echt een zin op het scherm zetten: de telling die
// nog niet aanstaat, en de klanten die niet gelezen konden worden. Dat is een eigenschap van de
// gerenderde HTML.

import test from "node:test";
import assert from "node:assert/strict";
import { workDoneLedger, estimateMinutes } from "../../src/lib/work-done";
import { MESSAGES } from "../../src/lib/i18n/messages";

/** Kiwi Food, 1 juli t/m 30 september 2026 — uit work_done_counts() op productie. */
const ECHT = {
  invoicesFromEmail: 317,
  invoicesAutoVerified: 227,
  tillDaysImported: 91,
  bankLinesCategorised: 24,
  bankLinesMatched: 23,
  duplicatesCaught: 0,
};

test("[WERK-GEDAAN] de echte cijfers worden zinnen, geen lege regels", () => {
  const l = workDoneLedger("2026-07-01/2026-09-30", ECHT);
  assert.equal(l.total, 682, "de telling van de live administratie is veranderd");
  assert.equal(l.lines.length, 5, "duplicatesCaught is 0 en hoort dus geen regel te krijgen");
  for (const line of l.lines) {
    assert.ok(line.sentence.trim().length > 0, `regel ${line.key} heeft geen zin`);
    assert.match(line.sentence, /^\d/, `regel ${line.key} begint niet met zijn aantal`);
    // De meervoud-plaatshouder die dit project heeft uitgeroeid mag hier niet terugkomen.
    assert.doesNotMatch(line.sentence, /\(u\)r\(en\)|\(en\)|\(s\)/, `regel ${line.key} bevat een plaatshouder`);
  }
  assert.equal(l.lines[0].sentence, "317 facturen uit de e-mail gehaald");
});

test("[NO-SILENT-EMPTY] de twee toestanden die nooit 'nul handelingen' mogen zijn, hebben een zin", () => {
  // Het paneel rendert deze twee sleutels; ontbreekt er één, dan valt het scherm stil op precies
  // het moment dat het iets moet toegeven.
  for (const k of ["bh.gedaan.nogNiet", "bh.gedaan.deelsOnleesbaar"]) {
    const m = (MESSAGES as Record<string, { nl?: string } | undefined>)[k];
    assert.ok(m, `de sleutel ${k} bestaat niet`);
    assert.ok((m!.nl ?? "").trim().length > 0, `${k} heeft geen Nederlandse tekst`);
    assert.doesNotMatch(m!.nl ?? "", /^0 /, `${k} begint met een nul — dat is precies de bewering die verboden is`);
  }
});

test("[WERK-GEDAAN] het paneel belooft geen uren", () => {
  // De uitleg-zin moet zeggen dat WIJ niet omrekenen. Zonder die zin leest een telling als een
  // impliciete tijdsbelofte, en dat is de claim die dit hele ontwerp weigert te doen.
  const uitleg = (MESSAGES as Record<string, { nl?: string }>)["bh.gedaan.uitleg"].nl ?? "";
  assert.match(uitleg, /met de hand/, "de uitleg zegt niet waarom een handeling telt");
  assert.match(uitleg, /rekenen we het niet voor je om|weet je zelf/,
    "de uitleg geeft niet toe dat het kantoor zelf omrekent");
  // En de code doet het ook niet: zonder eigen getal is er geen minuut.
  const l = workDoneLedger("2026", ECHT);
  assert.equal(estimateMinutes(l, null), null, "er komt een minuut uit zonder dat het kantoor er een gaf");
  assert.equal(estimateMinutes(l, 2), 1364, "de eigen rekensom van het kantoor is veranderd");
});
