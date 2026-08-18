// [BELOFTE-BEWIJS] Run: npx tsx --test src/lib/security-claims.test.ts
//
// The register in security-claims.ts is only worth having if something checks it, and this is that
// something. It fails in three directions, because a public security page rots in three ways and
// none of them looks like a bug:
//
//   1. the app stops doing what the page says   → the page is claiming a feature that was removed;
//   2. a claim is written and never rendered    → a promise nobody reads, the [LOGBOEK] failure;
//   3. the honest half is quietly dropped       → the page becomes a lie without one false sentence.
//
// The third is the one worth building a test for. Nobody deletes "wij zijn niet ISO-gecertificeerd"
// on purpose; it goes in a tidy-up, six months from now, by someone who reads it as a negative on a
// sales page. What is left is every flattering sentence, still individually true, adding up to a
// claim the product cannot support.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { SECURITY_CLAIMS, SECURITY_LIMITS } from "./security-claims";

const PAGE = "src/app/beveiliging/page.tsx";
const page = () => readFileSync(PAGE, "utf8");

test("[BELOFTE-BEWIJS] every public claim still has code behind it", () => {
  // The whole point. Rip out the two-step gate and this turns red, naming the promise that just
  // became marketing — instead of the page sitting there, confident and indexed, until the day
  // somebody relies on it.
  assert.ok(SECURITY_CLAIMS.length > 0, "the register is empty — this test would then assert nothing");

  for (const claim of SECURITY_CLAIMS) {
    assert.ok(claim.evidence.length > 0, `"${claim.id}" claims something and proves nothing`);
    for (const { file, pattern, proves } of claim.evidence) {
      assert.ok(existsSync(file), `"${claim.id}" rests on ${file}, which is gone (${proves})`);
      assert.match(
        readFileSync(file, "utf8"),
        pattern,
        `"${claim.id}" is no longer true: ${file} no longer shows ${pattern} (${proves}).\n` +
          `Either restore it, or take the claim off the public page — it is currently telling ` +
          `visitors the app does something it does not.`,
      );
    }
  }
});

test("[BELOFTE-BEWIJS] every claim is actually on the page", () => {
  // A promise written into a register and rendered nowhere is the [LOGBOEK] failure exactly: it
  // passes tsc, passes the build, and no visitor ever reads it.
  const html = page();
  for (const claim of SECURITY_CLAIMS) {
    assert.ok(
      html.includes("SECURITY_CLAIMS") || html.includes(claim.title),
      `"${claim.id}" is in the register and nothing renders it`,
    );
  }
  // MAPPED, not merely imported. An earlier version of this line matched /SECURITY_CLAIMS/ and
  // therefore passed on a page whose loop had been replaced by `[].map` — the import alone kept the
  // name in the file. That is this repo's own defect class ([STRIPPER-BLIND] in lifecycle-gates):
  // a gate reading a hole and reporting green. The render is what has to be asserted.
  assert.match(
    html, /SECURITY_CLAIMS\.map/,
    "the page imports the claims and never renders them — an import is not a paragraph a visitor reads",
  );
});

test("[BELOFTE-BEWIJS] the honest half cannot be dropped while the flattering half stays", () => {
  // THE ONE THAT MATTERS. Four sentences say what BoekBrug is NOT, and they are what make the seven
  // above worth believing. They are also the first thing a later rewrite deletes, because on a sales
  // page they read as a mistake.
  assert.equal(SECURITY_LIMITS.length, 4, "a limit was added or removed — was that deliberate?");
  // .map for the same reason as above: the import survives a deletion of the loop, so matching the
  // bare name would pass over a page that had quietly dropped every one of these four sentences.
  assert.match(
    page(), /SECURITY_LIMITS\.map/,
    "the page no longer RENDERS what the product cannot do — the flattering half would be all that is left",
  );

  const ids = SECURITY_LIMITS.map((l) => l.id);
  for (const required of ["geen-certificaat", "waar-staan-de-gegevens", "wat-het-logboek-niet-ziet", "wij-kunnen-erbij"]) {
    assert.ok(ids.includes(required), `the "${required}" limit is gone from the register`);
  }
});

test("[BELOFTE-BEWIJS] the page never contradicts the privacy statement about where data lives", () => {
  // The single easiest sentence to get wrong on a page like this, and the most damaging: "je
  // gegevens staan in Nederland" is what everybody assumes and what the privacy statement does not
  // say. It names Supabase Inc., the United States and standard contractual clauses — so the public
  // page says the same, and this test fails if either side moves without the other.
  const privacy = readFileSync("src/content/legal/privacyverklaring.ts", "utf8");
  assert.match(privacy, /Supabase Inc/, "the privacy statement no longer names Supabase — check both texts");
  assert.match(privacy, /Standard Contractual Clauses|SCC/, "the transfer basis moved; the public page still claims SCCs");

  const limit = SECURITY_LIMITS.find((l) => l.id === "waar-staan-de-gegevens");
  assert.ok(limit, "the hosting limit is gone");
  assert.match(limit!.body, /Supabase/, "the public sentence no longer names the processor the privacy statement names");
  assert.match(limit!.body, /SCC|standaardcontractbepalingen/, "the public sentence no longer names the transfer basis");
  // And it must never promise an EU location outright: the privacy statement says EU data location
  // is AVAILABLE and chosen where possible, which is a different sentence from "your data is in the EU".
  assert.doesNotMatch(
    limit!.body,
    /gegevens staan in (de )?(EU|Europa|Nederland)/i,
    "the page promises an EU location; the privacy statement only says it is chosen where possible",
  );
});

test("[BELOFTE-BEWIJS] no claim is written in the future tense", () => {
  // "Binnenkort", "wij werken aan" and "wij streven ernaar" are how a roadmap ends up on a page a
  // visitor reads as a description of the product. Everything here is either true today or off the
  // page — there is no third state, because a visitor cannot tell them apart.
  const soon = /binnenkort|we werken aan|wij werken aan|streven ernaar|van plan|komt eraan|in ontwikkeling/i;
  for (const claim of SECURITY_CLAIMS) {
    assert.doesNotMatch(claim.body, soon, `"${claim.id}" describes a plan, not the product`);
    assert.doesNotMatch(claim.title, soon, `"${claim.id}" describes a plan, not the product`);
  }
});
