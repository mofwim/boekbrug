// [NEGEER-BULK] Pure node test — run: npx tsx --test src/lib/bulk-ignore.test.ts
//
// De eigenschap die telt is niet "de tekst is netjes" maar: NA EEN STAPEL WEET DE EIGENAAR OF HIJ
// MOET WACHTEN OF IETS MOET DOEN. Een melding die "mislukt" zegt zonder dat onderscheid stuurt hem
// twintig keer op dezelfde knop drukken terwijl er eerst een betaling teruggedraaid moet worden.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyIgnoreFailure,
  bulkIgnoreSummary,
  bulkIgnoreOffersUndo,
  bulkRestoreSummary,
} from "./bulk-ignore";

test("409 is het enige blijvende nee", () => {
  assert.equal(classifyIgnoreFailure(409), "refused");
  // 503 is de fail-closed geldcontrole: de route zegt zelf "probeer het zo meteen opnieuw".
  assert.equal(classifyIgnoreFailure(503), "unavailable");
  assert.equal(classifyIgnoreFailure(500), "unavailable");
  assert.equal(classifyIgnoreFailure(401), "unavailable");
  assert.equal(classifyIgnoreFailure(404), "unavailable");
  // Een netwerkfout heeft geen status — 0 hoort aan de tijdelijke kant.
  assert.equal(classifyIgnoreFailure(0), "unavailable");
});

test("alles gelukt — alleen het aantal, geen ruis", () => {
  assert.equal(bulkIgnoreSummary({ ok: 5, refused: 0, unavailable: 0 }), "✓ 5 facturen genegeerd");
  assert.equal(bulkIgnoreSummary({ ok: 1, refused: 0, unavailable: 0 }), "✓ 1 factuur genegeerd");
});

test("een blijvende weigering biedt NOOIT 'probeer opnieuw' aan", () => {
  // Dit is de kern: opnieuw proberen kan bij een 409 niet werken, dus die zin mag er niet staan.
  const msg = bulkIgnoreSummary({ ok: 3, refused: 2, unavailable: 0 });
  assert.ok(!msg.includes("opnieuw"), msg);
  assert.equal(msg, "3 genegeerd · 2 geweigerd — open ze los om te zien waarom");
  // Enkelvoud verwijst naar één factuur, niet naar "ze".
  assert.equal(
    bulkIgnoreSummary({ ok: 3, refused: 1, unavailable: 0 }),
    "3 genegeerd · 1 geweigerd — open hem los om te zien waarom",
  );
});

test("een tijdelijke fout biedt WEL 'probeer opnieuw' aan", () => {
  assert.equal(
    bulkIgnoreSummary({ ok: 3, refused: 0, unavailable: 2 }),
    "3 genegeerd · 2 niet gelukt — probeer het zo meteen opnieuw",
  );
});

test("beide soorten tegelijk blijven APART geteld", () => {
  // Ze optellen tot "4 mislukt" zou het enige onderscheid weggooien dat de eigenaar nodig heeft.
  const msg = bulkIgnoreSummary({ ok: 10, refused: 3, unavailable: 1 });
  assert.equal(msg, "10 genegeerd · 3 geweigerd · 1 niet gelukt — ze staan nog in de wachtrij — open ze los");
  assert.ok(msg.includes("3 geweigerd") && msg.includes("1 niet gelukt"));
});

test("niets gelukt wordt hardop gezegd — nooit stil weggelaten", () => {
  assert.equal(
    bulkIgnoreSummary({ ok: 0, refused: 2, unavailable: 0 }),
    "Niets genegeerd · 2 geweigerd — open ze los om te zien waarom",
  );
  assert.equal(
    bulkIgnoreSummary({ ok: 0, refused: 0, unavailable: 4 }),
    "Niets genegeerd · 4 niet gelukt — probeer het zo meteen opnieuw",
  );
});

test("undo wordt alleen aangeboden als er echt iets is weggehaald", () => {
  assert.equal(bulkIgnoreOffersUndo({ ok: 3, refused: 1, unavailable: 0 }), true);
  assert.equal(bulkIgnoreOffersUndo({ ok: 0, refused: 2, unavailable: 1 }), false);
  assert.equal(bulkIgnoreOffersUndo({ ok: 0, refused: 0, unavailable: 0 }), false);
});

test("de terugweg telt net zo eerlijk", () => {
  assert.equal(bulkRestoreSummary(3, 0), "3 facturen teruggezet");
  assert.equal(bulkRestoreSummary(1, 0), "1 factuur teruggezet");
  assert.equal(bulkRestoreSummary(2, 1), "2 teruggezet · 1 niet — ververs de pagina");
  assert.equal(bulkRestoreSummary(0, 3), "Terugzetten mislukt — ververs de pagina");
});
