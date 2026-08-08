// tests/render/tool-screens.test.tsx
// [RENDER-GATE] Do the sixteen file tools survive one render?
//
// Run: npm run test:render
//
// ── WHY THIS EXISTS ──
// Same reason as money-screens.test.tsx, and the note at the top of that file
// is the argument in full: tsc, eslint and next build never CALL a component,
// and the Playwright sweep only asks whether a path answers 200 — which it does
// even when the interactive half below the fold throws on its first render.
//
// These are public pages, so the sweep does at least reach them. But it reaches
// the SERVER component: the words, the FAQ and the JSON-LD. The client half —
// the part with the state, the effects and the file handling — is exactly what
// it cannot see, and that is where a temporal-dead-zone reference or a bad
// destructure would live.
//
// ── WHAT IT IS NOT ──
// Not a UI test, and not a test of what the tools DO. Every one of these was
// driven in a real browser with a real file in and a real file out; that is a
// different exercise and it does not run in CI. This gate covers the one thing
// the other gates cannot see: whether the screen survives being called.
//
// Effects never run under renderToStaticMarkup, so nothing here touches a
// canvas, pdf.js or the network — which is also why these components must not
// do work outside an effect. If one of them ever does, this test is where it
// will show up.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import PdfVerkleinen from "../../src/app/pdf-verkleinen/PdfVerkleinen";
import PdfSamenvoegen from "../../src/app/pdf-samenvoegen/PdfSamenvoegen";
import PdfSplitsen from "../../src/app/pdf-splitsen/PdfSplitsen";
import PdfPaginasOrdenen from "../../src/app/pdf-paginas-ordenen/PdfPaginasOrdenen";
import PdfOndertekenen from "../../src/app/pdf-ondertekenen/PdfOndertekenen";
import PdfWatermerk from "../../src/app/pdf-watermerk/PdfWatermerk";
import PdfEigenschappen from "../../src/app/pdf-eigenschappen/PdfEigenschappen";
import PdfNaarTekst from "../../src/app/pdf-naar-tekst/PdfNaarTekst";
import PdfNaarAfbeelding from "../../src/app/pdf-naar-afbeelding/PdfNaarAfbeelding";
import AfbeeldingenUitPdf from "../../src/app/afbeeldingen-uit-pdf/AfbeeldingenUitPdf";
import AfbeeldingenNaarPdf from "../../src/app/afbeeldingen-naar-pdf/AfbeeldingenNaarPdf";
import AfbeeldingVerkleinen from "../../src/app/afbeelding-verkleinen/AfbeeldingVerkleinen";
import AfbeeldingOmzetten from "../../src/app/afbeelding-omzetten/AfbeeldingOmzetten";
import AfbeeldingFormaat from "../../src/app/afbeelding-formaat/AfbeeldingFormaat";
import WatermerkOpFoto from "../../src/app/watermerk-op-foto/WatermerkOpFoto";
import FaviconMaken from "../../src/app/favicon-maken/FaviconMaken";

const TOOLS: [string, React.ComponentType][] = [
  ["pdf-verkleinen", PdfVerkleinen],
  ["pdf-samenvoegen", PdfSamenvoegen],
  ["pdf-splitsen", PdfSplitsen],
  ["pdf-paginas-ordenen", PdfPaginasOrdenen],
  ["pdf-ondertekenen", PdfOndertekenen],
  ["pdf-watermerk", PdfWatermerk],
  ["pdf-eigenschappen", PdfEigenschappen],
  ["pdf-naar-tekst", PdfNaarTekst],
  ["pdf-naar-afbeelding", PdfNaarAfbeelding],
  ["afbeeldingen-uit-pdf", AfbeeldingenUitPdf],
  ["afbeeldingen-naar-pdf", AfbeeldingenNaarPdf],
  ["afbeelding-verkleinen", AfbeeldingVerkleinen],
  ["afbeelding-omzetten", AfbeeldingOmzetten],
  ["afbeelding-formaat", AfbeeldingFormaat],
  ["watermerk-op-foto", WatermerkOpFoto],
  ["favicon-maken", FaviconMaken],
];

for (const [slug, Tool] of TOOLS) {
  test(`[RENDER-GATE] /${slug} renders without a file`, () => {
    const html = renderToStaticMarkup(React.createElement(Tool));
    assert.ok(html.length > 0, `${slug} rendered nothing at all`);
    // Every one of them opens with a drop zone and nothing else — that is the
    // shape of the whole market, and a tool that has lost it has lost its one
    // way in.
    assert.match(html, /tp-drop/, `${slug} rendered without a drop zone`);
  });
}

test("[RENDER-GATE] the sixteen tools are all covered", () => {
  assert.equal(TOOLS.length, 16, "a tool was added or removed without touching this list");
});
