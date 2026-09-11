// src/lib/correctie-tijdvak.test.ts — run: npx tsx --test src/lib/correctie-tijdvak.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tijdvakGevolg, tijdvakZin, vraagtEenBlik } from "./correctie-tijdvak";

const gediend = [{ year: 2026, quarter: 3, filed_at: "2026-10-28T09:00:00Z" }];

test("a correction in an open quarter says nothing at all", () => {
  // [RUSTIG] A notice that appears on every correction is read on none of them — which would
  // cost exactly the one that matters.
  const g = tijdvakGevolg("2026-11-04", gediend);
  assert.equal(g.soort, "open");
  assert.equal(tijdvakZin(g), null);
  assert.equal(vraagtEenBlik(g), false);
});

test("a correction in a FILED quarter names the quarter and the day it went", () => {
  const g = tijdvakGevolg("2026-07-15", gediend);
  assert.equal(g.soort, "ingediend");
  if (g.soort === "ingediend") {
    assert.match(g.tijdvak, /2026/);
    assert.equal(g.gediendOp, "2026-10-28");
  }
  const zin = String(tijdvakZin(g));
  assert.match(zin, /al hebt ingediend/);
  assert.match(zin, /2026-10-28/);
  assert.equal(vraagtEenBlik(g), true);
});

test("it never blocks — the correction is allowed and said to be allowed", () => {
  // An invoice that was wrong stays wrong until someone fixes it. Refusing the correction to keep
  // a filed return tidy would leave the books wrong, which is exactly backwards.
  const zin = String(tijdvakZin(tijdvakGevolg("2026-07-15", gediend)));
  assert.match(zin, /mag gewoon/);
  assert.doesNotMatch(zin, /kan niet|niet toegestaan|geblokkeerd/);
});

test("an unreadable date is UNKNOWN and says so — never assumed open", () => {
  const g = tijdvakGevolg(null, gediend);
  assert.equal(g.soort, "onbekend");
  assert.match(String(tijdvakZin(g)), /niet leesbaar/);
  assert.equal(vraagtEenBlik(g), true, "a question we could not answer still deserves a look");
  assert.equal(tijdvakGevolg("kapot", gediend).soort, "onbekend");
});

test("an empty filing record means nothing was filed — the young-administration case", () => {
  const g = tijdvakGevolg("2026-07-15", []);
  assert.equal(g.soort, "open");
  assert.equal(tijdvakZin(g), null);
});

test("only the matching quarter counts, not merely the same year", () => {
  assert.equal(tijdvakGevolg("2026-02-10", gediend).soort, "open", "Q1 is not Q3");
  assert.equal(tijdvakGevolg("2025-07-15", gediend).soort, "open", "the same quarter of another year is another quarter");
});

test("a filing with no timestamp still names the quarter", () => {
  const g = tijdvakGevolg("2026-07-15", [{ year: 2026, quarter: 3 }]);
  assert.equal(g.soort, "ingediend");
  if (g.soort === "ingediend") assert.equal(g.gediendOp, null);
  assert.doesNotMatch(String(tijdvakZin(g)), /op null|op undefined/);
});

test("this module computes no suppletie and touches no figure", () => {
  // btw-filing.ts owns that, and already does it. Two places deciding what a return owes is two
  // answers to one question.
  const g: Record<string, unknown> = { ...tijdvakGevolg("2026-07-15", gediend) };
  assert.deepEqual(Object.keys(g).sort(), ["gediendOp", "soort", "tijdvak"]);
});
