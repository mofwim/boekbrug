// [NAMENS] Pure node test — run: npx tsx --test src/lib/acting-for.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveActingFor,
  isNamens,
  magScherm,
  factuurEigenaar,
  factuurGemaaktDoor,
  factuurLeesFilter,
  magFactuur,
  magVersturen,
  VERKOOP_SCHERMEN,
  type MemberLink,
} from "./acting-for";

const BAAS = "11111111-1111-1111-1111-111111111111";
const LID = "22222222-2222-2222-2222-222222222222";
const VREEMDE = "33333333-3333-3333-3333-333333333333";
const NU = Date.parse("2026-08-01T12:00:00.000Z");

const koppeling = (over: Partial<MemberLink> = {}): MemberLink => ({
  owner_id: BAAS,
  member_id: LID,
  role: "verkoop",
  revoked_at: null,
  ...over,
});

test("zonder koppeling ben je eigenaar van je eigen boekhouding", () => {
  const a = resolveActingFor(BAAS, null, NU);
  assert.deepEqual(a, { ownerId: BAAS, actorId: BAAS, role: "eigenaar" });
  assert.equal(isNamens(a), false);
});

test("met koppeling handel je NAMENS de baas, en bezit je niets", () => {
  const a = resolveActingFor(LID, koppeling(), NU);
  assert.equal(a.ownerId, BAAS, "de boekhouding is van de baas");
  assert.equal(a.actorId, LID, "het spoor is van het lid");
  assert.equal(a.role, "verkoop");
  assert.equal(isNamens(a), true);
});

test("het factuurnummer komt ALTIJD uit de reeks van de eigenaar", () => {
  // DIT IS DE HELE REDEN VOOR DEZE MODULE. invoice-numbering.ts alloceert per user_id. Zou een
  // medewerker onder zijn eigen id boeken, dan lopen er twee reeksen onder één BTW-nummer — en
  // Art. 35 Wet OB eist doorlopende nummering zonder gaten, forward-only. Niet terug te draaien.
  const lid = resolveActingFor(LID, koppeling(), NU);
  const baas = resolveActingFor(BAAS, null, NU);
  assert.equal(factuurEigenaar(lid), BAAS, "één reeks per bedrijf");
  assert.equal(factuurEigenaar(baas), BAAS, "en dezelfde reeks voor de baas zelf");
  assert.equal(factuurEigenaar(lid), factuurEigenaar(baas), "letterlijk dezelfde reeks");

  // Maar het spoor verschilt wél — anders is niet te zien wie wat maakte.
  assert.equal(factuurGemaaktDoor(lid), LID);
  assert.equal(factuurGemaaktDoor(baas), BAAS);
});

test("een ingetrokken koppeling verleent onmiddellijk niets meer", () => {
  const gisteren = new Date(NU - 86_400_000).toISOString();
  const a = resolveActingFor(LID, koppeling({ revoked_at: gisteren }), NU);
  assert.equal(a.ownerId, LID, "terug naar zichzelf, niet naar de baas");
  assert.equal(a.role, "eigenaar");
});

test("een intrekking in de TOEKOMST laat hem nog binnen — tot dat moment", () => {
  const morgen = new Date(NU + 86_400_000).toISOString();
  assert.equal(resolveActingFor(LID, koppeling({ revoked_at: morgen }), NU).ownerId, BAAS);
  // en precies erna niet meer
  assert.equal(resolveActingFor(LID, koppeling({ revoked_at: morgen }), NU + 86_400_001).ownerId, LID);
});

test("een onleesbare intrekkingsdatum zet hem BUITEN, niet binnen", () => {
  // Faalrichting: liever een medewerker die te vroeg buiten staat (hij belt) dan een ingetrokken
  // medewerker die binnen blijft (niemand belt).
  const a = resolveActingFor(LID, koppeling({ revoked_at: "geen datum" }), NU);
  assert.equal(a.ownerId, LID);
});

test("een rij die niet over deze sessie gaat wordt genegeerd", () => {
  // Zou een verkeerde rij hier ooit binnenkomen — een verwisselde parameter, een query zonder
  // .eq() — dan is dit precies het geval waarin doorgaan een vreemde in andermans boeken zet.
  const a = resolveActingFor(VREEMDE, koppeling(), NU);
  assert.equal(a.ownerId, VREEMDE);
  assert.equal(a.role, "eigenaar");
});

test("een zelf-koppeling wordt geweigerd", () => {
  const a = resolveActingFor(LID, koppeling({ owner_id: LID }), NU);
  assert.equal(a.role, "eigenaar");
  assert.equal(a.ownerId, LID);
});

test("een ONBEKENDE rol verleent niets — hij erft nooit stilzwijgend 'verkoop'", () => {
  for (const rol of ["inkoop", "admin", "finance", "", "VERKOOP", "eigenaar"]) {
    const a = resolveActingFor(LID, koppeling({ role: rol }), NU);
    assert.equal(a.ownerId, LID, `rol '${rol}' mag geen toegang tot de boekhouding van de baas geven`);
  }
});

