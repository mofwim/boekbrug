// [PARSE-NL] Pure node test — run: npx tsx --test src/lib/parse-nl.test.ts
//
// This parser reads every amount a Dutch owner types into the money fields — the confirm modal,
// the correction modal, the kas drawer, the verdelen screen. It shipped without a single test,
// which for the function that decides whether "1.250" is a thousand-two-fifty or a euro-and-a-
// quarter is exactly the kind of quiet confidence this repo keeps finding out about the hard way.
// The cases below are the header's own documented contract, plus the NemaFood figures that showed
// the confirm modal could not accept a comma at all.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAmountNL, parseAmountEN } from "./parse-nl";

test("[PARSE-NL] the header's documented contract, case by case", () => {
  assert.equal(parseAmountNL("40.000"), 40000); // dot = thousands grouping
  assert.equal(parseAmountNL("1.250.000"), 1250000);
  assert.equal(parseAmountNL("1.250,00"), 1250); // dot thousands + comma decimal
  assert.equal(parseAmountNL("40.000,50"), 40000.5);
  assert.equal(parseAmountNL("1,5"), 1.5); // comma decimal
  assert.equal(parseAmountNL("0,25"), 0.25);
  assert.equal(parseAmountNL("1.5"), 1.5); // lone dot with ≠3 trailing digits = decimal
  assert.equal(parseAmountNL("0.25"), 0.25);
  assert.equal(parseAmountNL("40000"), 40000);
  assert.equal(parseAmountNL("100"), 100);
});

test("[PARSE-NL] the NemaFood figures — what the type=number field refused", () => {
  // The btw as printed on the paper, comma and all.
  assert.equal(parseAmountNL("95,54"), 95.54);
  // The total as printed: thousands dot AND decimal comma.
  assert.equal(parseAmountNL("1.160,68"), 1160.68);
  // Both-separators, English order: the last separator is the decimal.
  assert.equal(parseAmountNL("1,160.68"), 1160.68);
});

test("[PARSE-NL] a creditnota amount keeps its minus", () => {
  assert.equal(parseAmountNL("-109,58"), -109.58);
  assert.equal(parseAmountNL("-3,60"), -3.6);
});

test("[PARSE-NL] mid-keystroke and junk read as zero, never NaN", () => {
  // The draft pattern parses on every keystroke, so "95," passes through here mid-typing.
  assert.equal(parseAmountNL("95,"), 95);
  assert.equal(parseAmountNL(""), 0);
  assert.equal(parseAmountNL("   "), 0);
  assert.equal(parseAmountNL("abc"), 0);
  assert.equal(parseAmountNL(null), 0);
  assert.equal(parseAmountNL(undefined), 0);
  // A number passed straight through stays itself; a non-finite one is refused.
  assert.equal(parseAmountNL(95.54), 95.54);
  assert.equal(parseAmountNL(Number.NaN), 0);
});

test("[PARSE-NL] the English twin exists for the /en tool pages and disagrees on purpose", () => {
  assert.equal(parseAmountEN("50,000"), 50000); // fifty thousand to an English typist…
  assert.equal(parseAmountNL("50,000"), 50); // …and fifty to a Dutch one — that IS the contract
  assert.equal(parseAmountEN("1,234.56"), 1234.56);
  assert.equal(parseAmountEN("0.25"), 0.25);
});

test("[PARSE-STRIKT] a supplier's own crash is not an amount", () => {
  // `-1.#INF` is how the Microsoft C runtime prints negative infinity, and it turns up in the
  // PRICE COLUMN of real supplier invoices whose system divided by a zero quantity. It reached
  // money twice over: the owner copying the figure off the PDF into a correction field, and
  // ocrAmountValues, which hands this parser every transcribed token and offers what comes back as
  // a candidate total.
  //
  // The control, inline, because the mechanism is the point and it is not obvious:
  assert.equal(parseFloat("-1.#INF"), -1, "parseFloat reads the longest numeric PREFIX — that IS the bug");
  assert.equal(parseAmountNL("-1.#INF"), 0, "…and this parser must not repeat it");
  assert.equal(parseAmountEN("-1.#INF"), 0);
  for (const junk of ["1.#INF", "1.#IND", "-1.#QNAN", "12abc", "1,2,3", "1..2", "5,,0", "0x10", "1e3"]) {
    assert.equal(parseAmountNL(junk), 0, `"${junk}" is not a number and may not read as one`);
  }
});

test("[PARSE-STRIKT] a space is a thousands separator, and 1 250,00 is not one euro", () => {
  // The worse half of the same defect, and nothing to do with garbage: parseFloat stopped at the
  // space, so a real amount typed or pasted the way half this trade prints it read 1250x too
  // small — silently, in every money field in the app.
  assert.equal(parseAmountNL("1 250,00"), 1250);
  assert.equal(parseAmountNL("1 250,00"), 1250, "a non-breaking space too — that is what a PDF pastes");
  assert.equal(parseAmountNL("1 250 000,00"), 1250000);
  assert.equal(parseAmountEN("1 250 000.00"), 1250000);

  // …but only when it really groups. "12 34" is not a number, and inventing 1234 out of it would
  // be the same class of mistake in the other direction.
  assert.equal(parseAmountNL("12 34"), 0);
  assert.equal(parseAmountNL("5,00 excl"), 0, "a trailing word means the token was never an amount");
});

test("[PARSE-STRIKT] the currency symbol is not part of the value", () => {
  // "€ 5,00" used to read as 0 — the symbol stopped parseFloat before it started.
  assert.equal(parseAmountNL("€ 5,00"), 5);
  assert.equal(parseAmountNL("€5,00"), 5);
  assert.equal(parseAmountNL("5,00 €"), 5);
  assert.equal(parseAmountNL("5,00 EUR"), 5);
});

test("[PARSE-STRIKT] the accounting minus is written after the number, and it is still a minus", () => {
  // Bank exports and plenty of supplier templates write "7,50-". parseFloat dropped the trailing
  // sign and the amount came back POSITIVE — a refund read as a charge, which is the one outcome
  // here worse than refusing to read the field at all.
  assert.equal(parseAmountNL("7,50-"), -7.5);
  assert.equal(parseAmountNL("1.250,00-"), -1250);
  assert.equal(parseAmountEN("1,250.00-"), -1250);
  // Both signs at once is a typo, not a convention. Refuse rather than pick a winner.
  assert.equal(parseAmountNL("-5,00-"), 0);
});

test("[PARSE-STRIKT] strictness did not eat the half-typed number", () => {
  // The money fields parse on every keystroke, so the field is asked to read "95," while the owner
  // is still typing. A strict rule that blanked it there would be unusable — and this is exactly
  // the case a "must be a whole number" check gets wrong if it is written carelessly.
  assert.equal(parseAmountNL("95,"), 95);
  assert.equal(parseAmountNL("95."), 95);
  assert.equal(parseAmountNL(",5"), 0.5);
  assert.equal(parseAmountNL("-"), 0);
  assert.equal(parseAmountNL(","), 0);
  // And every case the header promises still holds — those are asserted above, one by one.
});
