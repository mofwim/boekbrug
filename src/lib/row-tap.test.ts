// [TEKST-SELECTIE] Pure node test — run: npx tsx --test src/lib/row-tap.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { tapSelectedText, onRowTap } from "./row-tap";

test("[TEKST-SELECTIE] an ordinary tap still opens the row", () => {
  assert.equal(tapSelectedText({ selectionInsideRow: false, clickCount: 1 }), false);
  // A finger that slid a little, or a drag that selected nothing, took nothing away.
  assert.equal(tapSelectedText({ selectionInsideRow: false, clickCount: 0 }), false,
    "a synthetic click (detail 0, e.g. from the keyboard) is a tap");
});

test("[TEKST-SELECTIE] a drag that selected text does not toggle the row", () => {
  assert.equal(tapSelectedText({ selectionInsideRow: true, clickCount: 1 }), true);
});

test("[TEKST-SELECTIE] the first click of a double-click is caught too", () => {
  // This is the case the selection check alone misses: click #1 lands BEFORE any selection
  // exists, so without the count the row still opens once on every word the owner double-clicks.
  assert.equal(tapSelectedText({ selectionInsideRow: false, clickCount: 2 }), true);
  assert.equal(tapSelectedText({ selectionInsideRow: true, clickCount: 3 }), true);
});

test("[TEKST-SELECTIE] the wrapper runs the tap, or does not", () => {
  // No DOM here: selectionAnchoredIn returns false without a window, so the wrapper is exercised
  // through the click count — which is exactly the half that has no DOM in it.
  let ran = 0;
  const handler = onRowTap(() => { ran++; });
  handler({ currentTarget: null as unknown as Element, detail: 1 });
  assert.equal(ran, 1, "a plain click reaches the row");
  handler({ currentTarget: null as unknown as Element, detail: 2 });
  assert.equal(ran, 1, "the second click of a double-click does not");
});
