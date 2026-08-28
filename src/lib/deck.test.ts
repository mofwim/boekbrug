// [DECK] Pure node test — run: npx tsx --test src/lib/deck.test.ts
//
// The deck gets posted where nobody can correct it: a Facebook group, a LinkedIn feed, a PDF
// somebody saved. That makes a wrong claim on a slide more expensive than the same claim on a
// page, which can be edited. These tests guard the two ways it could go wrong quietly — a slide
// that outruns the promise it was built from, and the two languages drifting apart.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDeck, type DeckLocale } from "./deck";
import { BELOFTE_STAPPEN, BELOFTE_GERUST } from "./belofte";
import { PROMISE_STEPS, PROMISE_REASSURE } from "./belofte-en";
import { TOOLS } from "./tools";

const LOCALES: DeckLocale[] = ["nl", "en"];

test("[DECK] both languages produce the same slides in the same order", () => {
  // A deck that argues one way in Dutch and another in English is two products. The words
  // differ; the argument may not.
  const [nl, en] = LOCALES.map(buildDeck);
  assert.deepEqual(
    nl.slides.map((s) => s.kind),
    en.slides.map((s) => s.kind),
    "the slide sequence is the pitch — it must be identical in both languages",
  );
});

test("[DECK] every step from the promise reaches a slide", () => {
  // The steps are "the only task you have left". Three in the module and two on the slides would
  // mean the deck tells somebody they have less to do than they do.
  for (const locale of LOCALES) {
    const steps = buildDeck(locale).slides.filter((s) => s.kind === "step");
    const source = locale === "nl" ? BELOFTE_STAPPEN : PROMISE_STEPS;
    assert.equal(steps.length, source.length, `${locale}: a step went missing between the two`);
    steps.forEach((s, i) => {
      assert.equal(s.step, i + 1, `${locale}: step ${i + 1} is numbered wrong`);
      assert.equal(s.stepCount, source.length, `${locale}: step ${i + 1} counts the wrong total`);
    });
  }
});

test("[DECK] the closing slide carries the three contractual commitments, unaltered", () => {
  // BELOFTE_GERUST is not a slogan: free (§5.2), no expiring trial (why trial_ends_at does not
  // exist), never auto-charged (§5.2). The slide must print that line as it stands — not a
  // punchier version of it.
  assert.equal(buildDeck("nl").slides.at(-1)?.body, BELOFTE_GERUST);
  assert.equal(buildDeck("en").slides.at(-1)?.body, PROMISE_REASSURE);
  assert.equal(BELOFTE_GERUST.split("·").length, 3, "the Dutch line still has three parts");
});

test("[DECK] no slide claims something the promise does not", () => {
  // The failure mode of a deck: it is designed, so it gets shorter, and a sentence with a
  // boundary in it loses the boundary. belofte.ts is explicit about this one — everywhere it
  // says "staat klaar" and never "is gedaan", because an AI outcome is a suggestion under AV
  // §4.3 and the check stays with the user. These are the words that would break that.
  const forbidden = [
    /\bgarand/i, // guarantee
    /\bguarantee/i,
    /doet zichzelf/i, // "does itself"
    /\bautomatisch (?:ingediend|aangegeven)/i, // we do not file with the Belastingdienst
    /\bfiles? your (?:tax|btw|vat)/i,
    /\bwij zijn je boekhouder/i, // we are not the accountant
    /\bwe are your (?:bookkeeper|accountant)/i,
  ];
  for (const locale of LOCALES) {
    const text = buildDeck(locale)
      .slides.flatMap((s) => [s.eyebrow, s.head, s.body, ...(s.items ?? [])])
      .filter(Boolean)
      .join("\n");
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(text),
        `${locale}: a slide matches ${pattern} — that is a claim the product does not back`,
      );
    }
  }
});

test("[DECK] the tool count on the slide is the real one", () => {
  // A stale number is the detail a reader checks, and the one that costs the most when it is
  // wrong. It is interpolated from TOOLS, so this only fails if somebody types it back in.
  for (const locale of LOCALES) {
    const tools = buildDeck(locale).slides.find((s) => s.kind === "tools");
    assert.ok(tools, `${locale}: the tools slide is missing`);
    assert.ok(
      tools.head.includes(String(TOOLS.length)),
      `${locale}: the tools slide must name ${TOOLS.length} tools`,
    );
    assert.ok(tools.items && tools.items.length > 0, `${locale}: no tools are actually listed`);
    for (const name of tools.items) {
      assert.ok(
        TOOLS.some((t) => t.title === name),
        `${locale}: "${name}" is on the slide but is not a tool`,
      );
    }
  }
});

test("[DECK] every slide has a heading, and no slide is empty", () => {
  for (const locale of LOCALES) {
    for (const [i, s] of buildDeck(locale).slides.entries()) {
      assert.ok(s.head && s.head.trim().length > 0, `${locale}: slide ${i + 1} has no heading`);
    }
  }
});
