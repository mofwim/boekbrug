// src/lib/why-waiting.test.ts
// [WAAROM-WACHT] One sentence, the right one, in the owner's language — and never a machine word.

import test from "node:test";
import assert from "node:assert/strict";
import { explainWaiting, waitingReasonOf, explainableReasons } from "./why-waiting";
import { MESSAGES } from "./i18n/messages";
import { LOCALES } from "./i18n/locale";

test("[WAAROM-WACHT] the reason is read off the stored row, in every shape it can arrive in", () => {
  assert.equal(waitingReasonOf(null), null);
  assert.equal(waitingReasonOf("kapot"), null);
  assert.equal(waitingReasonOf({}), null);
  assert.equal(waitingReasonOf({ _auto_hold: null }), null);
  assert.equal(waitingReasonOf({ _auto_hold: { at: "x" } }), null, "a hold without a reason is not a reason");
  assert.equal(waitingReasonOf({ _auto_hold: { at: "x", reason: "   " } }), null);
  assert.equal(waitingReasonOf({ _auto_hold: { at: "x", reason: "creditnota" } }), "creditnota");
});

test("[WAAROM-WACHT] nothing recorded means nothing said — a guess would be worse than silence", () => {
  assert.equal(explainWaiting(null), null);
});

test("[WAAROM-WACHT] a tag with no sentence shows nothing, never the machine word", () => {
  // Op het beheerpaneel staat een onbekende code wél, als zichzelf — daar is het informatie. Hier
  // staat hij voor iemand die niet om een woordenlijst vroeg. De poort verderop houdt de lijst
  // compleet, zodat "geen zin" nooit stilletjes een veelvoorkomend geval verbergt.
  assert.equal(explainWaiting("gloednieuwe_reden"), null);
});

test("[WAAROM-WACHT] a card that already explains itself gets no second explanation", () => {
  assert.equal(explainWaiting("needs_review", { alreadyExplained: true }), null,
    "two explanations of one delay is how a calm screen becomes a nagging one");
  assert.ok(explainWaiting("needs_review", { alreadyExplained: false }));
});

test("[WAAROM-WACHT] the owner's own switch is a setting, not a reading problem", () => {
  const uit = explainWaiting("owner_reviews_everything");
  assert.equal(uit?.kind, "setting");
  assert.equal(explainWaiting("no_reliable_total")?.kind, "reading",
    "one is something to change, the other something to check — the screen colours them apart");
});

test("[WAAROM-WACHT] the sentence about the switch names the switch as it is written", () => {
  // AGENTS.md: een zin die naar een knop wijst, noemt hem zoals hij op het scherm staat. Vertaal
  // je hem los, dan zoekt de eigenaar naar een woord dat nergens in de interface voorkomt.
  for (const taal of ["nl", "ar", "en"] as const) {
    const knop = MESSAGES["inst.autoBoeken"][taal];
    const zin = explainWaiting("owner_reviews_everything", {}, taal);
    assert.ok(zin && knop && zin.text.includes(knop),
      `${taal}: the sentence must quote the toggle label "${knop}" exactly as the settings screen writes it`);
  }
});

test("[WAAROM-WACHT] Arabic carries its direction on the same object as its words", () => {
  const ar = explainWaiting("no_reliable_total", {}, "ar");
  assert.equal(ar?.dir, "rtl");
  assert.notEqual(ar?.text, explainWaiting("no_reliable_total", {}, "nl")?.text);
});

test("[WAAROM-WACHT] a language without these lines falls back to Dutch, never to a key", () => {
  // Turks staat bewust nog niet in de catalogus. Een sleutel op een kaart is erger dan Nederlands.
  const tr = explainWaiting("no_reliable_total", {}, "tr");
  const nl = explainWaiting("no_reliable_total", {}, "nl");
  assert.equal(tr?.text, nl?.text);
  assert.doesNotMatch(tr?.text ?? "", /^wacht\./);
});

test("[WAAROM-WACHT] no sentence, in any language, leaks a machine tag", () => {
  // De hele reden dat deze module bestaat: `no_reliable_total` op een kaart is geen uitleg.
  for (const reden of explainableReasons()) {
    for (const taal of LOCALES) {
      const zin = explainWaiting(reden, {}, taal);
      assert.ok(zin, `${reden} (${taal}) must produce a sentence`);
      assert.doesNotMatch(zin.text, /[a-z]{3,}_[a-z_]{3,}/,
        `${reden} (${taal}) renders something that reads like a machine tag: "${zin.text}"`);
      assert.ok(zin.text.length > 15, `${reden} (${taal}) is too short to be an explanation`);
    }
  }
});
