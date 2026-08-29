// tests/render/page-tray.test.tsx
// [PAGINA-VOLGORDE] Does the page tray draw the pages, with a list that reaches every branch?
//
// Run: npm run test:render
//
// The tray is the surface the whole page-order control is delivered on: the thumbnail, the number,
// the ↑/↓ and the sentence saying the app rearranged something. All of it lives inside
// `pages.map(...)` — and an empty tray never calls the callback, so a crash in a row is invisible
// against `pages: []`. That is the exact shape money-screens.test.tsx was built for. So this file
// hands it real pages, a real notice, and the two boundary rows (first, last) where the buttons
// are the ones that get disabled.

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// No next/navigation mock: the tray is a pure piece of screen. It takes its pages as props and
// its words from the catalogue — it does not route, fetch or read a session. That is the property
// that makes it renderable here at all, and it is worth keeping.

/** One tray page without a DOM. `preview` is the objectURL usePageTray makes in the browser; on a
 *  server render there is none, and the tray must still draw the row. */
const page = (name: string, preview = "") => ({
  file: { name, size: 120_000, lastModified: 1 } as unknown as File,
  preview,
});

test("[PAGINA-VOLGORDE] the tray draws every page, numbered, with a way to move it", async () => {
  const { default: PageTray } = await import("../../src/components/intake/PageTray");

  const html = renderToStaticMarkup(
    React.createElement(PageTray, {
      pages: [page("IMG_0004.jpg"), page("IMG_0005.jpg"), page("IMG_0006.jpg")],
      notice: { sorted: true, duplicates: 1, overflow: 2, max: 20 },
      accent: "#007aff",
      onMove: () => {},
      onRemove: () => {},
    }),
  );

  assert.ok(html.length > 0, "the tray rendered nothing at all");

  // TEXT, not markup. `html.includes("Pagina 1")` passes on the ↑ button's OWN aria-label
  // ("Pagina 1 naar voren"), so the first version of this assertion stayed green with the visible
  // page number deleted — it was matching a mention instead of the thing being claimed. Dropping
  // every tag leaves only what a reader actually sees.
  const text = html.replace(/<[^>]*>/g, "\u0000");

  // Every page is numbered — the number is what the owner checks the order against.
  for (const n of [1, 2, 3]) {
    assert.ok(text.includes(`Pagina ${n}`), `page ${n} is not numbered on screen`);
  }
  // …and named, so a page can be told apart from the one above it.
  assert.ok(text.includes("IMG_0005.jpg"), "the filename is not shown");

  // The order is CORRECTABLE, not merely visible. Two moves per page, minus the two that cannot
  // happen (first up, last down) — asserted as a count so a row that silently lost its buttons
  // cannot pass.
  const moves = html.match(/aria-label="Pagina \d+ naar (?:voren|achteren)"/g) ?? [];
  assert.equal(moves.length, 6, "every page needs both directions, disabled at the ends");
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2, "exactly the first ↑ and the last ↓");

  // The three things the last add did are all said out loud — a rearrangement nobody was told
  // about is indistinguishable from a bug, and pages that did not fit must never vanish quietly.
  assert.ok(text.includes("op nummer gezet"), "the tray did not say it sorted the pages");
  assert.ok(text.includes("stond er al bij"), "the skipped re-pick was not reported");
  assert.ok(text.includes("max 20"), "the pages that did not fit were not reported");
});

test("[PAGINA-VOLGORDE] with nothing to report the tray claims nothing", async () => {
  const { default: PageTray } = await import("../../src/components/intake/PageTray");

  const html = renderToStaticMarkup(
    React.createElement(PageTray, {
      pages: [page("a.jpg"), page("b.jpg")],
      notice: { sorted: false, duplicates: 0, overflow: 0, max: 20 },
      accent: "#1A73E8",
      onMove: () => {},
      onRemove: () => {},
    }),
  );

  const text = html.replace(/<[^>]*>/g, "\u0000");
  assert.ok(text.includes("Pagina 2"), "the pages are still drawn");
  assert.ok(!text.includes("op nummer gezet"), "nothing moved, so nothing may be claimed");
  assert.ok(!text.includes("stond er al bij"));
  assert.ok(!text.includes("paste er niet meer bij"));
});

test("[PAGINA-VOLGORDE] an empty tray is nothing, not an empty box", async () => {
  const { default: PageTray } = await import("../../src/components/intake/PageTray");
  const html = renderToStaticMarkup(
    React.createElement(PageTray, {
      pages: [], notice: null, accent: "#007aff", onMove: () => {}, onRemove: () => {},
    }),
  );
  assert.equal(html, "", "an empty tray must not draw a heading over nothing");
});
