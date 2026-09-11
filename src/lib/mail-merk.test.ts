// src/lib/mail-merk.test.ts — run: npx tsx --test src/lib/mail-merk.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { merkKop, merkVoet, MERK_BLAUW } from "./mail-merk";

test("the wordmark is TEXT, never an image", () => {
  // Gmail, Outlook and Apple Mail block remote images by default. An <img> logo reaches most
  // readers as a grey box — a hole exactly where the mail's identity should be.
  const kop = merkKop("https://boekbrug.nl");
  assert.doesNotMatch(kop, /<img/i, "an image logo is invisible to most readers");
  assert.match(kop, /BoekBrug<\/a>/);
});

test("the wordmark is the link, and it opens the app", () => {
  const kop = merkKop("https://boekbrug.nl");
  assert.match(kop, /href="https:\/\/boekbrug\.nl\/dashboard"/);
});

test("the link is absolute — a mail has no origin of its own", () => {
  const kop = merkKop("https://boekbrug.nl");
  assert.doesNotMatch(kop, /href="\/[^/]/, "a root-relative href resolves against the mail client, which is nowhere");
});

test("the blue rule is there, in the one brand blue", () => {
  const kop = merkKop("https://boekbrug.nl");
  assert.ok(kop.includes(MERK_BLAUW), "the rule must use the shared colour, not a second almost-blue");
  assert.match(kop, /height: 3px; background: #1A73E8/);
});

test("a hostile base url cannot break out of the attribute", () => {
  const kop = merkKop('https://x.nl/" onmouseover="alert(1)');
  // The payload's TEXT survives — it is part of the url now — and that is fine. What must not
  // survive is a real quote closing the href early, which is the only thing that would turn it
  // into an attribute. Asserting the text is absent would be asserting the wrong thing, and would
  // pass on an escaper that stripped characters instead of encoding them.
  assert.doesNotMatch(kop, /onmouseover="/, "an unescaped quote would end the href and start an attribute");
  assert.match(kop, /onmouseover=&quot;/, "…so it stays inside the href, encoded");
  assert.equal((kop.match(/href="/g) ?? []).length, 1, "exactly one href, and it is still one attribute");
});

test("the footer says what the product is and how to stop the mail", () => {
  const voet = merkVoet("https://boekbrug.nl", "Je krijgt dit alleen op dagen dat er iets gebeurde.");
  assert.match(voet, /dagen dat er iets gebeurde/);
  assert.match(voet, /de brug tussen jou en je boekhouder/);
  assert.match(voet, /href="https:\/\/boekbrug\.nl\/dashboard"/);
});

test("the opt-out sentence is the caller's, and is escaped", () => {
  // A footer that guesses which switch turns this mail off sends the owner to a setting that does
  // not exist for this mail.
  const voet = merkVoet("https://boekbrug.nl", '<script>alert(1)</script>');
  assert.doesNotMatch(voet, /<script>/);
});
