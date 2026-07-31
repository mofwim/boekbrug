// [PAY-DATE-SANE] Pure node test — run: npx tsx --test src/lib/payment-date.test.ts
//
// The rule this guards is not "is the string well-formed?" — that test already existed and is
// exactly what let the bad dates through. It is "could a person have paid on this day?".
import { test } from "node:test";
import assert from "node:assert/strict";

import { paymentDateOutOfWindow, PAYMENT_DATE_FLOOR } from "./payment-date";

const TODAY = "2026-07-31";

test("een gewone betaaldatum wordt niet geweigerd", () => {
  assert.equal(paymentDateOutOfWindow("2026-07-30", TODAY), false);
  assert.equal(paymentDateOutOfWindow(TODAY, TODAY), false);
  assert.equal(paymentDateOutOfWindow("2019-11-04", TODAY), false); // een oude factuur mag
});

test("morgen mag — een apparaatklok of tijdzone kan een dag vooruit lopen", () => {
  assert.equal(paymentDateOutOfWindow("2026-08-01", TODAY), false);
});

test("overmorgen niet: dan is het geen klokverschil meer maar een verkeerde datum", () => {
  assert.equal(paymentDateOutOfWindow("2026-08-02", TODAY), true);
});

test("het uitgeschoten jaartal — de fout waar dit voor bestaat", () => {
  // Eén cijfer verschoven in een datumveld. Onder het kasstelsel verhuist de BTW hiermee naar een
  // kwartaal dat nog niet bestaat, en een contante betaling sleept het kasboek mee.
  assert.equal(paymentDateOutOfWindow("2062-03-01", TODAY), true);
  assert.equal(paymentDateOutOfWindow("1926-07-04", TODAY), true);
});

test("de ondergrens ligt op de vloer, niet erboven", () => {
  assert.equal(paymentDateOutOfWindow(PAYMENT_DATE_FLOOR, TODAY), false);
  assert.equal(paymentDateOutOfWindow("1999-12-31", TODAY), true);
});

test("een dag die niet bestaat wordt geweigerd, ook al klopt de vorm", () => {
  // De oude vormtest liet dit door; Date.UTC maakt er 3 maart van, dus de heenreis-terugreis
  // is het bewijs.
  assert.equal(paymentDateOutOfWindow("2026-02-31", TODAY), true);
  assert.equal(paymentDateOutOfWindow("2026-13-01", TODAY), true);
  assert.equal(paymentDateOutOfWindow("2026-00-10", TODAY), true);
  // …en een schrikkeldag die WEL bestaat blijft gewoon geldig.
  assert.equal(paymentDateOutOfWindow("2024-02-29", TODAY), false);
  assert.equal(paymentDateOutOfWindow("2026-02-29", TODAY), true);
});

test("een verkeerde vorm is ook buiten het venster", () => {
  assert.equal(paymentDateOutOfWindow("", TODAY), true);
  assert.equal(paymentDateOutOfWindow("31-07-2026", TODAY), true);
  assert.equal(paymentDateOutOfWindow("2026-7-3", TODAY), true);
  assert.equal(paymentDateOutOfWindow("2026-07-31T12:00:00Z", TODAY), true);
});

test("de grens verschuift mee met de dag die je meegeeft — geen klok in de functie", () => {
  // Dezelfde datum, twee 'vandaag's: puur, dus testbaar, dus overal dezelfde grens.
  assert.equal(paymentDateOutOfWindow("2026-08-02", "2026-08-01"), false);
  assert.equal(paymentDateOutOfWindow("2026-08-02", "2026-07-31"), true);
});

test("de jaargrens telt correct door", () => {
  // 31 december → morgen is 1 januari van het volgende jaar, niet 32 december.
  assert.equal(paymentDateOutOfWindow("2027-01-01", "2026-12-31"), false);
  assert.equal(paymentDateOutOfWindow("2027-01-02", "2026-12-31"), true);
});
