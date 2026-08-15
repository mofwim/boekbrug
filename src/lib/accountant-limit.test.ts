// [BOEKHOUDER-GRENS] The published number must equal the code's number.
// Run: npx tsx --test src/lib/accountant-limit.test.ts
//
// WHY THIS TEST EXISTS
// ACCOUNTANT_FREE_CLIENTS is a CONTRACTUAL figure: it appears in the binding terms (§5.1, §5.8),
// in the fair-use policy that those terms incorporate, and on the pricing page. The header of
// prijzen/page.tsx already records what happens when a number is typed over in several places —
// on the billing branch the amounts had silently drifted apart from the binding terms, "and
// ambiguity in your own general terms is read against you".
//
// The pricing page reads the constant directly, so it cannot drift. The two legal texts are
// prose and CANNOT interpolate — so this is the only thing standing between raising the limit in
// code and quietly still promising the old one to everyone who reads the contract.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCOUNTANT_PRICING_ACTIVE } from "./accountant-pricing";
import { ACCOUNTANT_FREE_CLIENTS } from "./fair-use";
import voorwaarden from "../content/legal/algemene-voorwaarden";
import eerlijkGebruik from "../content/legal/eerlijk-gebruik";

const N = String(ACCOUNTANT_FREE_CLIENTS);

test("the terms quote the same number as the code", () => {
  assert.match(voorwaarden, new RegExp(`\\*\\*€0\\*\\* tot en met ${N} gekoppelde klanten`), "§5.1 table row");
  assert.match(voorwaarden, new RegExp(`gratis tot en met \\*\\*${N} gekoppelde klanten\\*\\*`), "§5.8");
});

test("the fair-use policy quotes the same number", () => {
  assert.match(eerlijkGebruik, new RegExp(`[Gg]ratis tot en met ${N} gekoppelde klanten`));
});

test("the old unconditional promise is gone from both texts", () => {
  // "always free, no matter how many clients" / "there is no paid accountant plan". Leaving one
  // of these behind next to the new limit is worse than either alone: two clauses, one contract,
  // and the reader gets to pick.
  for (const [name, text] of [["voorwaarden", voorwaarden], ["eerlijk gebruik", eerlijkGebruik]] as const) {
    assert.ok(!/geen betaald boekhoudersplan/i.test(text), `${name} still denies a paid portal`);
    assert.ok(!/ongeacht het aantal gekoppelde klanten/i.test(text), `${name} still promises unlimited`);
  }
});

test("a published rate is always labelled as not yet charging", () => {
  // This test used to assert that NO rate was published at all. In August 2026 a prepared band
  // table was published on purpose (docs/PRICING_DECISION_2026-08.md), so the guard moved rather
  // than disappeared — its point was never "no numbers", it was "no number that slipped in".
  //
  // The invariant now: while the price is not active, the euro amounts on the page must be
  // accompanied by the words that say they do not charge yet, and by the 30-day notice route. A
  // rewrite that drops the label while leaving the table is exactly the silent activation this
  // has always been here to prevent — it would leave an office reading a live-looking price that
  // nobody agreed to.
  assert.match(voorwaarden, /minstens \*\*30 dagen vooraf\*\*/);
  if (!ACCOUNTANT_PRICING_ACTIVE) {
    assert.match(voorwaarden, /Deze staffel is voorbereid, niet actief/);
    assert.match(voorwaarden, /is het portaal in zijn geheel kosteloos, ook boven de 10/);
  }
});

test("exceeding the limit never touches existing clients", () => {
  // The promise that makes this limit acceptable at all — same rule as fair use commitment 3.
  assert.match(voorwaarden, /verlies je geen toegang tot bestaande klanten/);
});
