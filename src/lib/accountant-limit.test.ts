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

test("no rate is published while none is set", () => {
  // §5.8.1 is the whole reason a number can be published without a price: the limit binds us,
  // the rate follows §5.6's route. If a euro amount ever appears next to the portal, it must be
  // a deliberate act with 30 days' notice — not something that slipped in.
  assert.match(voorwaarden, /Het tarief is nog niet vastgesteld/);
  assert.match(voorwaarden, /minstens \*\*30 dagen vooraf\*\*/);
});

test("exceeding the limit never touches existing clients", () => {
  // The promise that makes this limit acceptable at all — same rule as fair use commitment 3.
  assert.match(voorwaarden, /verlies je geen toegang tot bestaande klanten/);
});
