// tests/render/office-front-door.test.tsx
// [RENDER-GATE] Does /voor-boekhouders render, and does it still tell the truth about money?
//
// Run: npm run test:render
//
// ── WHY IT RENDERS HERE ──
// The argument for this whole directory is at the top of money-screens.test.tsx: tsc, eslint and
// next build never CALL a component. The Playwright sweep does reach this path, but it runs last
// in `npm run gates` and needs a built server; this catches the same class in under a second.
//
// ── WHY IT ASSERTS SENTENCES AND NOT JUST "NOT EMPTY" ──
// Because of who reads this page. It is the only page in the app written for an
// administratiekantoor, and an office decides for its whole book — MARKTPOSITIE_2026.md §9 puts
// one office meeting above a year of SEO. That makes a wrong claim here more expensive than a
// wrong claim anywhere else in the product: an office that catches one does not complain, it
// stops replying, and it takes fifty ZZP'ers with it.
//
// Three specific claims are therefore pinned:
//
//   1. THE PRICES ARE NOT ACTIVE, and the page says so. accountant-pricing.ts publishes a ladder
//      that bills nobody while ACCOUNTANT_PRICING_ACTIVE is false, and PRICING_DECISION_2026-08.md
//      is explicit that publishing it as prepared-not-active is the whole reason it was allowed to
//      be published at all. A price table that renders WITHOUT that disclosure is not a smaller
//      version of this page — it is a different and untrue one.
//   2. EVERY AMOUNT COMES FROM THE CONSTANTS. In July 2026 the Terms quoted € 25 and € 45 while
//      the database knew a different model and neither knew about the other. The same defect
//      reaching a sales page is how an office is quoted a number nobody can honour. There is a
//      test like this one guarding the rendered Terms; this is its twin for the rendered page.
//   3. NOTHING IS PROMISED FOR LATER. /prijzen carries the rule in its header comment — only
//      features that EXIST — and it binds harder here, because a professional reader checks.
//
// None of the three is visible to tsc: they are all "the right string reached the right page".

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import VoorBoekhoudersPage from "../../src/app/voor-boekhouders/page";
import {
  ACCOUNTANT_BANDS,
  ACCOUNTANT_PRICING_ACTIVE,
  euro,
  inclBtw,
} from "../../src/lib/accountant-pricing";
import { ACCOUNTANT_FREE_CLIENTS } from "../../src/lib/fair-use";
import { isPublic } from "../../src/lib/public-paths";

/** The page as a crawler and a logged-out office get it: server-rendered, no session, no props. */
function render(): string {
  return renderToStaticMarkup(<VoorBoekhoudersPage />);
}

test("[KANTOOR-VOORDEUR] the page survives being called", () => {
  const html = render();
  assert.ok(html.length > 2000, "the office front door rendered (almost) nothing");
  assert.match(html, /Voor administratiekantoren/, "the page does not name its own audience");
});

test("[KANTOOR-VOORDEUR] the free boundary on the page is the one the app enforces", () => {
  // fair-use.ts is the single source; /prijzen and the Terms read the same constant. A hand-typed
  // "10" here would keep being 10 on the day the constant becomes 15.
  const html = render();
  assert.match(
    html,
    new RegExp(`tot en met ${ACCOUNTANT_FREE_CLIENTS} gekoppelde klanten`),
    "the page does not quote ACCOUNTANT_FREE_CLIENTS as the free boundary",
  );
});

test("[KANTOOR-STAFFEL] every band amount on the page comes from the constants", () => {
  const html = render();
  for (const band of ACCOUNTANT_BANDS) {
    if (band.monthlyExclBtw === 0) continue; // the free band renders as a word, not an amount
    assert.ok(
      html.includes(euro(band.monthlyExclBtw)),
      `${euro(band.monthlyExclBtw)} excl. btw never reached the page`,
    );
    assert.ok(
      html.includes(euro(inclBtw(band.monthlyExclBtw))),
      `${euro(inclBtw(band.monthlyExclBtw))} incl. btw never reached the page — ` +
        "the office reclaims the btw, so it compares the excl. amount and pays the incl. one",
    );
  }
});

test("[KANTOOR-STAFFEL] a published price that bills nobody says so on the page", () => {
  // This is the assertion that would fire if someone tidied the disclosure away as clutter. It is
  // conditional on the flag for a reason: the day the pricing IS activated, this test must not
  // demand a sentence that has become false. Then the disclosure goes and the flag explains why.
  const html = render();
  if (!ACCOUNTANT_PRICING_ACTIVE) {
    assert.match(
      html,
      /nog niet actief/,
      "the ladder is published while nothing bills anyone, and the page must say that",
    );
    assert.match(
      html,
      /geen enkel administratiekantoor over gesproken/,
      "the prices are a documented guess; PRICING_DECISION_2026-08.md §6 requires saying so",
    );
    assert.match(
      html,
      /30 dagen/,
      "the Terms promise 30 days' notice before any charge — the sales page may not omit it",
    );
  }
});

test("[KANTOOR-VOORDEUR] nothing on the page is promised for later", () => {
  // The rule from /prijzen, and it binds harder here. "Binnenkort" on a page aimed at a
  // professional buyer is the sentence they will quote back when it has not arrived.
  const html = render();
  for (const woord of ["binnenkort", "coming soon", "in ontwikkeling", "we werken aan"]) {
    assert.ok(
      !html.toLowerCase().includes(woord),
      `the page promises something for later: ${JSON.stringify(woord)}`,
    );
  }
});

test("[CARD-RECON] the pin section keeps the sentence that makes it trustworthy", () => {
  // MARKTPOSITIE_2026.md §1 says the real differentiator "appears on no feature list — including
  // his own". This section is the fix, and it is aimed at the reader who checks: a bookkeeper
  // responsible for somebody else's administration.
  //
  // Two things in it must survive a later rewrite, and both read like clutter to an editor
  // shortening a page — which is exactly why they are asserted rather than trusted.
  const html = render();

  // 1. The reason it matters at all. Without gross-versus-net there is no problem to solve, and
  //    the section becomes a feature nobody asked for.
  assert.match(html, /bruto/i, "the pin section no longer says the till books gross");
  assert.match(html, /netto/i, "the pin section no longer says the acquirer pays net");

  // 2. The honesty guard from card-reconcile.ts: a missing bank payout is reported as not yet
  //    matched, never filled in with a plausible number. To a professional reader this sentence
  //    is the difference between a tool they can sign off on and one they cannot.
  assert.match(
    html,
    /geen bedrag ingevuld dat niemand heeft gezien/i,
    "the pin section dropped the promise that no unseen amount is invented",
  );
});

test("[KANTOOR-VOORDEUR] the four questions an office asks are answered with a no", () => {
  // XAF, RGS, filing and Peppol. These are on the page because they are the ones that end a
  // conversation when they surface late, and every one of them is a "nee" today. If one becomes a
  // "ja", this test is the reminder that the page has to change with it — not a reason to delete
  // the section.
  const html = render();
  for (const onderwerp of ["XAF", "RGS", "Peppol", "Belastingdienst"]) {
    assert.ok(html.includes(onderwerp), `${onderwerp} is not addressed on the office page`);
  }
});

test("[KANTOOR-VOORDEUR] the middleware lets a logged-out office reach it", () => {
  // The page can render perfectly and still be invisible: a path missing from PUBLIC_PATHS is
  // redirected to /login, which for a marketing page means it exists for nobody — including the
  // crawler that would have found it. The e2e sweep catches this too, but only after a build.
  assert.ok(isPublic("/voor-boekhouders"), "/voor-boekhouders is behind the login wall");
});
