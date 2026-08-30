// [AANGIFTE-INGEDIEND] Run: npx tsx --test src/lib/aangifte-filed-notice.test.ts
//
// Vier uitspraken uit twee ONAFHANKELIJKE tekens. De fout die deze tabel afvangt is niet dat de
// banner er lelijk uitziet — het is dat er "te betalen" staat boven een bedrag dat de ondernemer
// terugkrijgt, op het scherm waar hij controleert of zijn ingediende aangifte nog klopt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filedNotice } from "./aangifte-filed-notice";
import { MESSAGES } from "./i18n/messages";

test("gelijk gebleven: één zin, en de richting van het SALDO", () => {
  const teBetalen = filedNotice({ saldo: 1250, delta: 0 });
  assert.equal(teBetalen.diverges, false);
  assert.deepEqual(teBetalen.lines, [{ key: "aang.ingediend.gelijk.betalen", bedrag: 1250 }]);

  const terug = filedNotice({ saldo: -430, delta: 0 });
  assert.equal(terug.diverges, false);
  assert.deepEqual(terug.lines, [{ key: "aang.ingediend.gelijk.terug", bedrag: 430 }]);
});

test("de vier combinaties van twee onafhankelijke tekens", () => {
  // Dat de twee tekens los van elkaar staan is de hele reden dat dit vier zinnen zijn en geen
  // twee: een teruggaaf die KLEINER wordt en een betaling die GROTER wordt zijn allebei "+",
  // en het is niet dezelfde mededeling aan de ondernemer.
  const geval = (saldo: number, delta: number) => filedNotice({ saldo, delta }).lines.map((l) => l.key);

  assert.deepEqual(geval(1000, 200), [
    "aang.ingediend.aangifte.betalen", "aang.ingediend.verschil.bij", "aang.ingediend.beslis",
  ], "moest 1000 betalen, er komt 200 bij");

  assert.deepEqual(geval(1000, -200), [
    "aang.ingediend.aangifte.betalen", "aang.ingediend.verschil.af", "aang.ingediend.beslis",
  ], "moest 1000 betalen, er gaat 200 af");

  assert.deepEqual(geval(-1000, 200), [
    "aang.ingediend.aangifte.terug", "aang.ingediend.verschil.bij", "aang.ingediend.beslis",
  ], "kreeg 1000 terug, en dat wordt 200 minder gunstig");

  assert.deepEqual(geval(-1000, -200), [
    "aang.ingediend.aangifte.terug", "aang.ingediend.verschil.af", "aang.ingediend.beslis",
  ], "kreeg 1000 terug, en dat wordt 200 gunstiger");
});

test("de bedragen zijn magnitudes — de richting zit in de sleutel, niet in het minteken", () => {
  // Anders zou de zin "Je hebt € -1.000,00 terug te ontvangen ingediend" opleveren: het minteken
  // twee keer, één keer in het woord en één keer in het getal.
  const n = filedNotice({ saldo: -1000, delta: -200 });
  assert.equal(n.lines[0].bedrag, 1000);
  assert.equal(n.lines[1].bedrag, 200);
  assert.ok(n.lines.every((l) => l.bedrag >= 0));
});

test("een halve cent verschil is geen verschil", () => {
  // Afrondingsstof mag de ondernemer niet naar de Waarheid-pagina sturen.
  assert.equal(filedNotice({ saldo: 500, delta: 0.004 }).diverges, false);
  assert.equal(filedNotice({ saldo: 500, delta: -0.004 }).diverges, false);
  assert.equal(filedNotice({ saldo: 500, delta: 0.01 }).diverges, true);
});

test("saldo precies nul telt als 'te betalen', want dat is wat 5g dan zegt", () => {
  const n = filedNotice({ saldo: 0, delta: 0 });
  assert.deepEqual(n.lines, [{ key: "aang.ingediend.gelijk.betalen", bedrag: 0 }]);
});

test("onbruikbare invoer wordt nul, niet NaN", () => {
  // Een NaN zou als "€ NaN" op het scherm belanden — en dit is de banner over een INGEDIENDE
  // aangifte, dus de duurste plek om onzin te tonen.
  const n = filedNotice({ saldo: Number.NaN, delta: Number.NaN });
  assert.equal(n.diverges, false);
  assert.equal(n.lines[0].bedrag, 0);
});

test("[TAAL] elke sleutel die deze module kan noemen bestaat, in het Nederlands", () => {
  // De poort in lifecycle-gates bewaakt de sleutels die een SCHERM noemt. Deze staan in een pure
  // module, dus die scan ziet ze niet — en een sleutel die niet bestaat rendert als zichzelf:
  // "aang.ingediend.verschil.af" op een geldbanner.
  const alle = new Set<string>();
  for (const saldo of [1000, -1000, 0]) {
    for (const delta of [0, 200, -200]) {
      const n = filedNotice({ saldo, delta });
      alle.add(n.titelKey);
      for (const l of n.lines) alle.add(l.key);
    }
  }
  assert.ok(alle.size >= 8, `slechts ${alle.size} sleutels bereikt — de tabel dekt de takken niet`);
  for (const k of alle) {
    const m = (MESSAGES as Record<string, { nl?: string } | undefined>)[k];
    assert.ok(m, `sleutel ${k} bestaat niet in de catalogus`);
    assert.ok(m.nl && m.nl.length > 0, `sleutel ${k} heeft geen Nederlandse tekst`);
  }
});

test("[TAAL] elke zin die een bedrag toont, noemt de parameter ook", () => {
  // Een zin met {bedrag} in de sleutel maar zonder in de vertaling verliest het getal stil.
  for (const saldo of [1000, -1000]) {
    for (const delta of [200, -200]) {
      for (const l of filedNotice({ saldo, delta }).lines) {
        if (l.key === "aang.ingediend.beslis") continue; // die noemt geen bedrag
        const m = (MESSAGES as Record<string, Record<string, string>>)[l.key];
        for (const taal of Object.keys(m)) {
          assert.match(m[taal], /\{bedrag\}/, `${l.key} (${taal}) toont het bedrag niet`);
        }
      }
    }
  }
});
