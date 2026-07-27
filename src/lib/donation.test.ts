// [STEUN] Pure node test — run: npx tsx --test src/lib/donation.test.ts
//
// De poortwachter is het enige dat voorkomt dat er ooit om geld wordt gevraagd zonder dat
// duidelijk is wie het vraagt. Deze tests bewaken die grens.
import { test } from "node:test";
import assert from "node:assert/strict";

import { hasLegalEntity } from "./donation";

test("een echt KVK-nummer telt als rechtspersoon", () => {
  assert.equal(hasLegalEntity("12345678"), true);
  assert.equal(hasLegalEntity(" 12345678 "), true);
});

test("een niet-ingevulde identiteit telt nooit als rechtspersoon", () => {
  // Dit is de standaardwaarde zolang de env-variabele leeg is.
  assert.equal(hasLegalEntity("(volgt)"), false);
  assert.equal(hasLegalEntity("[INVULLEN]"), false);
  assert.equal(hasLegalEntity(""), false);
  assert.equal(hasLegalEntity("   "), false);
});

test("iets dat geen KVK-nummer is, wordt niet voor lief genomen", () => {
  // Liever een pagina te weinig dan een pagina met een verzonnen nummer erop.
  assert.equal(hasLegalEntity("BoekBrug"), false);
  assert.equal(hasLegalEntity("1234567"), false, "zeven cijfers is geen KVK-nummer");
  assert.equal(hasLegalEntity("123456789"), false, "negen cijfers ook niet");
  assert.equal(hasLegalEntity("KVK 12345678"), false, "het nummer moet kaal zijn");
});
