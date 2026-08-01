// [BULK-IGNORE] Pure node test — run: npx tsx --test src/lib/bulk-ignore.test.ts
//
// The property that matters is not "the text is tidy" but: AFTER A BATCH THE OWNER KNOWS WHETHER
// TO WAIT OR TO ACT. A message that says "failed" without that distinction sends them tapping the
// same button twenty times while a payment needs reversing first.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyIgnoreFailure,
  bulkIgnoreSummary,
  bulkIgnoreOffersUndo,
  bulkRestoreSummary,
} from "./bulk-ignore";

test("409 is the only permanent no", () => {
  assert.equal(classifyIgnoreFailure(409), "refused");
  // 503 is the fail-closed money check: the route itself says "try again in a moment".
  assert.equal(classifyIgnoreFailure(503), "unavailable");
  assert.equal(classifyIgnoreFailure(500), "unavailable");
  assert.equal(classifyIgnoreFailure(401), "unavailable");
  assert.equal(classifyIgnoreFailure(404), "unavailable");
  // A network error has no status — 0 belongs on the temporary side.
  assert.equal(classifyIgnoreFailure(0), "unavailable");
});

test("all done — just the count, no noise", () => {
  assert.equal(bulkIgnoreSummary({ ok: 5, refused: 0, unavailable: 0 }), "✓ 5 facturen genegeerd");
  assert.equal(bulkIgnoreSummary({ ok: 1, refused: 0, unavailable: 0 }), "✓ 1 factuur genegeerd");
});

test("a permanent refusal NEVER offers 'try again'", () => {
  // This is the crux: retrying cannot work on a 409, so that sentence must not appear.
  const msg = bulkIgnoreSummary({ ok: 3, refused: 2, unavailable: 0 });
  assert.ok(!msg.includes("opnieuw"), msg);
  assert.equal(msg, "3 genegeerd · 2 geweigerd — open ze los om te zien waarom");
  // The singular refers to one invoice, not to "ze".
  assert.equal(
    bulkIgnoreSummary({ ok: 3, refused: 1, unavailable: 0 }),
    "3 genegeerd · 1 geweigerd — open hem los om te zien waarom",
  );
});

test("a temporary error DOES offer 'try again'", () => {
  assert.equal(
    bulkIgnoreSummary({ ok: 3, refused: 0, unavailable: 2 }),
    "3 genegeerd · 2 niet gelukt — probeer het zo meteen opnieuw",
  );
});

test("both kinds at once stay counted SEPARATELY", () => {
  // Adding them into "4 failed" would throw away the only distinction the owner needs.
  const msg = bulkIgnoreSummary({ ok: 10, refused: 3, unavailable: 1 });
  assert.equal(msg, "10 genegeerd · 3 geweigerd · 1 niet gelukt — ze staan nog in de wachtrij — open ze los");
  assert.ok(msg.includes("3 geweigerd") && msg.includes("1 niet gelukt"));
});

test("nothing succeeded is said out loud — never quietly omitted", () => {
  assert.equal(
    bulkIgnoreSummary({ ok: 0, refused: 2, unavailable: 0 }),
    "Niets genegeerd · 2 geweigerd — open ze los om te zien waarom",
  );
  assert.equal(
    bulkIgnoreSummary({ ok: 0, refused: 0, unavailable: 4 }),
    "Niets genegeerd · 4 niet gelukt — probeer het zo meteen opnieuw",
  );
});

test("undo is offered only when something was actually removed", () => {
  assert.equal(bulkIgnoreOffersUndo({ ok: 3, refused: 1, unavailable: 0 }), true);
  assert.equal(bulkIgnoreOffersUndo({ ok: 0, refused: 2, unavailable: 1 }), false);
  assert.equal(bulkIgnoreOffersUndo({ ok: 0, refused: 0, unavailable: 0 }), false);
});

test("the way back counts just as honestly", () => {
  assert.equal(bulkRestoreSummary(3, 0), "3 facturen teruggezet");
  assert.equal(bulkRestoreSummary(1, 0), "1 factuur teruggezet");
  assert.equal(bulkRestoreSummary(2, 1), "2 teruggezet · 1 niet — ververs de pagina");
  assert.equal(bulkRestoreSummary(0, 3), "Terugzetten mislukt — ververs de pagina");
});
