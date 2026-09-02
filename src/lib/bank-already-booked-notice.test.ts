// [DUBBEL-GEDEKT] Pure node test — run: npx tsx --test src/lib/bank-already-booked-notice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { alreadyBookedNotice } from "./bank-already-booked-notice";

test("[DUBBEL-GEDEKT] a held line says WHY, in the owner's own language", () => {
  const nl = alreadyBookedNotice("paid-invoice", "nl");
  assert.ok(nl, "a hold the app acted on must be explained");
  assert.equal(nl.title, "Een betaalde factuur verklaart dit bedrag al.");
  assert.match(nl.body, /twee keer/, "…and names the consequence the owner is being protected from");
  assert.equal(nl.dir, "ltr");

  const mollie = alreadyBookedNotice("mollie-payout", "nl");
  assert.ok(mollie);
  assert.notEqual(mollie.title, nl.title, "two different holds are two different sentences");
  assert.match(mollie.title, /Mollie/);
});

test("[DUBBEL-GEDEKT] the panel carries its own direction", () => {
  const ar = alreadyBookedNotice("paid-invoice", "ar");
  assert.ok(ar);
  assert.equal(ar.dir, "rtl", "direction travels with the words, not with the component");
  assert.notEqual(ar.title, "Een betaalde factuur verklaart dit bedrag al.", "Arabic is translated, not Dutch");
  // An unset language falls back to Dutch — never to a key, never to a blank.
  const fallback = alreadyBookedNotice("paid-invoice", null);
  assert.equal(fallback?.title, "Een betaalde factuur verklaart dit bedrag al.");
});

test("[DUBBEL-GEDEKT] nothing held, nothing said", () => {
  assert.equal(alreadyBookedNotice(null), null);
  assert.equal(alreadyBookedNotice(undefined), null);
  assert.equal(alreadyBookedNotice(""), null);
});

test("[DUBBEL-GEDEKT] an unknown reason loses the sentence, never invents one", () => {
  // A client running against a newer server. The screen's safety half keys off the PRESENCE of a
  // reason, so nothing is pre-selected either way; saying "a paid invoice explains this" about a
  // hold we do not recognise would be a claim the server never made.
  assert.equal(alreadyBookedNotice("some-future-reason", "nl"), null);
});
