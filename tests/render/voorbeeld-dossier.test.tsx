// tests/render/voorbeeld-dossier.test.tsx
// [PROEFDOSSIER] Does the example dossier render, and does it stay honest?
//
// Run: npm run test:render
//
// Same argument as the rest of this directory (see money-screens.test.tsx): tsc never CALLS a
// component, and the Playwright sweep never logs in — a role-guarded accountant screen that
// throws on render passes every other gate. This one matters extra because of WHEN it is seen:
// it is the first screen a brand-new accountant opens, at the exact moment they decide whether
// the product is real. A white page here is not a bug, it is a lost office.
//
// Two claims are pinned beyond "renders non-empty":
//   1. IT SAYS IT IS FICTIONAL. A convincing example that does not announce itself is a fake
//      administration — the opposite of the product's honesty pitch.
//   2. THE NUMBERS ON THE PAGE ARE THE DERIVED ONES. The screen must render dossierTotalen()'s
//      output — the arithmetic the unit test recomputes — not retyped literals that can drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import VoorbeeldDossier from "../../src/modules/accountant/pages/VoorbeeldDossier";
import { dossierTotalen, VOORBEELD_KLANT } from "../../src/lib/voorbeeld-dossier";
import { formatEuroNL } from "../../src/lib/format-nl";

test("[PROEFDOSSIER] the example dossier renders, announces itself, and shows the derived sums", () => {
  const html = renderToStaticMarkup(React.createElement(VoorbeeldDossier));
  assert.ok(html.length > 2000, "a real screen, not a stub");

  // 1. Unmistakably fictional — banner and client name both say so.
  assert.match(html, /fictieve cijfers/i, "the banner announces the fiction");
  // The name carries an ampersand, which static markup escapes — compare the escaped form.
  assert.ok(html.includes(VOORBEELD_KLANT.replace("&", "&amp;")), "the fictional client is on the page");

  // 2. The tiles are the derived arithmetic, not retyped literals.
  const t = dossierTotalen();
  for (const bedrag of [t.omzetEx, t.kostenEx, t.saldo]) {
    assert.ok(html.includes(formatEuroNL(bedrag)), `derived amount ${bedrag} reaches the page`);
  }

  // 3. The pitch is present: the open question and its exclusion sentence.
  assert.match(html, /onscherp/, "the question that stayed a question is shown");
  assert.match(html, /Telt nergens in mee/, "…and the page says it counts nowhere");

  // 4. The only exit leads to inviting the first client.
  assert.match(html, /Nodig je eerste klant uit/);
});
