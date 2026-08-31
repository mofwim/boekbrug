// [KLUIS] The retention article may not outrun the retention product.
// Run: npx tsx --test src/lib/retention-article.test.ts
//
// bonnetjes-bewaren-zzp.mdx is the most-read explanation of the bewaarplicht this company has,
// and it is now also the road to the one product with a legally forced buyer: somebody whose
// business has stopped and who must still be able to show seven years of administration.
//
// That makes two things in it worth pinning, and neither can be caught by reading the page.
//
// 1. A YEAR TYPED INTO PROSE CANNOT CORRECT ITSELF. The article says a business closed in 2026
//    must be showable through 2033. That is BEWAARPLICHT_YEARS away — today. If the constant ever
//    moves, every other surface follows it and this sentence silently does not, which turns the
//    site's plainest tax statement into a wrong one.
//
// 2. THE SENTENCE THAT KEEPS THE SELLING HONEST. bewaarkluis.ts lists in KLUIS_NOOIT what may
//    never be claimed, first among them: we do not take over your bewaarplicht. The article ends
//    by saying that in its own words. A marketing edit that tightens the copy is exactly how such
//    a line disappears — it reads like a caveat, and caveats are what gets cut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { BEWAARPLICHT_YEARS } from "./bewaarkluis";

const ARTICLE = path.join(process.cwd(), "content", "blog", "nl", "bonnetjes-bewaren-zzp.mdx");
const text = readFileSync(ARTICLE, "utf-8");

test("[KLUIS] the worked example in the article still matches BEWAARPLICHT_YEARS", () => {
  // "Sluit je in 2026 je zaak, dan moet je … tot en met 2033 kunnen tonen."
  const example = /in (\d{4}) je zaak[\s\S]{0,160}?tot en met (\d{4})/.exec(text);
  assert.ok(example, "the worked example is gone or reworded past recognition");

  const [, from, until] = example;
  assert.equal(
    Number(until) - Number(from),
    BEWAARPLICHT_YEARS,
    `the article spans ${from}→${until} but the bewaarplicht is ${BEWAARPLICHT_YEARS} years`,
  );
});

test("[KLUIS] the article still says the obligation stays with the reader", () => {
  // Not a phrase match on one sentence — that would fail on any honest rewrite. What must survive
  // is the claim: the duty is the reader's, and a stored copy is never the only one.
  assert.match(
    text,
    /blijft van jou|is en blijft van jou/,
    "the article no longer says the bewaarplicht stays with the reader",
  );
  assert.match(
    text,
    /tweede exemplaar/,
    "the article no longer says a stored copy is a second copy, never the only one",
  );
});

test("[KLUIS] the article never claims BoekBrug takes the obligation over", () => {
  // The exact overclaim KLUIS_NOOIT exists to prevent, in the shapes a marketing edit would
  // produce. Cheap to assert, and the failure it prevents is a claim we cannot stand behind.
  const forbidden = [
    /wij nemen (?:je|uw) bewaarplicht over/i,
    /wij bewaren het voor je/i,
    /jij hoeft niets meer te bewaren/i,
    /wij zijn verantwoordelijk voor (?:je|uw) bewaarplicht/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(text), `the article matches ${pattern} — that is a claim we do not make`);
  }
});

test("[KLUIS] the article still opens the door it was given", () => {
  // The whole point of the edit: the reader who has just learned the duty outlives the business
  // gets somewhere to go. Without this link the section is an explanation with no exit.
  assert.ok(
    text.includes("](/bewaarplicht)"),
    "the link to /bewaarplicht is gone — the section explains the problem and offers nothing",
  );
});
