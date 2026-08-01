// [VAK] Pure node test — run: npx tsx --test src/lib/vaksjablonen.test.ts
//
// Dit is de zwaarst getoetste tabel in dit bestand-paar, en met reden: een verkeerd BTW-tarief
// hier wordt door de ondernemer overgenomen zonder dat hij het narekent — dat is immers de hele
// belofte van een startbundel — en komt pas boven bij de aangifte of bij een controle.

import { test } from "node:test";
import assert from "node:assert/strict";

import { VAKKEN, vakVan, startArtikelen, nieuweRegels } from "./vaksjablonen";
import { isBekendeEenheid } from "./eenheden";

test("elk vak heeft een unieke sleutel en regels", () => {
  const keys = VAKKEN.map((v) => v.key);
  assert.equal(new Set(keys).size, keys.length, "geen dubbele sleutels");
  for (const v of VAKKEN) {
    assert.match(v.key, /^[a-z]+$/, `${v.key}: sleutel is een url/database-waarde`);
    assert.ok(v.naam.length > 2, `${v.key}: naam ontbreekt`);
    assert.ok(v.regels.length >= 4, `${v.key}: te weinig regels om te helpen`);
    assert.ok(v.regels.length <= 12, `${v.key}: zoveel regels zijn een tweede probleem, geen hulp`);
  }
});

test("ELK tarief is een bestaand Nederlands tarief — 0, 9 of 21", () => {
  // Een verzonnen tarief (6% van vroeger, 19% van nog vroeger) zou hier zo binnenglippen.
  for (const v of VAKKEN) {
    for (const r of v.regels) {
      assert.ok([0, 9, 21].includes(r.btw_rate), `${v.key} — "${r.description}": ${r.btw_rate}% bestaat niet`);
    }
  }
});

test("ELKE eenheid is er een die de app kent", () => {
  // Anders belandt hij als vrije tekst in de catalogus en komt hij bij de e-factuur alsnog als
  // C62 (stuk) naar buiten — dan hebben we het probleem verplaatst in plaats van opgelost.
  for (const v of VAKKEN) {
    for (const r of v.regels) {
      if (r.unit === null) continue;
      assert.ok(isBekendeEenheid(r.unit), `${v.key} — "${r.description}": eenheid "${r.unit}" kent de app niet`);
    }
  }
});

test("ELKE 9%-regel legt uit waarom, of is onvoorwaardelijk 9%", () => {
  // Het 9%-tarief is smal en vaak voorwaardelijk. Waar de voorwaarde bestaat MOET hij er staan:
  // de ondernemer moet het weten op het moment dat hij de regel gebruikt, niet drie maanden later.
  //
  // Onvoorwaardelijk 9% bestaat ook (kappen, fietsreparatie, voedingsmiddelen) — daar is een
  // let_op juist ruis. Deze test eist dus geen let_op bij élke 9%, maar bewaakt hieronder wel de
  // gevallen waar hij er wél hoort.
  const voorwaardelijk = VAKKEN.flatMap((v) =>
    v.regels.filter((r) => r.btw_rate === 9 && /woning|renovatie|schoonmaken woning/i.test(r.description)),
  );
  assert.ok(voorwaardelijk.length >= 5, "er horen voorwaardelijke 9%-regels te zijn");
  for (const r of voorwaardelijk) {
    assert.ok(r.let_op, `"${r.description}" is 9% zonder uitleg wanneer dat mag`);
    assert.match(r.let_op!, /2 jaar|21%/, `"${r.description}": de uitleg noemt de voorwaarde niet`);
  }
});

test("DE VALKUIL: nieuwbouw en bedrijfspand zijn NOOIT 9%", () => {
  // Dit is het duurste misverstand in het hele 9%-verhaal. Een schilder die zijn woningtarief op
  // nieuwbouw plakt, rekent een jaar lang 12 procentpunt te weinig af.
  for (const v of VAKKEN) {
    for (const r of v.regels) {
      if (/nieuwbouw|bedrijfspand|kantoor/i.test(r.description)) {
        assert.equal(r.btw_rate, 21, `"${r.description}" mag nooit 9% zijn`);
      }
    }
  }
});

test("materiaal en verkoop staan op 21%, ook binnen een 9%-vak", () => {
  // De tweede veelgemaakte fout: het 9%-tarief op de ARBEID doortrekken naar wat je levert.
  for (const v of VAKKEN) {
    for (const r of v.regels) {
      if (/^(materiaal|onderdelen|verf en materiaal|verkoop )/i.test(r.description)) {
        assert.equal(r.btw_rate, 21, `${v.key} — "${r.description}" hoort 21% te zijn`);
      }
    }
  }
});

