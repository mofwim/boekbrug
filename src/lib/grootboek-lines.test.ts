// npx tsx --test src/lib/grootboek-lines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestionReason, openCountPhrase } from "./grootboek-lines";
import { MESSAGES } from "./i18n/messages";
import type { LedgerSuggestion } from "./grootboek";

const s = (over: Partial<LedgerSuggestion> = {}): LedgerSuggestion =>
  ({ accountId: "4100", confidence: 0.8, basis: "supplier_history", ...over });

test("[GROOTBOEK] the owner's own habit is the reason, when it is one", () => {
  assert.deepEqual(suggestionReason(s()), { key: "gb.waaromVaker" });
});

test("[GROOTBOEK] a word on the invoice is quoted back, so it can be argued with", () => {
  assert.deepEqual(suggestionReason(s({ basis: "keywords", matched: "huur" })), {
    key: "gb.waaromWoord", params: { woord: "huur" },
  });
});

test("[GROOTBOEK] knowing nothing is a sentence, not a blank under a filled-in account", () => {
  assert.deepEqual(suggestionReason(s({ basis: "default", accountId: "4000", confidence: 0 })), {
    key: "gb.waaromNiets",
  });
});

test("[GROOTBOEK] a keyword basis with no word names none rather than inventing one", () => {
  assert.deepEqual(suggestionReason(s({ basis: "keywords" })), { key: "gb.waaromNiets" });
});

test("[GROOTBOEK] the count line, singular, plural and finished", () => {
  assert.deepEqual(openCountPhrase(0), { key: "gb.klaar" });
  assert.deepEqual(openCountPhrase(-1), { key: "gb.klaar" }, "a negative count is not a backlog");
  assert.deepEqual(openCountPhrase(1), { key: "gb.openEen" });
  assert.deepEqual(openCountPhrase(608), { key: "gb.open", params: { n: 608 } });
});

test("[TAAL] every key this module can emit exists and carries Dutch", () => {
  const emitted = new Set<string>();
  for (const sg of [s(), s({ basis: "keywords", matched: "huur" }), s({ basis: "keywords" }), s({ basis: "default" })]) {
    emitted.add(suggestionReason(sg).key);
  }
  for (const n of [0, 1, 2]) emitted.add(openCountPhrase(n).key);
  assert.equal(emitted.size, 6, "every branch above must have produced its key");
  for (const key of emitted) {
    const entry = (MESSAGES as Record<string, { nl?: string }>)[key];
    assert.ok(entry, `${key} is missing from the catalogue`);
    assert.ok((entry.nl ?? "").trim().length > 0, `${key} has no Dutch`);
  }
});
