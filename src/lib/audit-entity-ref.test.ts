// [AUDIT-ENTITY-REF] Pure node test — run: npx tsx --test src/lib/audit-entity-ref.test.ts
//
// audit_logs.entity_id is een uuid-kolom. Drie aanroepers gaven een SAMENGESTELDE sleutel mee
// ('alle-klanten:Q2 2026', '<ownerId>:2026-Q2', '2026-Q2'), Postgres antwoordde 22P02, en
// logAuditAction slikte die fout — want een audit-fout mag de hoofdactie nooit breken. Gevolg:
// die rijen landden NOOIT. Uitgerekend de twee gebeurtenissen die bestaan omdat "de klant nergens
// kon zien wat zijn boekhouder had ingezien of gedownload" schreven niets.
import { test } from "node:test";
import assert from "node:assert/strict";

import { splitEntityRef } from "./audit";

const UUID = "3f8a1c2e-9b04-4d7a-8e15-6c2b0f9d47a1";

test("een echt uuid gaat gewoon in de kolom", () => {
  assert.deepEqual(splitEntityRef(UUID), { entityId: UUID, entityRef: null });
  // Hoofdletters zijn een geldig uuid.
  assert.equal(splitEntityRef(UUID.toUpperCase()).entityId, UUID.toUpperCase());
  // Ruimte eromheen mag de rij niet slopen.
  assert.equal(splitEntityRef(`  ${UUID}  `).entityId, UUID);
});

test("de drie echte samengestelde sleutels landen als verwijzing, niet als 22P02", () => {
  for (const ref of [
    "alle-klanten:Q2 2026",
    `${UUID}:2026-Q2`,
    "2026-Q2",
    "boekhouder@kantoor.nl",
  ]) {
    const r = splitEntityRef(ref);
    assert.equal(r.entityId, null, `${ref} mag de uuid-kolom niet in`);
    assert.equal(r.entityRef, ref, `${ref} moet als verwijzing bewaard blijven`);
  }
});

test("leeg is leeg — geen verzonnen verwijzing", () => {
  for (const leeg of [null, undefined, "", "   "]) {
    assert.deepEqual(splitEntityRef(leeg), { entityId: null, entityRef: null });
  }
});

test("een bijna-uuid is geen uuid", () => {
  // Precies dit soort waarde hoort NIET stilzwijgend als uuid door te glippen.
  for (const bijna of [
    UUID.slice(0, -1),                 // één teken te kort
    `${UUID}x`,                        // één teken te lang
    UUID.replace(/-/g, ""),            // zonder streepjes
    "3f8a1c2e-9b04-4d7a-8e15-6c2b0f9dZZZZ", // niet-hex
  ]) {
    assert.equal(splitEntityRef(bijna).entityId, null, `${bijna} is geen uuid`);
    assert.equal(splitEntityRef(bijna).entityRef, bijna, "…en gaat dus als verwijzing mee");
  }
});

test("de betekenis gaat nooit verloren", () => {
  // Het invariant dat deze reparatie draagt: wat er ook binnenkomt, óf het staat in entityId,
  // óf het staat in entityRef. Nooit weg.
  for (const waarde of [UUID, "alle-klanten:Q2 2026", "2026-Q2", "iets-anders"]) {
    const r = splitEntityRef(waarde);
    assert.equal(r.entityId ?? r.entityRef, waarde, `${waarde} moet ergens terechtkomen`);
    assert.ok(!(r.entityId && r.entityRef), "nooit beide — dat zou dubbel opslaan zijn");
  }
});