test("de kappersbundel klopt: behandeling 9%, verkocht product 21%", () => {
  const kapper = vakVan("kapper")!;
  const knippen = kapper.regels.find((r) => r.description === "Knippen")!;
  assert.equal(knippen.btw_rate, 9);
  assert.equal(knippen.let_op, undefined, "kappen is onvoorwaardelijk 9% — een let_op is hier ruis");
  const product = kapper.regels.find((r) => /verkoop/i.test(r.description))!;
  assert.equal(product.btw_rate, 21);
  assert.ok(product.let_op, "juist HIER hoort de uitleg, want het verschil is niet vanzelfsprekend");
});

test("de fietsbundel klopt: reparatie-arbeid 9%, onderdelen en verkoop 21%", () => {
  const fiets = vakVan("fietsenmaker")!;
  assert.equal(fiets.regels.find((r) => /Reparatie fiets/i.test(r.description))!.btw_rate, 9);
  assert.equal(fiets.regels.find((r) => /^Onderdelen/i.test(r.description))!.btw_rate, 21);
  assert.equal(fiets.regels.find((r) => /^Verkoop fiets/i.test(r.description))!.btw_rate, 21);
});

test("alcohol is 21%, eten en frisdrank 9%", () => {
  const winkel = vakVan("winkel")!;
  assert.equal(winkel.regels.find((r) => /^Etenswaren/i.test(r.description))!.btw_rate, 9);
  assert.equal(winkel.regels.find((r) => /Niet-alcoholische/i.test(r.description))!.btw_rate, 9);
  assert.equal(winkel.regels.find((r) => /^Alcoholhoudende/i.test(r.description))!.btw_rate, 21);
});

test("EEN BUNDEL GEEFT NOOIT EEN PRIJS", () => {
  // Wat het kost bepaalt de ondernemer. Een voorgestelde prijs is een advies dat wij niet mogen
  // geven — en waarvan hij bovendien niet meer weet of hij hem zelf heeft gekozen.
  for (const v of VAKKEN) {
    for (const a of startArtikelen(v.key)) {
      assert.equal(a.unit_price, 0, `${v.key} — "${a.description}" heeft een prijs`);
    }
  }
});

test("een onbekend vak levert niets op — nooit een gok", () => {
  assert.equal(vakVan("bakker"), null);
  assert.equal(vakVan(""), null);
  assert.equal(vakVan(null), null);
  assert.deepEqual(startArtikelen("bestaat-niet"), []);
});

test("de sleutel mag met hoofdletters of spaties binnenkomen", () => {
  assert.equal(vakVan("KAPPER")?.key, "kapper");
  assert.equal(vakVan("  kapper  ")?.key, "kapper");
});

test("twee keer toevoegen levert geen dubbele catalogus op", () => {
  const eerste = nieuweRegels("kapper", []);
  assert.ok(eerste.length > 0);
  const tweede = nieuweRegels("kapper", eerste.map((r) => r.description));
  assert.deepEqual(tweede, [], "alles wat er al staat komt niet nog eens");
});

test("het herkennen van 'heb ik al' is ongevoelig voor hoofdletters en dubbele spaties", () => {
  const rommelig = ["  KNIPPEN ", "knippen  en   föhnen"];
  const over = nieuweRegels("kapper", rommelig).map((r) => r.description);
  assert.ok(!over.includes("Knippen"), "Knippen stond er al");
  assert.ok(!over.includes("Knippen en föhnen"), "ook met rare spaties herkend");
  assert.ok(over.length > 0, "de rest komt er wel bij");
});

test("geen dubbele omschrijvingen BINNEN een bundel", () => {
  for (const v of VAKKEN) {
    const d = v.regels.map((r) => r.description.toLowerCase());
    assert.equal(new Set(d).size, d.length, `${v.key} heeft een dubbele regel`);
  }
});

test("elke let_op is een hele zin die iets uitlegt", () => {
  for (const v of VAKKEN) {
    for (const r of v.regels) {
      if (!r.let_op) continue;
      assert.ok(r.let_op.length > 30, `${v.key} — "${r.description}": te kort om te helpen`);
      assert.match(r.let_op, /[.!]$/, `${v.key} — "${r.description}": geen hele zin`);
    }
  }
});
