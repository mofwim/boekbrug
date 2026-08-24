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
