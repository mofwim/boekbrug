// [LOGO-INITIALEN] Pure node test — run: npx tsx --test src/lib/logo-initials.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveInitials } from "./logo-initials";

test("a three-word company gets three initials, not the first and the last", () => {
  // The report that started this: the invoice PDF printed KM, because it took words[0] and
  // words[last]. A person writing this monogram writes KFM.
  assert.equal(deriveInitials("Kiwi Food Market"), "KFM");
});

test("two words still give two initials", () => {
  assert.equal(deriveInitials("Kiwi Market"), "KM");
});

test("one word gives its first two letters", () => {
  assert.equal(deriveInitials("Boekbrug"), "BO");
});

test("more than three words stops at three", () => {
  // The circle holds three. A fourth letter would either overflow or shrink the type until it is
  // unreadable at the size the PDF draws it.
  assert.equal(deriveInitials("Bouwbedrijf Jansen Zonen Amsterdam"), "BJZ");
});

test("a lowercase tussenvoegsel is a connector and does not take a slot", () => {
  // BVD says nothing about the bakery; BB is the monogram a person would write.
  assert.equal(deriveInitials("Bakkerij van der Berg"), "BB");
  assert.equal(deriveInitials("Jan de Vries"), "JV");
});

test("a CAPITALISED tussenvoegsel opens the name and does count", () => {
  // Dutch spelling draws this line itself: "De Bakker" is how the business is written down, and
  // its monogram starts with a D. No list of company names has to be guessed at.
  assert.equal(deriveInitials("De Bakker"), "DB");
  assert.equal(deriveInitials("Van Gogh Schilderwerken"), "VGS");
});

test("a name that is ONLY a tussenvoegsel still produces something", () => {
  // Filtering everything away would leave an empty monogram — worse than an odd one.
  assert.equal(deriveInitials("de"), "DE");
});

test("accents are folded, not deleted", () => {
  // Helvetica has no glyph for Ö. The old version stripped it AFTER slicing, so "Ölhandel" came
  // out as a bare L — a letter the owner never wrote.
  assert.equal(deriveInitials("Ölhandel"), "OL");
  assert.equal(deriveInitials("Café Zonneschijn"), "CZ");
  assert.equal(deriveInitials("Émile Küpper Advies"), "EKA");
});

test("a word that folds away to nothing does not eat one of the three slots", () => {
  // "&" has no letter in it. Were it counted before filtering, this would come out as "KF".
  assert.equal(deriveInitials("Kiwi & Food Market"), "KFM");
  assert.equal(deriveInitials("🍕 Pizza Palace Tilburg"), "PPT");
});

test("digits are letters enough for a monogram", () => {
  assert.equal(deriveInitials("3M Nederland"), "3N");
});

test("extra whitespace does not create empty initials", () => {
  assert.equal(deriveInitials("  Kiwi   Food  Market  "), "KFM");
});

test("nothing usable gives a dot, never a blank slot", () => {
  // A blank monogram on an invoice reads as a broken PDF.
  assert.equal(deriveInitials(""), "•");
  assert.equal(deriveInitials(null), "•");
  assert.equal(deriveInitials(undefined), "•");
  assert.equal(deriveInitials("🍕"), "•");
});
