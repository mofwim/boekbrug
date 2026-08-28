// [PAKKET-LINK] Pure node test — run: npx tsx --test src/lib/package-share.test.ts
//
// Dit token opent een compleet kwartaal aan boekhouding voor iemand zonder account. Elke tak die
// "live" teruggeeft is dus een deur, en de test is er vooral om de takken te bewijzen die hem
// DICHT houden.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SHARE_VALIDITY_DAYS,
  shareStatus,
  shareExpiry,
  shareDaysLeft,
  isBruikbaarEmail,
} from "./package-share";

const NU = Date.parse("2026-08-28T12:00:00.000Z");
const straks = (dagen: number) => new Date(NU + dagen * 86400000).toISOString();

test("[PAKKET-LINK] een verse link is live, en telt zijn dagen af", () => {
  const rij = { expires_at: straks(30), revoked_at: null };
  assert.equal(shareStatus(rij, NU), "live");
  assert.equal(shareDaysLeft(rij, NU), 30);
  assert.equal(shareDaysLeft(rij, NU + 29.5 * 86400000), 1);
});

test("[PAKKET-LINK] verlopen is dicht — op de seconde", () => {
  assert.equal(shareStatus({ expires_at: straks(-1), revoked_at: null }, NU), "expired");
  // Precies op het moment van verlopen: dicht. Een grens die op zichzelf openstaat is geen grens.
  assert.equal(shareStatus({ expires_at: new Date(NU).toISOString(), revoked_at: null }, NU), "expired");
  assert.equal(shareDaysLeft({ expires_at: straks(-1), revoked_at: null }, NU), 0);
});

test("[PAKKET-LINK] ingetrokken wint van verlopen — de eigenaar hoort zijn eigen daad terug te zien", () => {
  const rij = { expires_at: straks(-5), revoked_at: straks(-10) };
  assert.equal(shareStatus(rij, NU), "revoked");
});

test("[PAKKET-LINK] alles wat niet aantoonbaar geldig is, is dicht", () => {
  // Geen datum, lege datum, en onzin: allemaal verlopen — nooit live.
  assert.equal(shareStatus({ expires_at: null, revoked_at: null }, NU), "expired");
  assert.equal(shareStatus({ expires_at: "", revoked_at: null }, NU), "expired");
  assert.equal(shareStatus({ expires_at: "morgen", revoked_at: null }, NU), "expired");
  // Een onleesbare INTREKKINGSdatum telt als ingetrokken: de kolom is alleen gevuld als er is
  // ingetrokken, dus haar aanwezigheid is het feit.
  assert.equal(shareStatus({ expires_at: straks(10), revoked_at: "onleesbaar" }, NU), "revoked");
});

test("[PAKKET-LINK] een toekomstige intrekking is nog geen intrekking", () => {
  // Verdedigt tegen een klok die achterloopt of een rij die vooruit is geschreven: alleen een
  // intrekking die AL heeft plaatsgevonden sluit de deur.
  assert.equal(shareStatus({ expires_at: straks(10), revoked_at: straks(5) }, NU), "live");
});

test("[PAKKET-LINK] de vervaldatum is dertig dagen, en de constante is de bron", () => {
  const eind = Date.parse(shareExpiry(NU));
  assert.equal(Math.round((eind - NU) / 86400000), SHARE_VALIDITY_DAYS);
  assert.equal(shareStatus({ expires_at: shareExpiry(NU), revoked_at: null }, NU), "live");
});

test("[PAKKET-LINK] het adres wordt getoetst zoals de uitnodiging het toetst", () => {
  assert.equal(isBruikbaarEmail("boekhouder@kantoor.nl"), true);
  assert.equal(isBruikbaarEmail(" boekhouder@kantoor.nl "), true, "spaties zijn geen fout van de gebruiker");
  assert.equal(isBruikbaarEmail("geen-adres"), false);
  assert.equal(isBruikbaarEmail("a@b"), false);
  assert.equal(isBruikbaarEmail(null), false);
  assert.equal(isBruikbaarEmail(42), false);
});
