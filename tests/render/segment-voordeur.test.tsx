// tests/render/segment-voordeur.test.tsx
// [SEGMENT-VOORDEUR] De drie deuren openen, en zeggen wat ze niet kunnen.
//
// tsc en next build roepen een component nooit aan — zie AGENTS.md. Deze rendert ze echt, met de
// data die ze in productie krijgen, en controleert de twee dingen die een landingspagina waardeloos
// maken als ze wegvallen: de belofte, en de grens.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SEGMENT_PAGES } from "../../src/lib/segment-pages";

test("[SEGMENT-VOORDEUR] elke deur rendert zijn eigen belofte, stappen en grenzen", async () => {
  const { default: SegmentVoordeur } = await import("../../src/components/SegmentVoordeur");
  assert.equal(SEGMENT_PAGES.length, 3, "drie deuren, zoals besloten");

  for (const pagina of SEGMENT_PAGES) {
    const html = renderToStaticMarkup(React.createElement(SegmentVoordeur, { pagina }));

    assert.ok(html.length > 1500, `${pagina.slug}: er kwam nauwelijks iets uit`);
    assert.ok(html.includes(pagina.belofte), `${pagina.slug}: de belofte staat niet op de pagina`);
    assert.ok(html.includes(pagina.probleem), `${pagina.slug}: het probleem staat er niet`);

    // Elke stap, met zijn tekst. Een stap die stilletjes wegvalt is een belofte die de lezer wel
    // in de metadata leest en niet op het scherm.
    for (const s of pagina.stappen) {
      assert.ok(html.includes(s.title), `${pagina.slug}: stap "${s.title}" ontbreekt`);
    }

    // En de grens. Dit is de sectie die het eerst sneuvelt bij "de pagina is te lang" — en de
    // enige die de lezer beschermt tegen een teleurstelling ná het aanmelden.
    assert.match(html, /Wat BoekBrug voor jou niet doet/,
      `${pagina.slug}: de eerlijke sectie is verdwenen`);
    for (const n of pagina.nietDit) {
      assert.ok(html.includes(n), `${pagina.slug}: grens "${n.slice(0, 40)}…" staat er niet`);
    }

    // [SEGMENT-VAK] Het vak moet in de échte uitvoer staan, niet alleen in de gegevens. Een
    // component die het veld leest en niet in de href zet, ziet er in de broncode correct uit en
    // levert een aanmeldlink op die niets doorgeeft — de fout die vak-profile.ts beschrijft.
    if (pagina.vak) {
      assert.ok(html.includes(`/register?vak=${pagina.vak}`),
        `${pagina.slug}: de aanmeldknop draagt vak "${pagina.vak}" niet mee`);
    } else {
      assert.ok(!/\/register\?vak=/.test(html),
        `${pagina.slug}: geeft een vak door dat deze deur niet kent`);
      assert.ok(html.includes('href="/register"'), `${pagina.slug}: geen kale aanmeldlink`);
    }

    // De uitweg staat er twee keer, boven en onder — een lange pagina zonder knop onderaan
    // dwingt de lezer terug te scrollen op precies het moment dat hij overtuigd is.
    assert.ok((html.match(/Gratis beginnen/g) ?? []).length >= 2,
      `${pagina.slug}: geen tweede aanmeldknop onderaan`);
  }
});

test("[SEGMENT-VOORDEUR] de drie deuren zeggen niet hetzelfde", () => {
  // Eén product, drie boodschappen — als de koppen inwisselbaar zijn, is het geen segmentering
  // maar drie keer dezelfde pagina met een andere URL.
  const beloftes = SEGMENT_PAGES.map((p) => p.belofte);
  assert.equal(new Set(beloftes).size, 3, "twee segmenten delen hun belofte");
  const problemen = SEGMENT_PAGES.map((p) => p.probleem);
  assert.equal(new Set(problemen).size, 3, "twee segmenten delen hun probleem");
});
