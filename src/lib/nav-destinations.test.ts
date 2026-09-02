// [NAV-BESTEMMINGEN] Pure node test — run: npx tsx --test src/lib/nav-destinations.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { destinationsFor, activeHref, OWNER, OWNER_COUNTER, ACCOUNTANT } from "./nav-destinations";

test("[NAV-BESTEMMINGEN] each role gets its own list, and the trade only moves the second one", () => {
  assert.deepEqual(destinationsFor("zzper"), OWNER);
  assert.deepEqual(destinationsFor("zzper", true), OWNER_COUNTER);
  assert.deepEqual(destinationsFor("accountant"), ACCOUNTANT);
  // The trade describes the OWNER; an accountant works across many of them.
  assert.deepEqual(destinationsFor("accountant", true), ACCOUNTANT, "a counter trade never reshapes the accountant's bar");
  // Only the second destination differs between the two owner lists — that one change is the point.
  assert.deepEqual(OWNER.map((d) => d.href).filter((_, i) => i !== 1), OWNER_COUNTER.map((d) => d.href).filter((_, i) => i !== 1));
  assert.notEqual(OWNER[1].href, OWNER_COUNTER[1].href);
});

test("[NAV-BESTEMMINGEN] home is exact, or it claims every screen in the app", () => {
  // /dashboard is a prefix of EVERY dashboard route. Without `exact`, standing on Kas lit up
  // "Start" — a bar that misreports your position is worse than one that admits it does not cover
  // this screen.
  assert.equal(activeHref("/dashboard", OWNER), "/dashboard");
  assert.equal(activeHref("/dashboard/kas", OWNER), null, "Kas belongs to no destination, and says so");
  assert.equal(activeHref("/dashboard/waarheid", OWNER), null);
});

test("[NAV-BESTEMMINGEN] the longest match wins, so a child lights its own parent", () => {
  assert.equal(activeHref("/dashboard/facturen", OWNER), "/dashboard/facturen");
  assert.equal(activeHref("/dashboard/incoming/manage", OWNER), "/dashboard/incoming");
  // `also` paths belong to their destination: a new invoice is Facturen, an upload is Inkomend.
  assert.equal(activeHref("/dashboard/invoice/new", OWNER), "/dashboard/facturen");
  assert.equal(activeHref("/dashboard/upload", OWNER), "/dashboard/incoming");
  // The accountant's client screens light Klanten, not Start.
  assert.equal(activeHref("/dashboard/clients/beheer", ACCOUNTANT), "/dashboard/clients/beheer");
  assert.equal(activeHref("/dashboard/accountant", ACCOUNTANT), "/dashboard/accountant");
});

test("[NAV-BESTEMMINGEN] every label is a catalogue key, never a word", () => {
  // The navigation is on every screen, so a hard-coded Dutch label here is the one piece of Dutch
  // an owner reading Arabic could never get away from.
  for (const list of [OWNER, OWNER_COUNTER, ACCOUNTANT]) {
    for (const d of list) {
      assert.match(d.label, /^nav\./, `${d.href} carries "${d.label}" — a label must be a catalogue key`);
      assert.ok(d.icon.length > 0, `${d.href} has no icon`);
      assert.match(d.href, /^\/dashboard/, `${d.href} is not a dashboard route`);
    }
  }
});