test("de leesgrens: een medewerker ziet alleen wat hij zelf maakte", () => {
  const lid = resolveActingFor(LID, koppeling(), NU);
  const baas = resolveActingFor(BAAS, null, NU);

  assert.deepEqual(factuurLeesFilter(baas), { sender_id: BAAS }, "de baas ziet alles van zichzelf");
  assert.deepEqual(
    factuurLeesFilter(lid),
    { sender_id: BAAS, created_by: LID },
    "het lid ziet niet de omzet van zijn baas en niet die van een collega",
  );
});

test("één rij toetsen is iets anders dan een lijst filteren — en dat is waar geraden id's binnenkomen", () => {
  const lid = resolveActingFor(LID, koppeling(), NU);
  const baas = resolveActingFor(BAAS, null, NU);

  const vanHetLid = { sender_id: BAAS, created_by: LID };
  const vanDeBaas = { sender_id: BAAS, created_by: BAAS };
  const vanCollega = { sender_id: BAAS, created_by: VREEMDE };
  const vanEenAnderBedrijf = { sender_id: VREEMDE, created_by: LID };

  assert.equal(magFactuur(lid, vanHetLid), true);
  assert.equal(magFactuur(lid, vanDeBaas), false, "de factuur van de baas is niet van hem");
  assert.equal(magFactuur(lid, vanCollega), false, "en die van een collega ook niet");
  assert.equal(magFactuur(lid, vanEenAnderBedrijf), false, "een ander bedrijf al helemaal niet");

  assert.equal(magFactuur(baas, vanHetLid), true, "de baas ziet wél wat zijn medewerker maakte");
  assert.equal(magFactuur(baas, vanEenAnderBedrijf), false);

  // versturen volgt exact dezelfde grens — geen tweede, ruimere poort
  for (const f of [vanHetLid, vanDeBaas, vanCollega, vanEenAnderBedrijf]) {
    assert.equal(magVersturen(lid, f), magFactuur(lid, f));
    assert.equal(magVersturen(baas, f), magFactuur(baas, f));
  }
});

test("een factuur zonder created_by is niet van het lid", () => {
  // Alle facturen van vóór deze migratie hebben created_by = NULL. Die horen bij de eigenaar,
  // niet bij de eerste medewerker die langskomt.
  const lid = resolveActingFor(LID, koppeling(), NU);
  assert.equal(magFactuur(lid, { sender_id: BAAS, created_by: null }), false);
  assert.equal(magFactuur(lid, { sender_id: BAAS }), false);
});

test("de schermwacht is een GESLOTEN lijst — wat er niet in staat, is dicht", () => {
  const lid = resolveActingFor(LID, koppeling(), NU);
  const baas = resolveActingFor(BAAS, null, NU);

  for (const open of VERKOOP_SCHERMEN) assert.equal(magScherm(lid, open), true, open);
  assert.equal(magScherm(lid, "/dashboard/verkoop/nieuw"), true, "een submap komt mee");

  // De lijst op zijn eigen scherm verwijst naar het detailscherm van één factuur. Stond
  // /dashboard/invoice niet open, dan liep elke rij dood op een redirect terug naar de lijst —
  // een scherm dat naar zichzelf verwijst. RLS beperkt wat hij daar ziet, niet deze wacht.
  assert.equal(magScherm(lid, "/dashboard/invoice/new"), true);
  assert.equal(magScherm(lid, "/dashboard/invoice/8f0d2b1c-0000-0000-0000-000000000000"), true);
  assert.equal(magScherm(lid, "/dashboard/invoice/8f0d2b1c-0000-0000-0000-000000000000/edit"), true);

  // Het geld en de cijfers van het bedrijf: dicht.
  for (const dicht of [
    "/dashboard/bank",
    "/dashboard/kas",
    "/dashboard/dagomzet",
    "/dashboard/aangifte",
    "/dashboard/resultaat",
    "/dashboard/brug",
    "/dashboard/incoming",
    "/dashboard/settings",
    "/dashboard",
  ]) {
    assert.equal(magScherm(lid, dicht), false, `${dicht} hoort dicht te zijn voor een verkoper`);
    assert.equal(magScherm(baas, dicht), true, `${dicht} is van de eigenaar zelf`);
  }
});

test("een scherm dat MORGEN wordt toegevoegd is dicht, niet open", () => {
  // De belangrijkste eigenschap van de wacht. Een nieuw scherm dat per ongeluk openstaat is een
  // lek dat niemand opmerkt; een nieuw scherm dat per ongeluk dicht is, is een klacht binnen een
  // dag. Openzetten hoort een bewuste handeling te zijn.
  const lid = resolveActingFor(LID, koppeling(), NU);
  assert.equal(magScherm(lid, "/dashboard/nog-niet-bedacht"), false);
  assert.equal(magScherm(lid, "/dashboard/winst-2027"), false);
});

test("een prefix zonder grens is hoe wachten stilletjes te ruim worden", () => {
  const lid = resolveActingFor(LID, koppeling(), NU);
  // '/dashboard/verkoop' staat open. '/dashboard/verkoopcijfers' is een ANDER scherm.
  assert.equal(magScherm(lid, "/dashboard/verkoopcijfers"), false);
  assert.equal(magScherm(lid, "/dashboard/klantenbestand-export"), false);
});

test("zonder gebruiker gaat er niets stilzwijgend door", () => {
  assert.throws(() => resolveActingFor("", koppeling(), NU), /NAMENS/);
});
