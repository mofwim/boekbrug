// [VRAAG-MACHTIGING] Pure node test — run: npx tsx --test src/lib/mandate-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { canRequestMandate, buildMandateRequest, REQUEST_COOLDOWN_DAYS } from "./mandate-request";

const NOW = Date.parse("2026-08-04T12:00:00Z");
const dagenGeleden = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

test("a first request always goes", () => {
  assert.equal(canRequestMandate(null, NOW).allowed, true);
  assert.equal(canRequestMandate(undefined, NOW).allowed, true);
});

test("asking twice is nagging — and the refusal says when, and what to do instead", () => {
  // On the other side of this is not a user of ours but a bookkeeper's client. Their relationship
  // is not something we may load with reminders.
  const v = canRequestMandate(dagenGeleden(3), NOW);
  assert.equal(v.allowed, false);
  if (!v.allowed) {
    assert.match(v.reason, /11 dagen/, "counts down, so it is not a dead end");
    assert.match(v.reason, /bellen/, "and names the faster route, which is not another notification");
  }
});

test("the cooldown ends exactly when it says", () => {
  assert.equal(canRequestMandate(dagenGeleden(REQUEST_COOLDOWN_DAYS - 1), NOW).allowed, false);
  assert.equal(canRequestMandate(dagenGeleden(REQUEST_COOLDOWN_DAYS), NOW).allowed, true);
  assert.equal(canRequestMandate(dagenGeleden(60), NOW).allowed, true);
});

test("one day left is singular — the small thing that makes a sentence read as written by a person", () => {
  const v = canRequestMandate(dagenGeleden(REQUEST_COOLDOWN_DAYS - 1), NOW);
  assert.equal(v.allowed, false);
  if (!v.allowed) assert.match(v.reason, /over 1 dag nog eens/);
});

test("an unreadable date counts as 'just asked'", () => {
  // Doubt about whether we already knocked on someone's door means not knocking again.
  assert.equal(canRequestMandate("gisteren", NOW).allowed, false);
});

test("[FACTUREN] the request says what it gives, what it does NOT, and that no is fine", () => {
  const t = buildMandateRequest("facturen", "Administratiekantoor De Wit");
  assert.match(t.title, /Administratiekantoor De Wit/, "signed by a real name, not by the app");
  assert.match(t.body, /jouw naam, in jouw nummerreeks en onder jouw btw-nummer/, "what it is");
  // The paragraph that makes people say yes: knowing the edge. A client who agrees without knowing
  // the edge is a complaint waiting to happen.
  assert.match(t.body, /Wat hij NIET kan/);
  assert.match(t.body, /bankrekening/);
  assert.match(t.body, /aangifte indienen/);
  assert.match(t.body, /facturen die jij zelf hebt gemaakt/);
  // And the two sentences that keep it a request rather than pressure.
  assert.match(t.body, /zonder opzegtermijn/);
  assert.match(t.body, /Nee zeggen mag/);
});

test("[BEVESTIGEN] the request explains the blockage, and the narrower power", () => {
  const t = buildMandateRequest("bevestigen", "Administratiekantoor De Wit");
  // Why he is asking at all — a client who does not know their quarter is stuck cannot judge it.
  assert.match(t.body, /telt hij niet mee in je kwartaal/);
  assert.match(t.body, /nog niet klaar/);
  // The narrower boundary: confirm only, never rewrite. This is the whole reason the permission is
  // defensible (art. 52 AWR leaves the books with the entrepreneur).
  assert.match(t.body, /geen bedragen, datums of btw-tarieven wijzigen|bedragen, datums of btw-tarieven wijzigen/);
  assert.match(t.body, /komt zijn naam te staan/);
  assert.match(t.body, /Nee zeggen mag/);
});

test("a missing accountant name never produces a message signed by nobody", () => {
  const t = buildMandateRequest("facturen", "   ");
  assert.match(t.title, /Je boekhouder vraagt/);
  assert.doesNotMatch(t.title, /^\s*vraagt/);
});

test("the two requests are genuinely different texts", () => {
  // They are two separate permissions; a client who gets the same paragraph twice learns that the
  // difference does not matter — and it is the only thing that does.
  const a = buildMandateRequest("facturen", "X");
  const b = buildMandateRequest("bevestigen", "X");
  assert.notEqual(a.title, b.title);
  assert.notEqual(a.body, b.body);
  assert.doesNotMatch(a.body, /kwartaal/, "the invoicing request does not borrow the other's reason");
  assert.doesNotMatch(b.body, /nummerreeks/, "and the confirm request never mentions issuing");
});
