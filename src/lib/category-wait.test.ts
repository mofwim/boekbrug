// src/lib/category-wait.test.ts
// [WAAROM-WACHT-CAT] The one distinction the screen was not making.

import test from "node:test";
import assert from "node:assert/strict";
import { judgeCategoryWait, categoryHint } from "./category-wait";
import { suggestIdentity } from "./bank-identity";
import { explainWaiting } from "./why-waiting";

test("[WAAROM-WACHT-CAT] a confident suggestion waits on a tap, not on an explanation", () => {
  assert.equal(judgeCategoryWait({ category: "kosten", source: "memory", confident: true }), null);
  assert.equal(judgeCategoryWait({ category: "prive", source: "ai", confident: true }), null);
});

test("[WAAROM-WACHT-CAT] a memory pointing the other way is named, not dressed as a memory", () => {
  // Dit is de regel die het scherm als "onthouden" toonde — precies als een geheugen waar de app
  // zeker van is. Gebouwd via suggestIdentity zelf, want een met de hand verzonnen suggestie zou
  // blijven kloppen nadat die functie van gedachten veranderde.
  const tegenstrijdig = suggestIdentity("Hano Groothandel", "SEPA", -450, "omzet");
  assert.equal(tegenstrijdig.source, "memory");
  assert.equal(tegenstrijdig.confident, false, "an omzet memory on a debit is not confident");
  assert.equal(judgeCategoryWait(tegenstrijdig), "memory_contradicts_direction");

  const klopt = suggestIdentity("Hano Groothandel", "SEPA", -450, "kosten");
  assert.equal(klopt.confident, true);
  assert.equal(judgeCategoryWait(klopt), null);
});

test("[WAAROM-WACHT-CAT] a look-alike is a look-alike, and says so", () => {
  const lijkt = suggestIdentity("Jansen Holding", "", -100, null, { category: "kosten", matchedKey: "jansen bv", score: 0.9 });
  assert.equal(lijkt.source, "similar");
  assert.equal(judgeCategoryWait(lijkt), "resembles_another_counterparty");
});

test("[WAAROM-WACHT-CAT] an unknown counterparty gets the guess named as a guess", () => {
  const gok = suggestIdentity("Volstrekt Onbekend VOF", "", -100);
  assert.equal(gok.confident, false, "the bare sign fallback is never confident");
  assert.equal(judgeCategoryWait(gok), "counterparty_never_seen");
});

test("[WAAROM-WACHT-CAT] every reason it can return has an owner sentence", () => {
  // De poort in lifecycle-gates dekt dit ook, maar hier staat het naast de functie die de codes
  // maakt — en dat is waar iemand er een bij zet.
  for (const s of [
    suggestIdentity("A", "", -1, "omzet"),
    suggestIdentity("B", "", -1, null, { category: "kosten", matchedKey: "b bv", score: 0.9 }),
    suggestIdentity("C", "", -1),
  ]) {
    const reden = judgeCategoryWait(s);
    assert.ok(reden, "these three are all un-confident by construction");
    const zin = explainWaiting(reden, {}, "nl");
    assert.ok(zin && zin.text.length > 20, `"${reden}" reaches the screen with no sentence`);
  }
});

// ── Het label boven de regel ───────────────────────────────────────────────────────────────────

test("[WAAROM-WACHT-CAT] a contradicted memory does not get the label of a trusted one", () => {
  assert.equal(
    categoryHint({ source: "memory", waitReason: "memory_contradicts_direction", confident: false }).key,
    "cat.onthoudenAndersom",
  );
  assert.equal(categoryHint({ source: "memory", waitReason: null, confident: true }).key, "cat.onthouden");
});

test("[WAAROM-WACHT-CAT] an already-booked line is not relabelled as a contradicted memory", () => {
  // De valstrik: suggested_confident vouwt de dubbelboekingsrem erin, dus een ZEKER geheugen op
  // een al geboekte regel komt hier binnen met confident:false. Zou het label daarop oordelen,
  // dan zou het scherm "onthouden, maar andersom" zeggen over een geheugen dat prima klopt.
  assert.equal(
    categoryHint({ source: "memory", waitReason: null, confident: false }).key,
    "cat.onthouden",
  );
});

test("[WAAROM-WACHT-CAT] a look-alike names the counterparty when it has one", () => {
  assert.deepEqual(categoryHint({ source: "similar", waitReason: "resembles_another_counterparty", similarTo: "Jansen B.V.", confident: false }),
    { key: "cat.lijktOp", name: "Jansen B.V." });
  assert.deepEqual(categoryHint({ source: "similar", waitReason: "resembles_another_counterparty", similarTo: "   ", confident: false }),
    { key: "cat.lijktOpEerdere" });
});

test("[WAAROM-WACHT-CAT] a guess is labelled a proposal and a pattern hit is labelled recognised", () => {
  assert.equal(categoryHint({ source: "ai", waitReason: "counterparty_never_seen", confident: false }).key, "cat.voorstel");
  assert.equal(categoryHint({ source: "ai", waitReason: null, confident: true }).key, "cat.herkend");
  assert.equal(categoryHint({ source: "supplier", waitReason: null, confident: true }).key, "cat.herkend");
});
