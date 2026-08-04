// [OPVRAGEN] Pure node test — run: npx tsx --test src/lib/document-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDocumentRequest,
  requestSummary,
  MAX_ITEMS,
  MAX_EXTRA,
} from "./document-request";

const basis = {
  quarterLabel: "Q2 2026",
  accountantName: "Administratiekantoor De Wit",
};

function tekstVan(r: ReturnType<typeof buildDocumentRequest>): string {
  assert.equal(r.ok, true, "verwacht een bericht");
  return r.ok ? r.text : "";
}

test("the request names the gaps, one per line", () => {
  const tekst = tekstVan(
    buildDocumentRequest({
      ...basis,
      items: [
        { title: "3 bankregels zonder bon", detail: "€ 412 aan kosten" },
        { title: "Kwartaal 2 kassa ontbreekt" },
      ],
    }),
  );
  assert.match(tekst, /Q2 2026/, "the quarter is named");
  assert.match(tekst, /• 3 bankregels zonder bon — € 412 aan kosten/, "title and detail on one line");
  assert.match(tekst, /• Kwartaal 2 kassa ontbreekt/, "an item without a detail still stands alone");
  assert.match(tekst, /Administratiekantoor De Wit/, "signed by a real name, not by the app");
});

test("the sentence that may never disappear", () => {
  // readiness.ts cannot see a receipt that was never uploaded. A request that implies "then we are
  // done" is a promise that breaks at exactly the wrong moment — when the Belastingdienst disagrees.
  const tekst = tekstVan(buildDocumentRequest({ ...basis, items: [{ title: "Bon van 12 mei" }] }));
  assert.match(tekst, /wat er niet in staat, kan ik ook niet zien/, "the honest limit is stated");
  assert.doesNotMatch(tekst, /compleet|volledig|klaar zijn we/i, "and completeness is never claimed");
});

test("the accountant's own sentence comes FIRST, above the list", () => {
  // A list above the human part reads as an automated reminder, which is the moment a client stops
  // reading it.
  const tekst = tekstVan(
    buildDocumentRequest({
      ...basis,
      extra: "Ik zag dat de betaling van Jansen binnen is, top.",
      items: [{ title: "Bon van 12 mei" }],
    }),
  );
  const posExtra = tekst.indexOf("Jansen");
  const posLijst = tekst.indexOf("• Bon van 12 mei");
  assert.ok(posExtra > -1 && posLijst > -1);
  assert.ok(posExtra < posLijst, "the human sentence precedes the bullet list");
});

test("the same gap named twice is asked for once", () => {
  // A missing receipt shows up under both the invoice and the bank dimension. Asking twice makes
  // the list look machine-generated.
  const tekst = tekstVan(
    buildDocumentRequest({
      ...basis,
      items: [
        { title: "Bon van 12 mei" },
        { title: "bon van 12 MEI" },
        { title: "Bon van 12 mei", detail: "andere tekst" },
      ],
    }),
  );
  assert.equal(tekst.split("Bon van 12 mei").length - 1, 1, "listed exactly once");
});

test("an empty request is refused, not sent", () => {
  // "Je boekhouder vraagt om stukken" with nothing named is precisely the useless WhatsApp this
  // feature exists to replace.
  const leeg = buildDocumentRequest({ ...basis, items: [] });
  assert.equal(leeg.ok, false);
  if (!leeg.ok) assert.match(leeg.reason, /minstens één punt/);
  // Blank titles do not count as items either.
  const blanco = buildDocumentRequest({ ...basis, items: [{ title: "   " }] });
  assert.equal(blanco.ok, false);
});

test("a sentence alone is a valid request — the list is not mandatory", () => {
  const r = buildDocumentRequest({ ...basis, items: [], extra: "Heb je de jaarrekening van 2025 nog?" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /jaarrekening van 2025/);
    // No bullet list, so the "wat er niet in staat" note has nothing to qualify — and a note about
    // a list that is not there would read as noise.
    assert.doesNotMatch(r.text, /•/);
  }
});

test("too many points is refused with the advice to call", () => {
  const veel = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ title: `Punt ${i + 1}` }));
  const r = buildDocumentRequest({ ...basis, items: veel });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, new RegExp(String(MAX_ITEMS)), "says what the limit is");
    assert.match(r.reason, /bel even/, "…and what to do instead");
  }
  // Exactly at the limit still goes.
  assert.equal(buildDocumentRequest({ ...basis, items: veel.slice(0, MAX_ITEMS) }).ok, true);
});

test("an over-long personal sentence is refused before it is sent", () => {
  const r = buildDocumentRequest({ ...basis, items: [{ title: "x" }], extra: "a".repeat(MAX_EXTRA + 1) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /eigen bericht/);
});

test("a missing name or quarter is refused — the message must not be signed by nobody", () => {
  assert.equal(buildDocumentRequest({ ...basis, accountantName: "  ", items: [{ title: "x" }] }).ok, false);
  assert.equal(buildDocumentRequest({ ...basis, quarterLabel: "", items: [{ title: "x" }] }).ok, false);
});

test("the preview line says the NUMBER, because that is what decides when it gets opened", () => {
  assert.match(requestSummary(1, "Q2 2026"), /nog 1 ding voor Q2 2026/);
  assert.match(requestSummary(4, "Q2 2026"), /nog 4 dingen voor Q2 2026/);
  // No items = a plain question, and it must not say "0 dingen".
  // (The year contains a zero, so the assertion has to be about the COUNT, not about the digit.)
  assert.doesNotMatch(requestSummary(0, "Q2 2026"), /\b0 ding/);
  assert.match(requestSummary(0, "Q2 2026"), /^Vraag over Q2 2026$/);
});
