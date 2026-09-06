// tests/render/stand-badge.test.tsx
// [SNEL-BORD] De regel die zegt hoe oud het cijfer is dat je leest.
//
// Waarom dit een RENDER-test is en niet alleen een unit-test: readiness-cache.test.ts bewijst dat
// de banden en de sleutels kloppen, en dat bewees het ook al toen er nog geen letter van op het
// scherm stond. De hele reden dat de opgenomen stand verantwoord is, is dat de leeftijd ERBIJ
// staat — dat is een eigenschap van de gerenderde HTML en van niets anders.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MAX_CACHE_AGE_MS } from "../../src/lib/readiness-cache";

const NOW = Date.parse("2026-09-06T12:00:00Z");
const geleden = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

async function render(props: { computedAt: string; now?: number; refreshFailed?: boolean }) {
  const { StandBadge } = await import("../../src/modules/accountant/pages/StandBadge");
  return renderToStaticMarkup(
    React.createElement(StandBadge as never, { now: NOW, ...props } as never),
  );
}

test("[SNEL-BORD] elke ouderdom krijgt een echte Nederlandse zin, geen sleutel en geen plaatshouder", async () => {
  const gevallen: Array<[number, RegExp]> = [
    [20_000, /zojuist/],
    [1 * MIN, /1 minuut geleden/],
    [7 * MIN, /7 minuten geleden/],
    [1 * HOUR, /1 uur geleden/],
    [5 * HOUR, /5 uur geleden/],
    [1 * DAY, /gisteren/],
    [3 * DAY, /3 dagen geleden/],
  ];
  for (const [ms, zin] of gevallen) {
    const html = await render({ computedAt: geleden(ms) });
    assert.match(html, zin, `de leeftijd na ${ms} ms leest niet als Nederlands`);
    // De twee manieren waarop dit stil kapot gaat: een sleutel op het scherm, of een {n} die
    // nooit is ingevuld. Allebei zien er in een screenshot uit als een detail en zijn het niet.
    assert.doesNotMatch(html, /bh\.stand\./, "er staat een sleutel op het scherm");
    assert.doesNotMatch(html, /\{n\}/, "de plaatshouder is niet ingevuld");
  }
});

test("[SNEL-BORD] een stand die te oud is verschijnt niet — ook niet als het bord hem doorgeeft", async () => {
  // Het bord filtert hier al op, en dit is het tweede slot. Een rapport is alleen te lezen onder
  // de buildReadiness die het maakte; een score van drie weken en elf deploys terug is misschien
  // een getal over een andere vraag, en "berekend op 12 augustus" leest als betrouwbaar-maar-oud.
  assert.equal(await render({ computedAt: geleden(MAX_CACHE_AGE_MS + HOUR) }), "");
  assert.equal(await render({ computedAt: "" }), "", "een leeg moment is geen moment");
  assert.equal(await render({ computedAt: "gisteren" }), "", "onleesbaar is niet 'zojuist'");
  // Een toekomstige tijdstempel (klokverschil tussen database en browser) zou "over 3 minuten
  // berekend" opleveren. Een scherm dat iets onmogelijks zegt over een geldcijfer heeft het
  // vertrouwen uitgegeven dat het cijfer zelf nodig heeft.
  assert.equal(await render({ computedAt: new Date(NOW + 2 * HOUR).toISOString() }), "");
});

test("[NO-SILENT-EMPTY] een mislukte verversing laat het cijfer staan én zegt het", async () => {
  const html = await render({ computedAt: geleden(2 * HOUR), refreshFailed: true });
  assert.match(html, /2 uur geleden/, "de leeftijd hoort te blijven staan — die informatie had hij al");
  assert.match(html, /kon niet worden bijgewerkt/,
    "een stand die niet kon worden nagerekend mag niet als een vers oordeel lezen");
  assert.match(html, /#B26A00/, "en hij draagt de waarschuwingskleur, geen rust");
});

test("[SNEL-BORD] tegenproef: een geslaagde stand zegt NIET dat er iets mislukte", async () => {
  // Zonder deze test slaagt de test hierboven ook als de badge die zin altijd afdrukt.
  const html = await render({ computedAt: geleden(2 * HOUR) });
  assert.match(html, /2 uur geleden/);
  assert.doesNotMatch(html, /kon niet worden bijgewerkt/);
  assert.doesNotMatch(html, /#B26A00/, "de waarschuwingskleur hoort alleen bij een mislukking");
});
